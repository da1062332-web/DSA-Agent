// apps/api/src/modules/crm/customers/customer-profile.ts — owner: Bhushan (MOD-CUST, task P1-02; migration 0110).
//   GET    /v1/customers/{id}/profile                    customer.read
//   PUT    /v1/customers/{id}/profile                    customer.update; If-Match (0 before the first save)
//   GET    /v1/customers/{id}/identity                   customer.read; PAN masked, date of birth never returned
//   PUT    /v1/customers/{id}/identity                   customer.update; If-Match; PAN and date of birth encrypted
//   POST   /v1/customers/{id}/reveal                     customer.reveal_sensitive; reason + fresh step-up; audited; no-store
//   GET    /v1/customers/{id}/addresses                  customer.read
//   POST   /v1/customers/{id}/addresses                  customer.update; Idempotency-Key
//   PATCH  /v1/customers/{id}/addresses/{addressId}      customer.update; If-Match
//   DELETE /v1/customers/{id}/addresses/{addressId}      customer.update; If-Match; soft delete (removed_at)
// Another tenant's or an out-of-scope customer answers 404. Audit rows name the fields that changed, never their values. A PAN that
// another active customer of the tenant already holds is saved and flagged (possibleDuplicatePan), never merged.
import {
  AppError,
  CustomerAddressCreate,
  CustomerAddressUpdate,
  CustomerIdentityUpsert,
  CustomerProfileUpsert,
  CustomerRevealRequest,
  ageOn,
  isRealDate,
  maskPan,
  type CustomerAddressView,
  type CustomerIdentityView,
  type CustomerProfileView,
  type Money,
  type RequestContext,
  type Tx,
} from '@dsa/contracts';
import { withIdempotency } from '@dsa/kernel';
import type { Response, Router } from 'express';
import { sql } from 'kysely';
import { projectMfaOff } from '../../../http/mfa-switch';
import { idempotencyKey, ifMatchVersion, requireCtx } from '../../../http/request';
import type { ApiDeps } from '../../types';
import { requireCustomerAccess } from './authz-helper';
import { decryptIdentityField, encryptIdentityField, panHash, panHashCandidates } from './identity-crypto';
import type { CustomerRepository } from './repository';
import type { CustomerRow } from './types';

type Row = Record<string, unknown>;

/** Step-up for revealing S3 data: refused outright while the project has no second factor, else a fresh (≤ 900 s) aal2 code. */
export const PROJECT_SECOND_FACTOR_OFF = 'PROJECT_SECOND_FACTOR_OFF';
function requireRevealStepUp(deps: ApiDeps, ctx: RequestContext): void {
  if (projectMfaOff()) {
    throw AppError.of(
      'FORBIDDEN',
      'Revealing a PAN or date of birth is unavailable: the project has no second factor, so step-up MFA cannot be checked.',
      [{ field: 'SUPABASE_MFA_ENABLED', issue: PROJECT_SECOND_FACTOR_OFF }],
    );
  }
  deps.authz.requireStepUp(ctx, 900);
}

const iso = (v: unknown): string => new Date(String(v)).toISOString();
const isoOrNull = (v: unknown): string | null => (v ? iso(v) : null);
const money = (amount: unknown, currency: unknown): Money | null =>
  amount === null || amount === undefined
    ? null
    : { amount: Number(amount).toFixed(2), currency: String(currency ?? 'INR') };

function toProfile(customerId: string, r: Row | undefined): CustomerProfileView {
  return {
    customerId,
    constitution: (r?.constitution as CustomerProfileView['constitution']) ?? null,
    employmentType: (r?.employment_type as CustomerProfileView['employmentType']) ?? null,
    employerName: (r?.employer_name as string | null) ?? null,
    businessName: (r?.business_name as string | null) ?? null,
    vintageMonths:
      r?.vintage_months === null || r?.vintage_months === undefined ? null : Number(r.vintage_months),
    gstin: (r?.gstin as string | null) ?? null,
    udyamNumber: (r?.udyam_number as string | null) ?? null,
    monthlyIncome: money(r?.monthly_income, r?.currency),
    monthlyObligations: money(r?.monthly_obligations, r?.currency),
    lockVersion: r ? Number(r.lock_version) : 0,
    updatedAt: isoOrNull(r?.updated_at),
  };
}

