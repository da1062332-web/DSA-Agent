// apps/api/src/modules/crm/customers/customer-extras.ts — owner: Dev 5 (MOD-CUST). M-075.
//   API-CUST-007 POST /v1/customers/{id}/contact-points  customer.update; Idempotency-Key. A further mobile or email; values
//                are stored with their tenant-scoped hash and returned masked.
//   API-CUST-008 POST /v1/customers/{id}/merge           lead.merge; Idempotency-Key. {id} is merged into intoCustomerId: it
//                becomes MERGED, its contact points are copied to the survivor, and leads and live applications are
//                re-pointed (merge_customer_links). Consents of the merged customer keep counting for the survivor.
import { AppError, maskEmail, maskMobile, type RequestContext, type Tx } from '@dsa/contracts';
import { withIdempotency } from '@dsa/kernel';
import type { Router } from 'express';
import { sql } from 'kysely';
import { z } from 'zod';
import { idempotencyKey, requireCtx } from '../../../http/request';
import type { ApiDeps } from '../../types';
import { requireCustomerAccess } from './authz-helper';
import { computeEmailHash, computeMobileHash, normalizeEmail, normalizeMobile } from './normalizer';
import type { CustomerRepository, CustomerRow } from './repository';

const NO_S3 = [/[A-Z]{5}[0-9]{4}[A-Z]/i, /\b\d{4}\s?\d{4}\s?\d{4}\b/, /\b\d{9,18}\b/];

export const ContactPointCreate = z
  .object({
    kind: z.enum(['MOBILE', 'EMAIL']),
    value: z.string().trim().min(3).max(254),
    isPrimary: z.boolean().default(false),
  })
  .strict();

export const CustomerMerge = z
  .object({
    intoCustomerId: z.string().min(3).max(64),
    reason: z
      .string()
      .trim()
      .min(3)
      .max(200)
      .refine((s) => !NO_S3.some((p) => p.test(s)), 'must not contain identity or account numbers'),
  })
  .strict();

type Row = Record<string, unknown>;

const toContactPoint = (r: Row) => ({
  id: String(r.id),
  customerId: String(r.customer_id),
  kind: String(r.kind),
  valueMasked: r.kind === 'MOBILE' ? maskMobile(String(r.value)) : maskEmail(String(r.value)),
  isPrimary: Boolean(r.is_primary),
  verifiedAt: r.verified_at ? new Date(String(r.verified_at)).toISOString() : null,
  createdAt: new Date(String(r.created_at)).toISOString(),
});

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

