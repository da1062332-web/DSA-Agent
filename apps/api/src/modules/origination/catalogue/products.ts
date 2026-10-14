// MOD-PRD Products (owner: Dev 3; DSA Notion MODULE 15). Reads: any signed-in staff. Writes: config.manage
// (ROLE-TENANT-ADMIN, ROLE-ORG-OWNER). Every write is audited in the same transaction (Contracts §4.1).
//   API-PRD-001 POST /v1/products (Idem)           API-PRD-002 GET /v1/products
//   API-PRD-005 POST /v1/products/{id}/status      API-PRD-003 POST /v1/products/{id}/versions (Idem)
//   API-PRD-004 GET /v1/product-versions/{id}
// Plus two reads for the product screen: GET /v1/products/{id} and GET /v1/products/{id}/versions.
// A version's terms are immutable (the database guard in migration 0020). A change is a new version. The
// version in force is the ACTIVE one with the latest effective date that has been reached.
import { AppError, type Tx } from '@dsa/contracts';
import { withIdempotency } from '@dsa/kernel';
import type { Response, Router } from 'express';
import { sql } from 'kysely';
import { idempotencyKey, ifMatchVersion, requireCtx, sendResource } from '../../../http/request';
import type { ApiDeps } from '../../types';
import { iso, keysetPage, loadForUpdate, updateVersioned, type Row } from './db';
import {
  ProductCreate,
  ProductListQuery,
  ProductPatch,
  ProductStatusChange,
  ProductVersionCreate,
} from './products-schemas';

