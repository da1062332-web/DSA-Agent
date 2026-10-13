// MOD-LND Lenders (owner: Dev 3; DSA Notion MODULE 14). Reads: any signed-in staff. Writes: config.manage (ROLE-TENANT-
// ADMIN, ROLE-ORG-OWNER). Every write is audited in the same transaction (Contracts §4.1).
//   API-LND-001 POST /v1/lenders (Idem)   API-LND-002 GET /v1/lenders   API-LND-003 PATCH /v1/lenders/{id} (If-Match)
//   API-LND-004 POST /v1/lenders/{id}/empanelments (Idem)   API-LND-005 PATCH /v1/empanelments/{id} (If-Match)
import { AppError, type Tx } from '@dsa/contracts';
import { withIdempotency } from '@dsa/kernel';
import type { Router } from 'express';
import { sql, type RawBuilder } from 'kysely';
import { idempotencyKey, ifMatchVersion, requireCtx, sendResource } from '../../../http/request';
import type { ApiDeps } from '../../types';
import { iso, keysetPage, loadForUpdate, updateVersioned, type Row } from './db';
import type { Empanelment, Lender } from './schemas';
import { EmpanelmentCreate, EmpanelmentPatch, LenderCreate, LenderPatch, ListQuery } from './schemas';

export const toLender = (r: Row): Lender => ({
  id: String(r.id),
  name: String(r.name),
  lenderType: r.lender_type as Lender['lenderType'],
  regulatorRef: (r.regulator_ref as string | null) ?? null,
  globalLenderRef: (r.global_lender_ref as string | null) ?? null,
  status: r.status as Lender['status'],
  statusReason: (r.status_reason as string | null) ?? null,
  version: Number(r.lock_version),
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

/** valid_range is stored inclusive ('[]'); an open end is an unbounded upper bound. */
export const toEmpanelment = (r: Row): Empanelment => ({
  id: String(r.id),
  lenderId: String(r.lender_id),
  dsaCode: String(r.dsa_code),
  validFrom: String(r.valid_from),
  validTo: (r.valid_to as string | null) ?? null,
  permittedCategories: r.permitted_categories as Empanelment['permittedCategories'],
  permittedGeos: (r.permitted_geos as string[] | null) ?? [],
  agreementDocumentId: (r.agreement_document_id as string | null) ?? null,
  status: r.status as Empanelment['status'],
  version: Number(r.lock_version),
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

const EMPANELMENT_VIEW = sql`(
  select e.*,
         lower(e.valid_range)::text as valid_from,
         case when upper_inf(e.valid_range) then null else (upper(e.valid_range) - 1)::text end as valid_to
    from empanelment e) x`;

const snapshotLender = (r: Row) => ({
  name: r.name,
  lenderType: r.lender_type,
  status: r.status,
  statusReason: r.status_reason,
});

/** The tenant's organisation that empanelments belong to (single organisation in the MVP). */
async function activeOrganisationId(tx: Tx): Promise<string> {
  const r = await sql<{
    id: string;
  }>`select id from organisation where status = 'ACTIVE' order by created_at limit 1`.execute(tx);
  const id = r.rows[0]?.id;
  if (!id) throw AppError.of('INVALID_STATE', 'The tenant has no active organisation.');
  return id;
}

export function registerLenderRoutes(router: Router, deps: ApiDeps): void {
  router.get('/lenders', async (req, res) => {
    const ctx = requireCtx(req);
    const q = ListQuery.parse(req.query);
    const page = await deps.txRunner.withTenantTx(ctx, (tx) =>
      keysetPage(tx, {
        from: sql`lender`,
        sortColumn: 'name',
        where: [
          ...(q.status ? [sql`status = ${q.status}`] : []),
          ...(q.type ? [sql`lender_type = ${q.type}`] : []),
          ...(q.q ? [sql`name ilike ${`%${q.q}%`}`] : []),
        ],
        limit: q.limit,
        cursor: q.cursor,
        map: toLender,
      }),
    );
    res.json(page);
  });

  router.get('/lenders/:id', async (req, res) => {
    const ctx = requireCtx(req);
    const row = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const r = await sql<Row>`select * from lender where id = ${req.params.id}`.execute(tx);
      return r.rows[0];
    });
    if (!row) throw AppError.of('NOT_FOUND', 'Lender not found.');
    sendResource(res, 200, toLender(row));
  });

  router.post('/lenders', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'config.manage');
    const key = idempotencyKey(req);
    const input = LenderCreate.parse(req.body);

    const result = await deps.txRunner.withTenantTx(ctx, (tx) =>
      withIdempotency(tx, ctx, { key, method: 'POST', path: '/v1/lenders', body: input }, async () => {
        const id = deps.ids.next('lnd');
        const r = await sql<Row>`
          insert into lender (id, tenant_id, name, lender_type, regulator_ref, global_lender_ref, created_by, updated_by)
          values (${id}, ${ctx.principal.tenantId}, ${input.name}, ${input.lenderType}, ${input.regulatorRef ?? null},
                  ${input.globalLenderRef ?? null}, ${ctx.principal.id}, ${ctx.principal.id})
          returning *`.execute(tx);
        const row = r.rows[0]!;
        await deps.audit.record(tx, ctx, {
          action: 'lender.created',
          entityType: 'LENDER',
          entityId: id,
          after: snapshotLender(row),
          permissionUsed: 'config.manage',
        });
        return { status: 201, body: toLender(row), resourceRef: id };
      }),
    );
    sendResource(res, result.status, result.body, result.replayed);
  });

  router.patch('/lenders/:id', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'config.manage');
    const version = ifMatchVersion(req);
    const input = LenderPatch.parse(req.body);

    const lender = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const current = await loadForUpdate(tx, 'lender', req.params.id, 'Lender');
      const updated = await updateVersioned(tx, ctx.principal.id, 'lender', current, version, {
        name: input.name,
        lender_type: input.lenderType,
        regulator_ref: input.regulatorRef,
        global_lender_ref: input.globalLenderRef,
        status: input.status,
        status_reason: input.status === 'ACTIVE' ? null : input.statusReason,
      });
      const action =
        input.status && input.status !== current.status ? 'lender.status_changed' : 'lender.updated';
      await deps.audit.record(tx, ctx, {
        action,
        entityType: 'LENDER',
        entityId: String(updated.id),
        before: snapshotLender(current),
        after: snapshotLender(updated),
        reason: input.statusReason ?? undefined,
        permissionUsed: 'config.manage',
      });
      return updated;
    });
    sendResource(res, 200, toLender(lender));
  });

  router.post('/lenders/:id/empanelments', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'config.manage');
    const key = idempotencyKey(req);
    const input = EmpanelmentCreate.parse(req.body);

    const result = await deps.txRunner.withTenantTx(ctx, (tx) =>
      withIdempotency(
        tx,
        ctx,
        { key, method: 'POST', path: `/v1/lenders/${req.params.id}/empanelments`, body: input },
        async () => {
          const lender = await loadForUpdate(tx, 'lender', req.params.id, 'Lender');
          if (lender.status === 'TERMINATED') {
            throw AppError.of('INVALID_STATE', 'A terminated lender cannot take new empanelments.');
          }
          const organisationId = await activeOrganisationId(tx);
          const id = deps.ids.next('emp');
          await sql`
            insert into empanelment (id, tenant_id, organisation_id, lender_id, dsa_code, valid_range, permitted_categories,
                                     permitted_geos, agreement_document_id, created_by, updated_by)
            values (${id}, ${ctx.principal.tenantId}, ${organisationId}, ${lender.id}, ${input.dsaCode},
                    daterange(${input.validFrom}::date, ${input.validTo ?? null}::date, '[]'),
                    ${input.permittedCategories}::text[], ${JSON.stringify(input.permittedGeos ?? [])}::jsonb,
                    ${input.agreementDocumentId ?? null}, ${ctx.principal.id}, ${ctx.principal.id})`.execute(
            tx,
          );
          const r = await sql<Row>`select * from ${EMPANELMENT_VIEW} where x.id = ${id}`.execute(tx);
          const row = r.rows[0]!;
          await deps.audit.record(tx, ctx, {
            action: 'empanelment.created',
            entityType: 'EMPANELMENT',
            entityId: id,
            after: {
              lenderId: lender.id,
              dsaCode: input.dsaCode,
              validFrom: input.validFrom,
              validTo: input.validTo ?? null,
            },
            permissionUsed: 'config.manage',
          });
          return { status: 201, body: toEmpanelment(row), resourceRef: id };
        },
      ),
    );
    sendResource(res, result.status, result.body, result.replayed);
  });

  // Read-only list of a lender's empanelments (any signed-in staff). Not in the spec's endpoint table; added for the
  // lender screen and documented in the OpenAPI registration.
  router.get('/lenders/:id/empanelments', async (req, res) => {
    const ctx = requireCtx(req);
    const rows = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const lender = await sql<{ id: string }>`select id from lender where id = ${req.params.id}`.execute(tx);
      if (!lender.rows[0]) throw AppError.of('NOT_FOUND', 'Lender not found.');
      const r = await sql<Row>`
        select x.* from ${EMPANELMENT_VIEW} where x.lender_id = ${req.params.id}
         order by x.dsa_code, x.id`.execute(tx);
      return r.rows;
    });
    res.json({ data: rows.map(toEmpanelment), meta: { nextCursor: null, limit: rows.length } });
  });

  router.patch('/empanelments/:id', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'config.manage');
    const version = ifMatchVersion(req);
    const input = EmpanelmentPatch.parse(req.body);

    const emp = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const current = await loadForUpdate(tx, 'empanelment', req.params.id, 'Empanelment');
      // A terminated empanelment is final: its end date has been set and it cannot come back.
      if (current.status === 'EXPIRED' && input.status !== undefined && input.status !== 'EXPIRED') {
        throw AppError.of('INVALID_TRANSITION', 'A terminated empanelment cannot be reactivated.', [
          { field: 'status', issue: 'TERMINATED_IS_FINAL' },
        ]);
      }
      // Terminating ends the empanelment today unless an end date is given.
      const today = ctx.now.toISOString().slice(0, 10);
      const endDate =
        input.validTo !== undefined ? input.validTo : input.status === 'EXPIRED' ? today : undefined;

      let validRange: RawBuilder<unknown> | undefined;
      if (endDate !== undefined) {
        // Keep the start date; only the end changes. One UPDATE, so the version moves exactly once.
        const r = await sql<{
          start: string;
        }>`select lower(valid_range)::text as start from empanelment where id = ${current.id}`.execute(tx);
        const start = r.rows[0]!.start;
        if (endDate && endDate < start) {
          throw AppError.of('VALIDATION_ERROR', 'validTo must not be before the start date.', [
            { field: 'validTo', issue: 'BEFORE_START' },
          ]);
        }
        validRange = sql`daterange(lower(valid_range), ${endDate || null}::date, '[]')`;
      }

      const statusChanged = input.status !== undefined && input.status !== current.status;
      const action = !statusChanged
        ? 'empanelment.updated'
        : input.status === 'SUSPENDED'
          ? 'empanelment.deactivated'
          : input.status === 'EXPIRED'
            ? 'empanelment.terminated'
            : 'empanelment.reactivated';
      const updated = await updateVersioned(tx, ctx.principal.id, 'empanelment', current, version, {
        valid_range: validRange,
        permitted_categories: input.permittedCategories
          ? sql`${input.permittedCategories}::text[]`
          : undefined,
        permitted_geos: input.permittedGeos ? sql`${JSON.stringify(input.permittedGeos)}::jsonb` : undefined,
        agreement_document_id: input.agreementDocumentId,
        status: input.status,
      });
      await deps.audit.record(tx, ctx, {
        action,
        entityType: 'EMPANELMENT',
        entityId: String(updated.id),
        before: { status: current.status, permittedCategories: current.permitted_categories },
        after: { status: updated.status, permittedCategories: updated.permitted_categories },
        reason: input.reason ?? undefined,
        permissionUsed: 'config.manage',
      });
      const r = await sql<Row>`select * from ${EMPANELMENT_VIEW} where x.id = ${updated.id}`.execute(tx);
      return r.rows[0]!;
    });
    sendResource(res, 200, toEmpanelment(emp));
  });
}