export function registerCustomerExtraRoutes(router: Router, deps: ApiDeps, repo: CustomerRepository): void {
  // API-CUST-007
  router.post('/customers/:id/contact-points', async (req, res) => {
    const ctx = requireCtx(req);
    const key = idempotencyKey(req);
    const input = ContactPointCreate.parse(req.body);
    const result = await deps.txRunner.withTenantTx(ctx, (tx) =>
      withIdempotency(
        tx,
        ctx,
        { key, method: 'POST', path: `/v1/customers/${req.params.id}/contact-points`, body: input },
        async () => {
          const customer = await repo.findCustomerByIdForUpdate(tx, ctx.principal.tenantId, req.params.id);
          requireCustomerAccess(ctx, 'customer.update', customer);
          if (customer.status !== 'ACTIVE')
            throw AppError.of('INVALID_STATE', 'A merged customer cannot be changed.');
          const tenantId = ctx.principal.tenantId;
          const value = input.kind === 'MOBILE' ? normalizeMobile(input.value) : normalizeEmail(input.value)!;
          const hash =
            input.kind === 'MOBILE' ? computeMobileHash(tenantId, value) : computeEmailHash(tenantId, value);
          const dup = await sql`
            select 1 from customer_contact_point where customer_id = ${customer.id} and kind = ${input.kind} and value_hash = ${hash}`.execute(
            tx,
          );
          if (dup.rows.length) {
            throw AppError.of('VALIDATION_ERROR', 'The customer already has this contact point.', [
              { field: 'value', issue: 'DUPLICATE' },
            ]);
          }
          if (input.isPrimary) {
            // The primary contact moves to the new value; contact points are otherwise never changed.
            await sql`
              update customer_contact_point set is_primary = false
               where customer_id = ${customer.id} and kind = ${input.kind} and is_primary`.execute(tx);
          }
          const id = deps.ids.next('ccp');
          const r = await sql<Row>`
            insert into customer_contact_point (id, tenant_id, customer_id, kind, value, value_hash, is_primary, created_by)
            values (${id}, ${tenantId}, ${customer.id}, ${input.kind}, ${value}, ${hash}, ${input.isPrimary}, ${ctx.principal.id})
            returning *`.execute(tx);
          await deps.audit.record(tx, ctx, {
            action: 'customer.contact_point_added',
            entityType: 'CUSTOMER',
            entityId: customer.id,
            after: { contactPointId: id, kind: input.kind, isPrimary: input.isPrimary },
            permissionUsed: 'customer.update',
          });
          await emit(deps, tx, ctx, 'customer.updated', customer.id, { contactPointId: id });
          return { status: 201, body: toContactPoint(r.rows[0]!), resourceRef: id };
        },
      ),
    );
    if (result.replayed) res.set('Idempotent-Replayed', 'true');
    res.status(result.status).json(result.body);
  });

  // API-CUST-008
  router.post('/customers/:id/merge', async (req, res) => {
    const ctx = requireCtx(req);
    const key = idempotencyKey(req);
    const input = CustomerMerge.parse(req.body);
    const result = await deps.txRunner.withTenantTx(ctx, (tx) =>
      withIdempotency(
        tx,
        ctx,
        { key, method: 'POST', path: `/v1/customers/${req.params.id}/merge`, body: input },
        async () => {
          const tenantId = ctx.principal.tenantId;
          // Locked in id order, so two merges of the same pair cannot deadlock.
          const [firstId, secondId] = [req.params.id, input.intoCustomerId].sort();
          const first = await repo.findCustomerByIdForUpdate(tx, tenantId, firstId!);
          const second = await repo.findCustomerByIdForUpdate(tx, tenantId, secondId!);
          const from = (first?.id === req.params.id ? first : second) as CustomerRow | null;
          const into = (first?.id === input.intoCustomerId ? first : second) as CustomerRow | null;
          requireCustomerAccess(ctx, 'lead.merge', from);
          if (input.intoCustomerId === from.id) {
            throw AppError.of('VALIDATION_ERROR', 'A customer cannot be merged into itself.', [
              { field: 'intoCustomerId', issue: 'SAME_CUSTOMER' },
            ]);
          }
          if (!into) {
            throw AppError.of('VALIDATION_ERROR', 'The surviving customer was not found.', [
              { field: 'intoCustomerId', issue: 'NOT_FOUND' },
            ]);
          }
          if (from.status !== 'ACTIVE' || into.status !== 'ACTIVE') {
            throw AppError.of('INVALID_STATE', 'Both customers must be active.');
          }
          if (from.party_type !== into.party_type) {
            throw AppError.of('VALIDATION_ERROR', 'An individual and an entity cannot be merged.', [
              { field: 'intoCustomerId', issue: 'PARTY_TYPE_MISMATCH' },
            ]);
          }
          // Contact points the survivor lacks are copied (never primary, so the survivor's primary stays).
          const copied = await sql`
          insert into customer_contact_point (id, tenant_id, customer_id, kind, value, value_hash, is_primary, verified_at, created_by)
          select 'ccp_' || new_ulid(), c.tenant_id, ${into.id}, c.kind, c.value, c.value_hash, false, c.verified_at, ${ctx.principal.id}
            from customer_contact_point c
           where c.customer_id = ${from.id}
             and not exists (select 1 from customer_contact_point s
                              where s.customer_id = ${into.id} and s.kind = c.kind and s.value_hash = c.value_hash)`.execute(
            tx,
          );
          await sql`
          update customer set status = 'MERGED', merged_into_id = ${into.id}, updated_by = ${ctx.principal.id}
           where id = ${from.id}`.execute(tx);
          const links = await sql<{ counts: Record<string, number> }>`
          select merge_customer_links(${from.id}, ${into.id}, ${ctx.principal.id}) as counts`.execute(tx);
          const counts = { ...links.rows[0]!.counts, contactPoints: Number(copied.numAffectedRows ?? 0) };
          await deps.audit.record(tx, ctx, {
            action: 'customer.merged',
            entityType: 'CUSTOMER',
            entityId: from.id,
            before: { status: 'ACTIVE' },
            after: { status: 'MERGED', mergedIntoId: into.id, moved: counts },
            reason: input.reason,
            permissionUsed: 'lead.merge',
          });
          await emit(deps, tx, ctx, 'customer.merged', from.id, { mergedIntoId: into.id, moved: counts });
          const body = { customerId: from.id, mergedIntoId: into.id, status: 'MERGED', moved: counts };
          return { status: 200, body, resourceRef: from.id };
        },
      ),
    );
    if (result.replayed) res.set('Idempotent-Replayed', 'true');
    res.status(result.status).json(result.body);
  });
}