function toIdentity(
  customerId: string,
  r: Row | undefined,
  possibleDuplicatePan: boolean,
): CustomerIdentityView {
  return {
    customerId,
    panMasked: (r?.pan_masked as string | null) ?? null,
    hasDateOfBirth: Boolean(r?.dob_ciphertext),
    birthYear: r?.birth_year === null || r?.birth_year === undefined ? null : Number(r.birth_year),
    possibleDuplicatePan,
    lockVersion: r ? Number(r.lock_version) : 0,
    updatedAt: isoOrNull(r?.updated_at),
  };
}

function toAddress(r: Row): CustomerAddressView {
  return {
    id: String(r.id),
    customerId: String(r.customer_id),
    addressType: r.address_type as CustomerAddressView['addressType'],
    line1: String(r.line1),
    line2: (r.line2 as string | null) ?? null,
    landmark: (r.landmark as string | null) ?? null,
    city: String(r.city),
    state: String(r.state),
    pincode: String(r.pincode),
    ownership: (r.ownership as CustomerAddressView['ownership']) ?? null,
    yearsAtAddress: r.years_at_address === null ? null : Number(r.years_at_address),
    lockVersion: Number(r.lock_version),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

function sendWithEtag(res: Response, status: number, body: { lockVersion: number }): void {
  res.set('ETag', `"${body.lockVersion}"`);
  res.status(status).json(body);
}

function assertVersion(expected: number, current: number): void {
  if (expected !== current) {
    throw AppError.of('VERSION_CONFLICT', 'The record was changed by someone else; reload and try again.', [
      { field: 'If-Match', issue: 'STALE', meta: { current } },
    ]);
  }
}

function assertActive(customer: CustomerRow): void {
  if (customer.status !== 'ACTIVE')
    throw AppError.of('INVALID_STATE', 'A merged customer cannot be changed.');
}

async function emit(
  deps: ApiDeps,
  tx: Tx,
  ctx: RequestContext,
  eventType: string,
  customerId: string,
  payload: object,
) {
  await sql`
    insert into outbox_event (id, tenant_id, event_type, event_version, subject_type, subject_id, payload,
                              correlation_id, chain_depth, created_at)
    values (${deps.ids.next('evt')}, ${ctx.principal.tenantId}, ${eventType}, 1, 'CUSTOMER', ${customerId},
            ${JSON.stringify({ customerId, ...payload })}::jsonb, ${ctx.correlationId}, 0, ${ctx.now})`.execute(
    tx,
  );
}

/** Other active customers of the tenant holding the same PAN hash (ids only). */
async function duplicatePanHolders(
  tx: Tx,
  tenantId: string,
  customerId: string,
  hashes: Buffer[],
): Promise<string[]> {
  if (hashes.length === 0) return [];
  const r = await sql<{ customer_id: string }>`
    select ci.customer_id from customer_identity ci
      join customer c on c.tenant_id = ci.tenant_id and c.id = ci.customer_id and c.status = 'ACTIVE'
     where ci.tenant_id = ${tenantId} and ci.customer_id <> ${customerId}
       and ci.pan_hash in (${sql.join(hashes)})
     order by ci.customer_id
     limit 20`.execute(tx);
  return r.rows.map((x) => x.customer_id);
}

async function identityRow(tx: Tx, tenantId: string, customerId: string, forUpdate = false) {
  const r = forUpdate
    ? await sql<Row>`select * from customer_identity where tenant_id = ${tenantId} and customer_id = ${customerId} for update`.execute(
        tx,
      )
    : await sql<Row>`select * from customer_identity where tenant_id = ${tenantId} and customer_id = ${customerId}`.execute(
        tx,
      );
  return r.rows[0];
}

export function registerCustomerProfileRoutes(router: Router, deps: ApiDeps, repo: CustomerRepository): void {
  // ---- Profile ------------------------------------------------------------------------------------------------------------------

  router.get('/customers/:id/profile', async (req, res) => {
    const ctx = requireCtx(req);
    const body = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const customer = await repo.findCustomerById(tx, ctx.principal.tenantId, req.params.id);
      requireCustomerAccess(ctx, 'customer.read', customer);
      const r = await sql<Row>`
        select * from customer_profile where tenant_id = ${ctx.principal.tenantId} and customer_id = ${customer.id}`.execute(
        tx,
      );
      return toProfile(customer.id, r.rows[0]);
    });
    sendWithEtag(res, 200, body);
  });

  router.put('/customers/:id/profile', async (req, res) => {
    const ctx = requireCtx(req);
    const expected = ifMatchVersion(req);
    const input = CustomerProfileUpsert.parse(req.body);
    const body = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const tenantId = ctx.principal.tenantId;
      const customer = await repo.findCustomerByIdForUpdate(tx, tenantId, req.params.id);
      requireCustomerAccess(ctx, 'customer.update', customer);
      assertActive(customer);
      const cur = (
        await sql<Row>`select * from customer_profile where tenant_id = ${tenantId} and customer_id = ${customer.id} for update`.execute(
          tx,
        )
      ).rows[0];
      assertVersion(expected, cur ? Number(cur.lock_version) : 0);

      // A field left out keeps its value; null clears it.
      const pick = <T>(key: keyof typeof input, column: string): T | null =>
        (input[key] !== undefined ? input[key] : (cur?.[column] ?? null)) as T | null;
      const income =
        input.monthlyIncome !== undefined
          ? (input.monthlyIncome?.amount ?? null)
          : (cur?.monthly_income ?? null);
      const obligations =
        input.monthlyObligations !== undefined
          ? (input.monthlyObligations?.amount ?? null)
          : (cur?.monthly_obligations ?? null);
      const values = {
        constitution: pick<string>('constitution', 'constitution'),
        employmentType: pick<string>('employmentType', 'employment_type'),
        employerName: pick<string>('employerName', 'employer_name'),
        businessName: pick<string>('businessName', 'business_name'),
        vintageMonths: pick<number>('vintageMonths', 'vintage_months'),
        gstin: pick<string>('gstin', 'gstin'),
        udyamNumber: pick<string>('udyamNumber', 'udyam_number'),
      };
      const r = cur
        ? await sql<Row>`
            update customer_profile
               set constitution = ${values.constitution}, employment_type = ${values.employmentType},
                   employer_name = ${values.employerName}, business_name = ${values.businessName},
                   vintage_months = ${values.vintageMonths}, gstin = ${values.gstin}, udyam_number = ${values.udyamNumber},
                   monthly_income = ${income}, monthly_obligations = ${obligations},
                   lock_version = lock_version + 1, updated_at = ${ctx.now}, updated_by = ${ctx.principal.id}
             where tenant_id = ${tenantId} and customer_id = ${customer.id}
             returning *`.execute(tx)
        : await sql<Row>`
            insert into customer_profile (tenant_id, customer_id, constitution, employment_type, employer_name, business_name,
                                          vintage_months, gstin, udyam_number, monthly_income, monthly_obligations,
                                          created_at, created_by, updated_at, updated_by)
            values (${tenantId}, ${customer.id}, ${values.constitution}, ${values.employmentType}, ${values.employerName},
                    ${values.businessName}, ${values.vintageMonths}, ${values.gstin}, ${values.udyamNumber}, ${income},
                    ${obligations}, ${ctx.now}, ${ctx.principal.id}, ${ctx.now}, ${ctx.principal.id})
            returning *`.execute(tx);
      const changed = Object.keys(input).filter((k) => !['pan', 'aadhaar', 'dateOfBirth'].includes(k));
      await deps.audit.record(tx, ctx, {
        action: 'customer.profile_updated',
        entityType: 'CUSTOMER',
        entityId: customer.id,
        after: { fields: changed },
        permissionUsed: 'customer.update',
      });
      await emit(deps, tx, ctx, 'customer.updated', customer.id, { section: 'PROFILE', fields: changed });
      return toProfile(customer.id, r.rows[0]);
    });
    sendWithEtag(res, 200, body);
  });

  // ---- Identity (S3) ------------------------------------------------------------------------------------------------------------

  router.get('/customers/:id/identity', async (req, res) => {
    const ctx = requireCtx(req);
    const body = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const tenantId = ctx.principal.tenantId;
      const customer = await repo.findCustomerById(tx, tenantId, req.params.id);
      requireCustomerAccess(ctx, 'customer.read', customer);
      const r = await identityRow(tx, tenantId, customer.id);
      const dups = r?.pan_hash
        ? await duplicatePanHolders(tx, tenantId, customer.id, [r.pan_hash as Buffer])
        : [];
      return toIdentity(customer.id, r, dups.length > 0);
    });
    res.set('Cache-Control', 'no-store');
    sendWithEtag(res, 200, body);
  });

  router.put('/customers/:id/identity', async (req, res) => {
    const ctx = requireCtx(req);
    const expected = ifMatchVersion(req);
    const input = CustomerIdentityUpsert.parse(req.body);
    if (input.dateOfBirth) {
      if (!isRealDate(input.dateOfBirth)) {
        throw AppError.of('VALIDATION_ERROR', 'dateOfBirth is not a real date.', [
          { field: 'dateOfBirth', issue: 'INVALID_DATE' },
        ]);
      }
      const age = ageOn(input.dateOfBirth, ctx.now);
      if (age < 18 || age > 100) {
        throw AppError.of('VALIDATION_ERROR', 'The customer must be between 18 and 100 years old.', [
          { field: 'dateOfBirth', issue: 'AGE_OUT_OF_RANGE' },
        ]);
      }
    }
    const body = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const tenantId = ctx.principal.tenantId;
      const customer = await repo.findCustomerByIdForUpdate(tx, tenantId, req.params.id);
      requireCustomerAccess(ctx, 'customer.update', customer);
      assertActive(customer);
      const cur = await identityRow(tx, tenantId, customer.id, true);
      assertVersion(expected, cur ? Number(cur.lock_version) : 0);

      let panCipher = (cur?.pan_ciphertext as Buffer | null) ?? null;
      let panHashValue = (cur?.pan_hash as Buffer | null) ?? null;
      let panMasked = (cur?.pan_masked as string | null) ?? null;
      if (input.pan !== undefined) {
        panCipher = input.pan === null ? null : encryptIdentityField(tenantId, customer.id, 'PAN', input.pan);
        panHashValue = input.pan === null ? null : panHash(tenantId, input.pan);
        panMasked = input.pan === null ? null : maskPan(input.pan);
      }
      let dobCipher = (cur?.dob_ciphertext as Buffer | null) ?? null;
      let birthYear =
        cur?.birth_year === null || cur?.birth_year === undefined ? null : Number(cur.birth_year);
      if (input.dateOfBirth !== undefined) {
        dobCipher =
          input.dateOfBirth === null
            ? null
            : encryptIdentityField(tenantId, customer.id, 'DATE_OF_BIRTH', input.dateOfBirth);
        birthYear = input.dateOfBirth === null ? null : Number(input.dateOfBirth.slice(0, 4));
      }

      const r = cur
        ? await sql<Row>`
            update customer_identity
               set pan_ciphertext = ${panCipher}, pan_hash = ${panHashValue}, pan_masked = ${panMasked},
                   dob_ciphertext = ${dobCipher}, birth_year = ${birthYear},
                   lock_version = lock_version + 1, updated_at = ${ctx.now}, updated_by = ${ctx.principal.id}
             where tenant_id = ${tenantId} and customer_id = ${customer.id}
             returning *`.execute(tx)
        : await sql<Row>`
            insert into customer_identity (tenant_id, customer_id, pan_ciphertext, pan_hash, pan_masked, dob_ciphertext, birth_year,
                                           created_at, created_by, updated_at, updated_by)
            values (${tenantId}, ${customer.id}, ${panCipher}, ${panHashValue}, ${panMasked}, ${dobCipher}, ${birthYear},
                    ${ctx.now}, ${ctx.principal.id}, ${ctx.now}, ${ctx.principal.id})
            returning *`.execute(tx);

      const dups =
        input.pan !== undefined && input.pan !== null
          ? await duplicatePanHolders(tx, tenantId, customer.id, panHashCandidates(tenantId, input.pan))
          : panHashValue
            ? await duplicatePanHolders(tx, tenantId, customer.id, [panHashValue])
            : [];
      const fields = [
        input.pan !== undefined ? 'PAN' : null,
        input.dateOfBirth !== undefined ? 'DATE_OF_BIRTH' : null,
      ].filter((f): f is string => f !== null);
      await deps.audit.record(tx, ctx, {
        action: 'customer.identity_updated',
        entityType: 'CUSTOMER',
        entityId: customer.id,
        after: {
          fields,
          cleared: fields.filter((f) => (f === 'PAN' ? input.pan === null : input.dateOfBirth === null)),
        },
        permissionUsed: 'customer.update',
      });
      await emit(deps, tx, ctx, 'customer.updated', customer.id, { section: 'IDENTITY', fields });
      if (input.pan && dups.length > 0) {
        // Flag only: P4-03 (dedupe depth) turns this into a duplicate review. Never merged here.
        await deps.audit.record(tx, ctx, {
          action: 'customer.duplicate_pan_detected',
          entityType: 'CUSTOMER',
          entityId: customer.id,
          after: { otherCustomerIds: dups },
          permissionUsed: 'customer.update',
        });
        await emit(deps, tx, ctx, 'customer.duplicate_suspected', customer.id, {
          match: 'PAN',
          otherCustomerIds: dups,
        });
      }
      return toIdentity(customer.id, r.rows[0], dups.length > 0);
    });
    res.set('Cache-Control', 'no-store');
    sendWithEtag(res, 200, body);
  });

  // API-CUST-006: reveal one masked field, once, with a reason and a fresh step-up.
  router.post('/customers/:id/reveal', async (req, res) => {
    const ctx = requireCtx(req);
    const input = CustomerRevealRequest.parse(req.body);
    const body = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const tenantId = ctx.principal.tenantId;
      const customer = await repo.findCustomerById(tx, tenantId, req.params.id);
      requireCustomerAccess(ctx, 'customer.reveal_sensitive', customer);
      requireRevealStepUp(deps, ctx);
      const r = await identityRow(tx, tenantId, customer.id);
      const stored = (input.field === 'PAN' ? r?.pan_ciphertext : r?.dob_ciphertext) as
        Buffer | null | undefined;
      if (!stored)
        throw AppError.of(
          'NOT_FOUND',
          `No ${input.field === 'PAN' ? 'PAN' : 'date of birth'} is stored for this customer.`,
        );
      const value = decryptIdentityField(tenantId, customer.id, input.field, stored);
      await deps.audit.record(tx, ctx, {
        action: 'customer.sensitive_revealed',
        entityType: 'CUSTOMER',
        entityId: customer.id,
        after: { field: input.field },
        reason: input.reason,
        permissionUsed: 'customer.reveal_sensitive',
      });
      return { customerId: customer.id, field: input.field, value, revealedAt: ctx.now.toISOString() };
    });
    res.set('Cache-Control', 'no-store');
    res.status(200).json(body);
  });

  // ---- Addresses ----------------------------------------------------------------------------------------------------------------

  router.get('/customers/:id/addresses', async (req, res) => {
    const ctx = requireCtx(req);
    const data = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const customer = await repo.findCustomerById(tx, ctx.principal.tenantId, req.params.id);
      requireCustomerAccess(ctx, 'customer.read', customer);
      const r = await sql<Row>`
        select * from customer_address
         where tenant_id = ${ctx.principal.tenantId} and customer_id = ${customer.id} and removed_at is null
         order by case address_type when 'CURRENT' then 1 when 'PERMANENT' then 2 else 3 end, created_at`.execute(
        tx,
      );
      return r.rows.map(toAddress);
    });
    res.status(200).json({ data, meta: { nextCursor: null, limit: 200 } });
  });

  router.post('/customers/:id/addresses', async (req, res) => {
    const ctx = requireCtx(req);
    const key = idempotencyKey(req);
    const input = CustomerAddressCreate.parse(req.body);
    const result = await deps.txRunner.withTenantTx(ctx, (tx) =>
      withIdempotency(
        tx,
        ctx,
        { key, method: 'POST', path: `/v1/customers/${req.params.id}/addresses`, body: input },
        async () => {
          const tenantId = ctx.principal.tenantId;
          const customer = await repo.findCustomerByIdForUpdate(tx, tenantId, req.params.id);
          requireCustomerAccess(ctx, 'customer.update', customer);
          assertActive(customer);
          const live = await sql`
            select 1 from customer_address
             where tenant_id = ${tenantId} and customer_id = ${customer.id} and address_type = ${input.addressType}
               and removed_at is null`.execute(tx);
          if (live.rows.length) {
            throw AppError.of(
              'VALIDATION_ERROR',
              `The customer already has a ${input.addressType} address; edit it instead.`,
              [{ field: 'addressType', issue: 'ALREADY_EXISTS' }],
            );
          }
          const id = deps.ids.next('cad');
          const r = await sql<Row>`
            insert into customer_address (id, tenant_id, customer_id, address_type, line1, line2, landmark, city, state, pincode,
                                          ownership, years_at_address, created_at, created_by, updated_at, updated_by)
            values (${id}, ${tenantId}, ${customer.id}, ${input.addressType}, ${input.line1}, ${input.line2 ?? null},
                    ${input.landmark ?? null}, ${input.city}, ${input.state}, ${input.pincode}, ${input.ownership ?? null},
                    ${input.yearsAtAddress ?? null}, ${ctx.now}, ${ctx.principal.id}, ${ctx.now}, ${ctx.principal.id})
            returning *`.execute(tx);
          await deps.audit.record(tx, ctx, {
            action: 'customer.address_added',
            entityType: 'CUSTOMER',
            entityId: customer.id,
            after: { addressId: id, addressType: input.addressType },
            permissionUsed: 'customer.update',
          });
          await emit(deps, tx, ctx, 'customer.updated', customer.id, { section: 'ADDRESS', addressId: id });
          return { status: 201, body: toAddress(r.rows[0]!), resourceRef: id };
        },
      ),
    );
    if (result.replayed) res.set('Idempotent-Replayed', 'true');
    sendWithEtag(res, result.status, result.body as CustomerAddressView);
  });

  router.patch('/customers/:id/addresses/:addressId', async (req, res) => {
    const ctx = requireCtx(req);
    const expected = ifMatchVersion(req);
    const input = CustomerAddressUpdate.parse(req.body);
    const body = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const tenantId = ctx.principal.tenantId;
      const customer = await repo.findCustomerByIdForUpdate(tx, tenantId, req.params.id);
      requireCustomerAccess(ctx, 'customer.update', customer);
      assertActive(customer);
      const cur = (
        await sql<Row>`
          select * from customer_address
           where tenant_id = ${tenantId} and customer_id = ${customer.id} and id = ${req.params.addressId}
             and removed_at is null
           for update`.execute(tx)
      ).rows[0];
      if (!cur) throw AppError.of('NOT_FOUND', 'Address not found.');
      assertVersion(expected, Number(cur.lock_version));
      const v = <T>(key: keyof typeof input, column: string): T | null =>
        (input[key] !== undefined ? input[key] : cur[column]) as T | null;
      const r = await sql<Row>`
        update customer_address
           set line1 = ${v<string>('line1', 'line1')}, line2 = ${v<string>('line2', 'line2')},
               landmark = ${v<string>('landmark', 'landmark')}, city = ${v<string>('city', 'city')},
               state = ${v<string>('state', 'state')}, pincode = ${v<string>('pincode', 'pincode')},
               ownership = ${v<string>('ownership', 'ownership')}, years_at_address = ${v<number>('yearsAtAddress', 'years_at_address')},
               lock_version = lock_version + 1, updated_at = ${ctx.now}, updated_by = ${ctx.principal.id}
         where tenant_id = ${tenantId} and id = ${cur.id as string}
         returning *`.execute(tx);
      await deps.audit.record(tx, ctx, {
        action: 'customer.address_updated',
        entityType: 'CUSTOMER',
        entityId: customer.id,
        after: { addressId: cur.id, fields: Object.keys(input) },
        permissionUsed: 'customer.update',
      });
      await emit(deps, tx, ctx, 'customer.updated', customer.id, { section: 'ADDRESS', addressId: cur.id });
      return toAddress(r.rows[0]!);
    });
    sendWithEtag(res, 200, body);
  });

  router.delete('/customers/:id/addresses/:addressId', async (req, res) => {
    const ctx = requireCtx(req);
    const expected = ifMatchVersion(req);
    await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const tenantId = ctx.principal.tenantId;
      const customer = await repo.findCustomerByIdForUpdate(tx, tenantId, req.params.id);
      requireCustomerAccess(ctx, 'customer.update', customer);
      assertActive(customer);
      const cur = (
        await sql<Row>`
          select id, lock_version from customer_address
           where tenant_id = ${tenantId} and customer_id = ${customer.id} and id = ${req.params.addressId}
             and removed_at is null
           for update`.execute(tx)
      ).rows[0];
      if (!cur) throw AppError.of('NOT_FOUND', 'Address not found.');
      assertVersion(expected, Number(cur.lock_version));
      await sql`
        update customer_address
           set removed_at = ${ctx.now}, lock_version = lock_version + 1, updated_at = ${ctx.now}, updated_by = ${ctx.principal.id}
         where tenant_id = ${tenantId} and id = ${cur.id as string}`.execute(tx);
      await deps.audit.record(tx, ctx, {
        action: 'customer.address_removed',
        entityType: 'CUSTOMER',
        entityId: customer.id,
        after: { addressId: cur.id },
        permissionUsed: 'customer.update',
      });
      await emit(deps, tx, ctx, 'customer.updated', customer.id, {
        section: 'ADDRESS',
        addressId: cur.id,
        removed: true,
      });
    });
    res.status(204).end();
  });
}
