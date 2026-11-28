// MOD-LND lender policy grid (owner: Dipanshu; task P1-04, migration M-120). One lender's credit policy for one product version,
// versioned DRAFT → ACTIVE → RETIRED, at most one ACTIVE per lender and product version (unique index lender_policy_one_active_uq).
//   GET   /v1/lender-policies                    lender_policy.read     list, allow-listed filters, cursor pagination
//   GET   /v1/lender-policies/{id}               lender_policy.read
//   POST  /v1/lender-policies (Idem)             lender_policy.manage   new DRAFT; version_no is the next for the pair
//   PATCH /v1/lender-policies/{id} (If-Match)    lender_policy.manage   DRAFT only; the caller joins editors
//   POST  /v1/lender-policies/{id}/transitions (If-Match)
//         ACTIVATE  rule.approve + step-up (aal2, ≤ 900 s) + SOD-01 (the approver is not an editor); retires the previous ACTIVE
//         RETIRE    lender_policy.manage; ACTIVE only
// Every write is audited, and activation and retirement emit an outbox event, in the same transaction (Contracts §4.1).
// No S3 data: a policy holds thresholds, never applicant data, so the audit snapshot is the policy terms.
import {
  AppError,
  LenderPolicyCreateSchema,
  LenderPolicyListQuerySchema,
  LenderPolicyPatchSchema,
  LenderPolicyTransitionSchema,
  type ErrorDetail,
  type LenderPolicy,
  type RequestContext,
  type Tx,
} from '@dsa/contracts';
import { withIdempotency } from '@dsa/kernel';
import type { Router } from 'express';
import { sql } from 'kysely';
import { idempotencyKey, ifMatchVersion, requireCtx, sendResource } from '../../../http/request';
import type { ApiDeps } from '../../types';
import { iso, keysetPage, loadForUpdate, updateVersioned, type Row } from './db';

const money = (v: unknown) => (v == null ? null : { amount: String(v), currency: 'INR' });
const isoOrNull = (v: unknown) => (v == null ? null : iso(v));

export const toLenderPolicy = (r: Row): LenderPolicy => ({
  id: String(r.id),
  lenderId: String(r.lender_id),
  productVersionId: String(r.product_version_id),
  status: r.status as LenderPolicy['status'],
  versionNo: Number(r.version_no),
  minBureauScore: (r.min_bureau_score as number | null) ?? null,
  minAge: (r.min_age as number | null) ?? null,
  maxAgeAtMaturity: (r.max_age_at_maturity as number | null) ?? null,
  minIncome: money(r.min_income),
  foirCapBps: (r.foir_cap_bps as number | null) ?? null,
  ltvCapBps: (r.ltv_cap_bps as number | null) ?? null,
  rateMinBps: Number(r.rate_min_bps),
  rateMaxBps: Number(r.rate_max_bps),
  processingFeeBps: (r.processing_fee_bps as number | null) ?? null,
  serviceablePincodes: (r.serviceable_pincodes as string[]) ?? [],
  allowedConstitutions: (r.allowed_constitutions as string[]) ?? [],
  allowedEmployment: (r.allowed_employment as LenderPolicy['allowedEmployment']) ?? [],
  minVintageMonths: (r.min_vintage_months as number | null) ?? null,
  documentProfileId: (r.document_profile_id as string | null) ?? null,
  effectiveFrom: iso(r.effective_from),
  effectiveTo: isoOrNull(r.effective_to),
  editors: (r.editors as string[]) ?? [],
  approvedBy: (r.approved_by as string | null) ?? null,
  approvedAt: isoOrNull(r.approved_at),
  retiredAt: isoOrNull(r.retired_at),
  version: Number(r.lock_version),
  createdAt: iso(r.created_at),
  createdBy: String(r.created_by),
  updatedAt: iso(r.updated_at),
  updatedBy: String(r.updated_by),
});

/** API field → column, for the terms a draft may change. */
const COLUMNS = {
  minBureauScore: 'min_bureau_score',
  minAge: 'min_age',
  maxAgeAtMaturity: 'max_age_at_maturity',
  minIncome: 'min_income',
  foirCapBps: 'foir_cap_bps',
  ltvCapBps: 'ltv_cap_bps',
  rateMinBps: 'rate_min_bps',
  rateMaxBps: 'rate_max_bps',
  processingFeeBps: 'processing_fee_bps',
  serviceablePincodes: 'serviceable_pincodes',
  allowedConstitutions: 'allowed_constitutions',
  allowedEmployment: 'allowed_employment',
  minVintageMonths: 'min_vintage_months',
  documentProfileId: 'document_profile_id',
  effectiveFrom: 'effective_from',
  effectiveTo: 'effective_to',
} as const;