export const toProduct = (r: Row) => ({
  id: String(r.id),
  lenderId: String(r.lender_id),
  name: String(r.name),
  category: String(r.category),
  applicantTypes: r.applicant_types as string[],
  secured: Boolean(r.secured),
  ownerUserId: (r.owner_user_id as string | null) ?? null,
  nextReviewAt: r.next_review_at ? String(r.next_review_at).slice(0, 10) : null,
  status: String(r.status),
  version: Number(r.lock_version),
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

export const toVersion = (r: Row) => ({
  id: String(r.id),
  productId: String(r.product_id),
  versionNo: Number(r.version_no),
  effectiveFrom: iso(r.effective_from),
  amountMin: String(r.amount_min),
  amountMax: String(r.amount_max),
  currency: String(r.currency),
  tenureMinMonths: Number(r.tenure_min_months),
  tenureMaxMonths: Number(r.tenure_max_months),
  illustrativeRateText: (r.illustrative_rate_text as string | null) ?? null,
  feeText: (r.fee_text as string | null) ?? null,
  geoRules: (r.geo_rules as unknown[]) ?? [],
  documentProfileId: (r.document_profile_id as string | null) ?? null,
  workflowProfile: (r.workflow_profile as Record<string, unknown>) ?? {},
  eligibilityScope: (r.eligibility_scope as Record<string, unknown>) ?? {},
  status: String(r.status),
  isCurrent: Boolean(r.is_current),
  createdAt: iso(r.created_at),
});

/** Every version with its "in force" flag (the one ACTIVE version with the latest effective date already reached). */
const VERSION_VIEW = sql`(
  select v.*,
         (v.status = 'ACTIVE' and v.effective_from <= now() and v.effective_from = (
            select max(p.effective_from) from loan_product_version p
             where p.product_id = v.product_id and p.status = 'ACTIVE' and p.effective_from <= now())) as is_current
    from loan_product_version v) x`;

/** Versions have no lock_version (they are immutable), so they are returned without an ETag. */
function sendVersion(res: Response, status: number, body: unknown, replayed = false) {
  if (replayed) res.set('Idempotent-Replayed', 'true');
  res.status(status).json(body);
}

const snapshotProduct = (r: Row) => ({
  name: r.name,
  category: r.category,
  status: r.status,
  ownerUserId: r.owner_user_id,
});

const snapshotDetails = (r: Row) => ({
  name: r.name,
  category: r.category,
  applicantTypes: r.applicant_types,
  secured: r.secured,
  ownerUserId: r.owner_user_id ?? null,
  nextReviewAt: r.next_review_at ? String(r.next_review_at).slice(0, 10) : null,
});

async function requireActiveOwner(tx: Tx, userId: string): Promise<void> {
  const u = await sql<{
    id: string;
  }>`select id from app_user where id = ${userId} and status = 'ACTIVE'`.execute(tx);
  if (!u.rows[0]) {
    throw AppError.of('VALIDATION_ERROR', 'The owner must be an active user of this tenant.', [
      { field: 'ownerUserId', issue: 'USER_NOT_ACTIVE' },
    ]);
  }
}

async function requireLenderOpen(tx: Tx, lenderId: string): Promise<void> {
  const r = await sql<{ status: string }>`select status from lender where id = ${lenderId}`.execute(tx);
  const status = r.rows[0]?.status;
  if (!status) throw AppError.of('NOT_FOUND', 'Lender not found.');
  if (status === 'TERMINATED') {
    throw AppError.of('INVALID_STATE', 'Products cannot be added to a terminated lender.', [
      { field: 'lenderId', issue: 'LENDER_TERMINATED' },
    ]);
  }
}

export function registerProductRoutes(router: Router, deps: ApiDeps): void {
  router.get('/products', async (req, res) => {
    const ctx = requireCtx(req);
    const q = ProductListQuery.parse(req.query);
    const page = await deps.txRunner.withTenantTx(ctx, (tx) =>
      keysetPage(tx, {
        from: sql`loan_product`,
        sortColumn: 'name',
        where: [
          ...(q.lenderId ? [sql`lender_id = ${q.lenderId}`] : []),
          ...(q.status ? [sql`status = ${q.status}`] : []),
          ...(q.category ? [sql`category = ${q.category}`] : []),
          ...(q.q ? [sql`name ilike ${`%${q.q}%`}`] : []),
        ],
        limit: q.limit,
        cursor: q.cursor,
        map: toProduct,
      }),
    );
    res.json(page);
  });

  router.get('/products/:id', async (req, res) => {
    const ctx = requireCtx(req);
    const row = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const r = await sql<Row>`select * from loan_product where id = ${req.params.id}`.execute(tx);
      return r.rows[0];
    });
    if (!row) throw AppError.of('NOT_FOUND', 'Product not found.');
    sendResource(res, 200, toProduct(row));
  });

  router.get('/products/:id/versions', async (req, res) => {
    const ctx = requireCtx(req);
    const rows = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const exists = await sql<{
        id: string;
      }>`select id from loan_product where id = ${req.params.id}`.execute(tx);
      if (!exists.rows[0]) throw AppError.of('NOT_FOUND', 'Product not found.');
      const r = await sql<Row>`
        select x.* from ${VERSION_VIEW} where x.product_id = ${req.params.id}
         order by x.version_no desc`.execute(tx);
      return r.rows;
    });
    res.json({ data: rows.map(toVersion), meta: { nextCursor: null, limit: rows.length } });
  });

  router.post('/products', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'config.manage');
    const key = idempotencyKey(req);
    const input = ProductCreate.parse(req.body);

    const result = await deps.txRunner.withTenantTx(ctx, (tx) =>
      withIdempotency(tx, ctx, { key, method: 'POST', path: '/v1/products', body: input }, async () => {
        await requireLenderOpen(tx, input.lenderId);
        if (input.ownerUserId) await requireActiveOwner(tx, input.ownerUserId);
        const id = deps.ids.next('prd');
        const r = await sql<Row>`
          insert into loan_product (id, tenant_id, lender_id, name, category, applicant_types, secured, owner_user_id,
                                    next_review_at, created_by, updated_by)
          values (${id}, ${ctx.principal.tenantId}, ${input.lenderId}, ${input.name}, ${input.category},
                  ${input.applicantTypes}::text[], ${input.secured}, ${input.ownerUserId ?? null},
                  ${input.nextReviewAt ?? null}::date, ${ctx.principal.id}, ${ctx.principal.id})
          returning *`.execute(tx);
        const row = r.rows[0]!;
        await deps.audit.record(tx, ctx, {
          action: 'product.created',
          entityType: 'PRODUCT',
          entityId: id,
          after: snapshotProduct(row),
          permissionUsed: 'config.manage',
        });
        return { status: 201, body: toProduct(row), resourceRef: id };
      }),
    );
    sendResource(res, result.status, result.body, result.replayed);
  });

  // Basic details only. Versions are untouched: their terms are fixed, and a product has no delete route.
  router.patch('/products/:id', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'config.manage');
    const version = ifMatchVersion(req);
    const input = ProductPatch.parse(req.body);

    const product = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const current = await loadForUpdate(tx, 'loan_product', req.params.id, 'Product');
      if (input.ownerUserId) await requireActiveOwner(tx, input.ownerUserId);
      const updated = await updateVersioned(tx, ctx.principal.id, 'loan_product', current, version, {
        name: input.name,
        category: input.category,
        applicant_types: input.applicantTypes,
        secured: input.secured,
        owner_user_id: input.ownerUserId,
        next_review_at: input.nextReviewAt,
      });
      await deps.audit.record(tx, ctx, {
        action: 'product.updated',
        entityType: 'PRODUCT',
        entityId: String(updated.id),
        before: snapshotDetails(current),
        after: snapshotDetails(updated),
        permissionUsed: 'config.manage',
      });
      return updated;
    });
    sendResource(res, 200, toProduct(product));
  });

  router.post('/products/:id/status', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'config.manage');
    const version = ifMatchVersion(req);
    const input = ProductStatusChange.parse(req.body);

    const product = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const current = await loadForUpdate(tx, 'loan_product', req.params.id, 'Product');
      if (current.status === input.status) {
        throw AppError.of('INVALID_TRANSITION', `The product is already ${input.status}.`);
      }
      const updated = await updateVersioned(tx, ctx.principal.id, 'loan_product', current, version, {
        status: input.status,
      });
      await deps.audit.record(tx, ctx, {
        action: input.status === 'ACTIVE' ? 'product.activated' : 'product.deactivated',
        entityType: 'PRODUCT',
        entityId: String(updated.id),
        before: { status: current.status },
        after: { status: updated.status },
        reason: input.reason ?? undefined,
        permissionUsed: 'config.manage',
      });
      return updated;
    });
    sendResource(res, 200, toProduct(product));
  });

  router.post('/products/:id/versions', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'config.manage');
    const key = idempotencyKey(req);
    const input = ProductVersionCreate.parse(req.body);

    const result = await deps.txRunner.withTenantTx(ctx, (tx) =>
      withIdempotency(
        tx,
        ctx,
        { key, method: 'POST', path: `/v1/products/${req.params.id}/versions`, body: input },
        async () => {
          // Lock the product so two versions cannot take the same number.
          const product = await loadForUpdate(tx, 'loan_product', req.params.id, 'Product');
          if (product.status !== 'ACTIVE') {
            throw AppError.of('INVALID_STATE', 'A new version can only be added to an active product.');
          }
          const latest = await sql<{ n: number; latest: Date | null }>`
            select coalesce(max(version_no), 0)::int as n, max(effective_from) as latest
              from loan_product_version where product_id = ${product.id}`.execute(tx);
          const { n, latest: latestFrom } = latest.rows[0]!;

          const effectiveFrom = input.effectiveFrom ? new Date(input.effectiveFrom) : ctx.now;
          if (latestFrom && effectiveFrom.getTime() <= new Date(latestFrom).getTime()) {
            throw AppError.of(
              'VALIDATION_ERROR',
              'The new version must take effect after the current latest version.',
              [{ field: 'effectiveFrom', issue: 'NOT_AFTER_LATEST', meta: { latest: iso(latestFrom) } }],
            );
          }

          const id = deps.ids.next('prv');
          await sql`
            insert into loan_product_version (id, tenant_id, product_id, version_no, effective_from, amount_min, amount_max,
                                              currency, tenure_min_months, tenure_max_months, illustrative_rate_text,
                                              fee_text, geo_rules, document_profile_id, workflow_profile,
                                              eligibility_scope, created_by)
            values (${id}, ${ctx.principal.tenantId}, ${product.id}, ${n + 1}, ${effectiveFrom.toISOString()}::timestamptz,
                    ${input.amountMin}::numeric, ${input.amountMax}::numeric, ${input.currency},
                    ${input.tenureMinMonths}, ${input.tenureMaxMonths}, ${input.illustrativeRateText ?? null},
                    ${input.feeText ?? null}, ${JSON.stringify(input.geoRules ?? [])}::jsonb,
                    ${input.documentProfileId ?? null}, ${JSON.stringify(input.workflowProfile ?? {})}::jsonb,
                    ${JSON.stringify(input.eligibilityScope ?? {})}::jsonb, ${ctx.principal.id})`.execute(tx);

          // Once this version is in force, the earlier ones it replaces are retired. A future-dated version does not
          // retire the version in force today, so there is no gap. Only the status changes; the guard allows that.
          const retired =
            effectiveFrom.getTime() <= ctx.now.getTime()
              ? await sql<{ n: string }>`
                with r as (
                  update loan_product_version set status = 'RETIRED'
                   where product_id = ${product.id} and status = 'ACTIVE' and effective_from < ${effectiveFrom.toISOString()}::timestamptz
                  returning 1)
                select count(*)::text as n from r`.execute(tx)
              : { rows: [{ n: '0' }] };

          const row = (await sql<Row>`select * from ${VERSION_VIEW} where x.id = ${id}`.execute(tx)).rows[0]!;
          await deps.audit.record(tx, ctx, {
            action: 'product.version_created',
            entityType: 'PRODUCT',
            entityId: String(product.id),
            after: {
              versionNo: n + 1,
              amountMin: input.amountMin,
              amountMax: input.amountMax,
              tenureMinMonths: input.tenureMinMonths,
              tenureMaxMonths: input.tenureMaxMonths,
              retiredVersions: Number(retired.rows[0]?.n ?? 0),
            },
            permissionUsed: 'config.manage',
          });
          return { status: 201, body: toVersion(row), resourceRef: id };
        },
      ),
    );
    sendVersion(res, result.status, result.body, result.replayed);
  });

  router.get('/product-versions/:id', async (req, res) => {
    const ctx = requireCtx(req);
    const row = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const r = await sql<Row>`select * from ${VERSION_VIEW} where x.id = ${req.params.id}`.execute(tx);
      return r.rows[0];
    });
    if (!row) throw AppError.of('NOT_FOUND', 'Product version not found.');
    res.json(toVersion(row));
  });
}