/** The terms only (thresholds, never applicant data): what the audit trail records before and after. */
function terms(p: LenderPolicy): Record<string, unknown> {
  const t: Record<string, unknown> = { status: p.status, versionNo: p.versionNo };
  for (const field of Object.keys(COLUMNS) as (keyof typeof COLUMNS)[]) t[field] = p[field];
  return t;
}

/** A column value: money goes in as its rupee string; everything else as is. */
function columnValue(field: keyof typeof COLUMNS, v: unknown): unknown {
  if (field === 'minIncome') return v == null ? null : (v as { amount: string }).amount;
  return v;
}

/**
 * The cross-field rules on the merged draft, so a PATCH that sends one side of a pair still gets a 422 with the field
 * (the database CHECKs are the backstop).
 */
function crossFieldIssues(p: LenderPolicy): ErrorDetail[] {
  const issues: ErrorDetail[] = [];
  if (p.rateMaxBps < p.rateMinBps) issues.push({ field: 'rateMaxBps', issue: 'BELOW_RATE_MIN' });
  if (p.minAge != null && p.maxAgeAtMaturity != null && p.maxAgeAtMaturity < p.minAge)
    issues.push({ field: 'maxAgeAtMaturity', issue: 'BELOW_MIN_AGE' });
  if (p.effectiveTo && Date.parse(p.effectiveTo) <= Date.parse(p.effectiveFrom))
    issues.push({ field: 'effectiveTo', issue: 'NOT_AFTER_EFFECTIVE_FROM' });
  return issues;
}

/** The lender must exist in the tenant and not be terminated. Locks it, so two drafts cannot take the same version_no. */
async function lockOpenLender(tx: Tx, lenderId: string): Promise<void> {
  const r = await sql<{
    status: string;
  }>`select status from lender where id = ${lenderId} for update`.execute(tx);
  const status = r.rows[0]?.status;
  if (!status) throw AppError.of('NOT_FOUND', 'Lender not found.');
  if (status === 'TERMINATED') {
    throw AppError.of('INVALID_STATE', 'A policy cannot be added to a terminated lender.', [
      { field: 'lenderId', issue: 'LENDER_TERMINATED' },
    ]);
  }
}

/** The product version must exist in the tenant and belong to a product of this lender. */
async function requireLenderProductVersion(
  tx: Tx,
  lenderId: string,
  productVersionId: string,
): Promise<void> {
  const r = await sql<{ lender_id: string }>`
    select p.lender_id from loan_product_version v join loan_product p on p.id = v.product_id
     where v.id = ${productVersionId}`.execute(tx);
  const owner = r.rows[0]?.lender_id;
  if (!owner) throw AppError.of('NOT_FOUND', 'Product version not found.');
  if (owner !== lenderId) {
    throw AppError.of('VALIDATION_ERROR', 'The product version belongs to another lender.', [
      { field: 'productVersionId', issue: 'NOT_A_PRODUCT_OF_THIS_LENDER' },
    ]);
  }
}

async function emit(deps: ApiDeps, tx: Tx, ctx: RequestContext, type: string, p: LenderPolicy) {
  await deps.outboxPort?.emit(tx, ctx, {
    type,
    subject: { type: 'LENDER_POLICY', id: p.id },
    data: {
      policyId: p.id,
      lenderId: p.lenderId,
      productVersionId: p.productVersionId,
      versionNo: p.versionNo,
      status: p.status,
    },
  });
}

export function registerLenderPolicyRoutes(router: Router, deps: ApiDeps): void {
  router.get('/lender-policies', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'lender_policy.read');
    const q = LenderPolicyListQuerySchema.parse(req.query);
    const page = await deps.txRunner.withTenantTx(ctx, (tx) =>
      keysetPage(tx, {
        from: sql`lender_policy`,
        sortColumn: 'id',
        where: [
          ...(q.lenderId ? [sql`lender_id = ${q.lenderId}`] : []),
          ...(q.productVersionId ? [sql`product_version_id = ${q.productVersionId}`] : []),
          ...(q.status ? [sql`status = ${q.status}`] : []),
        ],
        limit: q.limit,
        cursor: q.cursor,
        map: toLenderPolicy,
      }),
    );
    res.json(page);
  });

  router.get('/lender-policies/:id', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'lender_policy.read');
    const row = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const r = await sql<Row>`select * from lender_policy where id = ${req.params.id}`.execute(tx);
      return r.rows[0];
    });
    if (!row) throw AppError.of('NOT_FOUND', 'Lender policy not found.');
    sendResource(res, 200, toLenderPolicy(row));
  });

  router.post('/lender-policies', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'lender_policy.manage');
    const key = idempotencyKey(req);
    const input = LenderPolicyCreateSchema.parse(req.body);

    const result = await deps.txRunner.withTenantTx(ctx, (tx) =>
      withIdempotency(
        tx,
        ctx,
        { key, method: 'POST', path: '/v1/lender-policies', body: input },
        async () => {
          await lockOpenLender(tx, input.lenderId);
          await requireLenderProductVersion(tx, input.lenderId, input.productVersionId);
          const n = await sql<{ n: number }>`
          select coalesce(max(version_no), 0)::int as n from lender_policy
           where lender_id = ${input.lenderId} and product_version_id = ${input.productVersionId}`.execute(
            tx,
          );
          const id = deps.ids.next('lpo');
          const r = await sql<Row>`
          insert into lender_policy (id, tenant_id, lender_id, product_version_id, status, version_no, min_bureau_score, min_age,
                                     max_age_at_maturity, min_income, foir_cap_bps, ltv_cap_bps, rate_min_bps, rate_max_bps,
                                     processing_fee_bps, serviceable_pincodes, allowed_constitutions, allowed_employment,
                                     min_vintage_months, document_profile_id, effective_from, effective_to, editors,
                                     created_by, updated_by)
          values (${id}, ${ctx.principal.tenantId}, ${input.lenderId}, ${input.productVersionId}, 'DRAFT', ${n.rows[0]!.n + 1},
                  ${input.minBureauScore}, ${input.minAge}, ${input.maxAgeAtMaturity},
                  ${input.minIncome?.amount ?? null}::numeric, ${input.foirCapBps}, ${input.ltvCapBps}, ${input.rateMinBps},
                  ${input.rateMaxBps}, ${input.processingFeeBps}, ${input.serviceablePincodes}::text[],
                  ${input.allowedConstitutions}::text[], ${input.allowedEmployment}::text[], ${input.minVintageMonths},
                  ${input.documentProfileId}, ${input.effectiveFrom}::timestamptz, ${input.effectiveTo}::timestamptz,
                  ${[ctx.principal.id]}::text[], ${ctx.principal.id}, ${ctx.principal.id})
          returning *`.execute(tx);
          const policy = toLenderPolicy(r.rows[0]!);
          await deps.audit.record(tx, ctx, {
            action: 'lender_policy.created',
            entityType: 'LENDER_POLICY',
            entityId: id,
            after: { lenderId: policy.lenderId, productVersionId: policy.productVersionId, ...terms(policy) },
            permissionUsed: 'lender_policy.manage',
          });
          return { status: 201, body: policy, resourceRef: id };
        },
      ),
    );
    sendResource(res, result.status, result.body, result.replayed);
  });

  router.patch('/lender-policies/:id', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'lender_policy.manage');
    const version = ifMatchVersion(req);
    const input = LenderPolicyPatchSchema.parse(req.body);

    const policy = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const current = await loadForUpdate(tx, 'lender_policy', req.params.id, 'Lender policy');
      if (current.status !== 'DRAFT') {
        throw AppError.of(
          'INVALID_STATE',
          'Only a draft can be edited. Create a new draft to change an active policy.',
          [{ field: 'status', issue: 'NOT_DRAFT', meta: { status: current.status } }],
        );
      }
      const before = toLenderPolicy(current);
      const issues = crossFieldIssues({ ...before, ...input } as LenderPolicy);
      if (issues.length) throw AppError.of('VALIDATION_ERROR', 'The policy terms are inconsistent.', issues);

      const changes: Record<string, unknown> = {};
      for (const [field, column] of Object.entries(COLUMNS) as [keyof typeof COLUMNS, string][]) {
        if (field in input) changes[column] = columnValue(field, input[field]);
      }
      const editors = before.editors.includes(ctx.principal.id)
        ? before.editors
        : [...before.editors, ctx.principal.id];
      changes.editors = editors;
      const updated = toLenderPolicy(
        await updateVersioned(tx, ctx.principal.id, 'lender_policy', current, version, changes),
      );
      await deps.audit.record(tx, ctx, {
        action: 'lender_policy.updated',
        entityType: 'LENDER_POLICY',
        entityId: updated.id,
        before: terms(before),
        after: terms(updated),
        permissionUsed: 'lender_policy.manage',
      });
      return updated;
    });
    sendResource(res, 200, policy);
  });

  router.post('/lender-policies/:id/transitions', async (req, res) => {
    const ctx = requireCtx(req);
    const { action } = LenderPolicyTransitionSchema.parse(req.body);
    if (action === 'ACTIVATE') {
      deps.authz.requirePermission(ctx, 'rule.approve');
      deps.authz.requireStepUp(ctx, 900);
    } else {
      deps.authz.requirePermission(ctx, 'lender_policy.manage');
    }
    const version = ifMatchVersion(req);

    const policy = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const current = await loadForUpdate(tx, 'lender_policy', req.params.id, 'Lender policy');
      const before = toLenderPolicy(current);
      const from = before.status;

      if (action === 'RETIRE') {
        if (from !== 'ACTIVE') {
          throw AppError.of(
            'INVALID_TRANSITION',
            `Only an active policy can be retired; this one is ${from}.`,
          );
        }
        const retired = toLenderPolicy(
          await updateVersioned(tx, ctx.principal.id, 'lender_policy', current, version, {
            status: 'RETIRED',
            retired_at: ctx.now,
          }),
        );
        await deps.audit.record(tx, ctx, {
          action: 'lender_policy.retired',
          entityType: 'LENDER_POLICY',
          entityId: retired.id,
          before: { status: from },
          after: { status: retired.status },
          permissionUsed: 'lender_policy.manage',
        });
        await emit(deps, tx, ctx, 'lender_policy.retired', retired);
        return retired;
      }

      // ACTIVATE: maker-checker.
      if (from !== 'DRAFT') {
        throw AppError.of('INVALID_TRANSITION', `Only a draft can be activated; this one is ${from}.`);
      }
      // Checked before SOD so a stale screen gets the usual 409, not a misleading refusal.
      if (current.lock_version !== version) {
        throw AppError.of(
          'VERSION_CONFLICT',
          'The record was changed by someone else. Reload and try again.',
          [{ field: 'If-Match', issue: 'STALE', meta: { currentVersion: current.lock_version } }],
        );
      }
      if (before.editors.includes(ctx.principal.id)) {
        throw AppError.of(
          'SOD_VIOLATION',
          'You drafted or edited this policy, so someone else must activate it (SOD-01).',
          [{ field: 'approvedBy', issue: 'APPROVER_IS_EDITOR' }],
        );
      }
      if (before.effectiveTo && Date.parse(before.effectiveTo) <= ctx.now.getTime()) {
        throw AppError.of(
          'INVALID_STATE',
          'The policy has already ended; change its end date before activating.',
          [{ field: 'effectiveTo', issue: 'IN_THE_PAST' }],
        );
      }

      // The one-active index means the previous ACTIVE version must be retired first, in the same transaction.
      const superseded = await sql<Row>`
        update lender_policy set status = 'RETIRED', retired_at = ${ctx.now}, updated_by = ${ctx.principal.id}
         where lender_id = ${before.lenderId} and product_version_id = ${before.productVersionId}
           and status = 'ACTIVE' and id <> ${before.id}
        returning *`.execute(tx);
      for (const row of superseded.rows) {
        const old = toLenderPolicy(row);
        await deps.audit.record(tx, ctx, {
          action: 'lender_policy.retired',
          entityType: 'LENDER_POLICY',
          entityId: old.id,
          before: { status: 'ACTIVE' },
          after: { status: 'RETIRED', supersededBy: before.id },
          permissionUsed: 'rule.approve',
        });
        await emit(deps, tx, ctx, 'lender_policy.retired', old);
      }

      const activated = toLenderPolicy(
        await updateVersioned(tx, ctx.principal.id, 'lender_policy', current, version, {
          status: 'ACTIVE',
          approved_by: ctx.principal.id,
          approved_at: ctx.now,
        }),
      );
      await deps.audit.record(tx, ctx, {
        action: 'lender_policy.activated',
        entityType: 'LENDER_POLICY',
        entityId: activated.id,
        before: { status: from },
        after: {
          status: activated.status,
          versionNo: activated.versionNo,
          supersedes: superseded.rows.map((r) => r.id),
        },
        permissionUsed: 'rule.approve',
      });
      await emit(deps, tx, ctx, 'lender_policy.activated', activated);
      return activated;
    });
    sendResource(res, 200, policy);
  });
}
