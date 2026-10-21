// apps/api/src/modules/crm/leads/lead-extras.ts — owner: Dev 5 (MOD-LEAD). The lead APIs beyond capture, edit, transitions,
// assignment and conversion (M-074):
//   API-LEAD-010 POST /v1/apply-links                        lead.create (branch or tenant); Idempotency-Key
//   API-LEAD-011 POST /public/v1/apply/{token}               the public enquiry form; link token; honeypot and rate limit
//   API-LEAD-008 GET  /v1/duplicate-reviews                  lead.merge; cursor
//   API-LEAD-009 POST /v1/duplicate-reviews/{id}/resolution  lead.merge; Idempotency-Key; MERGE or DISMISS
//   API-LEAD-012 POST /v1/leads/{id}/reroute                 lead.assign; If-Match; Idempotency-Key; re-runs DK-lead.assignment
//   API-LEAD-013 POST /v1/leads/bulk-assignments            lead.assign; Idempotency-Key; up to 200, all or nothing
//   API-LEAD-014 POST /v1/leads/{id}/restore                 lead.archive; If-Match; back to the state it was archived from
// Every change writes the lead history, an outbox event and an audit event in the same transaction.
import crypto from 'node:crypto';
import { AppError, type PermissionCode, type RequestContext, type Tx } from '@dsa/contracts';
import { withIdempotency } from '@dsa/kernel';
import express, { type Router } from 'express';
import { sql } from 'kysely';
import { z } from 'zod';
import {
  decodeCursor,
  encodeCursor,
  idempotencyKey,
  ifMatchVersion,
  requireCtx,
  sendResource,
} from '../../../http/request';
import { rateLimit } from '../../../http/rate-limit';
import type { ApiDeps } from '../../types';
import { isLeadInScope, requireLeadAccess, requirePermission } from './authz-helper';
import type { LeadService } from './lead-service';
import type { LeadRepository, LeadRow } from './repository';
import { CreateLeadInputSchema } from './types';

type Row = Record<string, unknown>;
const OPEN_STATES = ['NEW', 'CONTACT_ATTEMPTED', 'IN_PROGRESS', 'QUALIFIED'];
const CATEGORIES = ['PL', 'BL', 'MSME', 'LAP', 'HL', 'VL', 'GL', 'EL', 'OTHER'] as const;
const NO_S3 = [/[A-Z]{5}[0-9]{4}[A-Z]/i, /\b\d{4}\s?\d{4}\s?\d{4}\b/, /\b\d{9,18}\b/];
const safeText = (max: number) =>
  z
    .string()
    .trim()
    .min(3)
    .max(max)
    .refine((s) => !NO_S3.some((p) => p.test(s)), 'must not contain identity or account numbers');

export const ApplyLinkCreate = z
  .object({
    branchId: z.string().min(3).max(64),
    productCategory: z.enum(CATEGORIES).optional(),
    campaign: safeText(100).optional(),
    employeeId: z.string().min(3).max(64).optional(),
    noticeVersion: z.string().regex(/^[A-Za-z0-9._-]{2,40}$/),
    expiresAt: z.string().datetime(),
  })
  .strict();

export const PublicApplySubmission = z
  .object({
    fullName: z.string().trim().min(2).max(200),
    mobile: z.string().min(8).max(25),
    email: z.string().email().optional(),
    pincode: z
      .string()
      .regex(/^[1-9][0-9]{5}$/)
      .optional(),
    productCategory: z.enum(CATEGORIES).optional(),
    indicativeAmount: z
      .object({ amount: z.string().regex(/^\d{1,16}(\.\d{1,2})?$/), currency: z.literal('INR') })
      .optional(),
    consentGiven: z.literal(true),
    /** Honeypot: hidden in the form, so a person leaves it empty. */
    website: z.string().max(0).optional(),
  })
  .strict();

export const DuplicateReviewQuery = z.object({
  status: z.enum(['OPEN', 'MERGED', 'DISMISSED']).default('OPEN'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

export const DuplicateResolution = z
  .object({
    action: z.enum(['MERGE', 'DISMISS']),
    /** For MERGE: the lead that stays. The other one becomes MERGED. Default: the older lead. */
    survivorId: z.string().min(3).max(64).optional(),
    reason: safeText(200),
  })
  .strict();

export const LeadReroute = z.object({ reason: safeText(200).optional() }).strict();

export const BulkLeadAssignment = z
  .object({
    leadIds: z.array(z.string().min(3).max(64)).min(1).max(200),
    toUserId: z.string().min(3).max(64).nullable().optional(),
    toQueueId: z.string().min(3).max(64).nullable().optional(),
    reasonCode: z.enum(['MANUAL', 'REBALANCE', 'OWNER_INACTIVE']).default('MANUAL'),
    transferOpenTasks: z.boolean().optional(),
  })
  .strict()
  .refine((b) => (b.toUserId == null) !== (b.toQueueId == null), {
    message: 'Exactly one of toUserId or toQueueId',
  })
  .refine((b) => new Set(b.leadIds).size === b.leadIds.length, { message: 'leadIds must be distinct' });

export const LeadRestore = z.object({ reason: safeText(200) }).strict();

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

async function emit(
  deps: ApiDeps,
  tx: Tx,
  ctx: RequestContext,
  eventType: string,
  subjectId: string,
  payload: object,
) {
  await sql`
    insert into outbox_event (id, tenant_id, event_type, event_version, subject_type, subject_id, payload,
                              correlation_id, chain_depth, created_at)
    values (${deps.ids.next('evt')}, ${ctx.principal.tenantId}, ${eventType}, 1, 'LEAD', ${subjectId},
            ${JSON.stringify(payload)}::jsonb, ${ctx.correlationId}, 0, ${ctx.now})`.execute(tx);
}

async function history(
  deps: ApiDeps,
  tx: Tx,
  ctx: RequestContext,
  lead: LeadRow,
  to: string,
  code: string,
  reason: string | null,
) {
  await sql`
    insert into lead_status_history (id, tenant_id, lead_id, from_state, to_state, transition_code, reason_code, actor, occurred_at)
    values (${deps.ids.next('lsh')}, ${ctx.principal.tenantId}, ${lead.id}, ${lead.state}, ${to}, ${code}, ${reason},
            ${ctx.principal.id}, ${ctx.now})`.execute(tx);
}

/** A lead the caller may act on with `code`: 404 when unknown or out of scope, 403 without the permission. */
async function leadFor(
  repo: LeadRepository,
  tx: Tx,
  ctx: RequestContext,
  id: string,
  code: PermissionCode,
): Promise<LeadRow> {
  const lead = await repo.findLeadByIdForUpdate(tx, ctx.principal.tenantId, id);
  requireLeadAccess(ctx, code, lead);
  return lead;
}

function checkVersion(lead: LeadRow, version: number): void {
  if (lead.lock_version !== version) {
    throw AppError.of('VERSION_CONFLICT', 'The lead was changed by someone else. Reload and try again.', [
      { field: 'If-Match', issue: 'STALE', meta: { currentVersion: lead.lock_version } },
    ]);
  }
}

function requireBranch(ctx: RequestContext, code: PermissionCode, branchId: string): void {
  const grants = ctx.principal.grants.filter((g) => g.code === code);
  const ok = grants.some(
    (g) =>
      g.scope === 'TENANT' ||
      (g.scope === 'BRANCH' &&
        (g.branchIds.includes(branchId) || ctx.principal.primaryBranchId === branchId)),
  );
  if (!ok) {
    throw AppError.of('FORBIDDEN', 'You do not have permission for this action.', [
      { issue: grants.length ? 'OUT_OF_BRANCH_SCOPE' : 'PERMISSION_MISSING', meta: { permission: code } },
    ]);
  }
}

const toReview = (r: Row) => ({
  id: String(r.id),
  leftId: String(r.left_id),
  rightId: String(r.right_id),
  classification: String(r.classification),
  status: String(r.status),
  resolution: (r.resolution as string | null) ?? null,
  survivorId: (r.survivor_id as string | null) ?? null,
  resolvedBy: (r.resolved_by as string | null) ?? null,
  resolvedAt: r.resolved_at ? new Date(String(r.resolved_at)).toISOString() : null,
  version: Number(r.lock_version),
  createdAt: new Date(String(r.created_at)).toISOString(),
});

export function registerLeadExtraRoutes(
  router: Router,
  deps: ApiDeps,
  service: LeadService,
  repo: LeadRepository,
): void {
  // API-LEAD-010
  router.post('/apply-links', async (req, res) => {
    const ctx = requireCtx(req);
    requirePermission(ctx, 'lead.create');
    const key = idempotencyKey(req);
    const input = ApplyLinkCreate.parse(req.body);
    requireBranch(ctx, 'lead.create', input.branchId);
    if (new Date(input.expiresAt).getTime() <= ctx.now.getTime()) {
      throw AppError.of('VALIDATION_ERROR', 'The link must expire in the future.', [
        { field: 'expiresAt', issue: 'PAST' },
      ]);
    }
    const result = await deps.txRunner.withTenantTx(ctx, (tx) =>
      withIdempotency(tx, ctx, { key, method: 'POST', path: '/v1/apply-links', body: input }, async () => {
        const branch =
          await sql`select 1 from branch where id = ${input.branchId} and status = 'ACTIVE'`.execute(tx);
        if (!branch.rows.length) {
          throw AppError.of('VALIDATION_ERROR', 'The branch must be active.', [
            { field: 'branchId', issue: 'NOT_ACTIVE' },
          ]);
        }
        if (input.employeeId) {
          const u =
            await sql`select 1 from app_user where id = ${input.employeeId} and status = 'ACTIVE'`.execute(
              tx,
            );
          if (!u.rows.length) {
            throw AppError.of('VALIDATION_ERROR', 'The employee must be an active user.', [
              { field: 'employeeId', issue: 'NOT_ACTIVE' },
            ]);
          }
        }
        // The token is shown once; only its hash is stored, so a database read cannot recreate a working link.
        const token = crypto.randomBytes(24).toString('base64url');
        const id = deps.ids.next('apl');
        await sql`
          insert into apply_link (id, tenant_id, token_hash, branch_id, product_category, campaign, employee_id, notice_version,
                                  expires_at, created_by, updated_by)
          values (${id}, ${ctx.principal.tenantId}, ${sha256(token)}, ${input.branchId}, ${input.productCategory ?? null},
                  ${input.campaign ?? null}, ${input.employeeId ?? null}, ${input.noticeVersion}, ${input.expiresAt},
                  ${ctx.principal.id}, ${ctx.principal.id})`.execute(tx);
        await deps.audit.record(tx, ctx, {
          action: 'apply_link.created',
          entityType: 'APPLY_LINK',
          entityId: id,
          after: { branchId: input.branchId, campaign: input.campaign ?? null, expiresAt: input.expiresAt },
          permissionUsed: 'lead.create',
        });
        const body = {
          id,
          url: `/public/v1/apply/${token}`,
          branchId: input.branchId,
          productCategory: input.productCategory ?? null,
          campaign: input.campaign ?? null,
          expiresAt: new Date(input.expiresAt).toISOString(),
          version: 0,
        };
        return { status: 201, body, resourceRef: id };
      }),
    );
    // A replay returns the stored response, which carries the same one-time URL to the same caller.
    sendResource(res, result.status, result.body, result.replayed);
  });

  // API-LEAD-008
  router.get('/duplicate-reviews', async (req, res) => {
    const ctx = requireCtx(req);
    requirePermission(ctx, 'lead.merge');
    const q = DuplicateReviewQuery.parse(req.query);
    const after = decodeCursor(q.cursor);
    const page = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const r = await sql<Row>`
        select d.*, l.branch_id, l.owner_user_id, l.owner_queue_id, l.tenant_id as lead_tenant_id
          from duplicate_review d join lead l on l.id = d.right_id
         where d.status = ${q.status} ${after ? sql`and (d.created_at::text, d.id) > (${after.k}, ${after.id})` : sql``}
         order by d.created_at::text, d.id
         limit ${q.limit * 4 + 1}`.execute(tx);
      // Scope follows the newer lead of the pair (RB: lead.merge is branch or tenant).
      const visible = r.rows.filter((row) =>
        isLeadInScope(ctx, 'lead.merge', {
          tenant_id: String(row.lead_tenant_id),
          branch_id: String(row.branch_id),
          owner_user_id: (row.owner_user_id as string | null) ?? null,
          owner_queue_id: (row.owner_queue_id as string | null) ?? null,
        } as LeadRow),
      );
      const rows = visible.slice(0, q.limit);
      const last = rows[rows.length - 1];
      const more = visible.length > q.limit || r.rows.length > q.limit * 4;
      return {
        data: rows.map(toReview),
        meta: {
          nextCursor:
            more && last
              ? encodeCursor(new Date(String(last.created_at)).toISOString(), String(last.id))
              : null,
          limit: q.limit,
        },
      };
    });
    res.json(page);
  });

  // API-LEAD-009
  router.post('/duplicate-reviews/:id/resolution', async (req, res) => {
    const ctx = requireCtx(req);
    requirePermission(ctx, 'lead.merge');
    const key = idempotencyKey(req);
    const input = DuplicateResolution.parse(req.body);
    const result = await deps.txRunner.withTenantTx(ctx, (tx) =>
      withIdempotency(
        tx,
        ctx,
        { key, method: 'POST', path: `/v1/duplicate-reviews/${req.params.id}/resolution`, body: input },
        async () => {
          const r =
            await sql<Row>`select * from duplicate_review where id = ${req.params.id} for update`.execute(tx);
          const review = r.rows[0];
          if (!review) throw AppError.of('NOT_FOUND', 'Duplicate review not found.');
          const left = await repo.findLeadByIdForUpdate(tx, ctx.principal.tenantId, String(review.left_id));
          const right = await repo.findLeadByIdForUpdate(tx, ctx.principal.tenantId, String(review.right_id));
          if (!left || !right || !isLeadInScope(ctx, 'lead.merge', right)) {
            throw AppError.of('NOT_FOUND', 'Duplicate review not found.');
          }
          if (review.status !== 'OPEN') throw AppError.of('INVALID_STATE', 'The review is already resolved.');

          let survivorId: string | null = null;
          if (input.action === 'MERGE') {
            survivorId = input.survivorId ?? left.id;
            if (survivorId !== left.id && survivorId !== right.id) {
              throw AppError.of('VALIDATION_ERROR', 'The survivor must be one of the pair.', [
                { field: 'survivorId', issue: 'NOT_IN_PAIR' },
              ]);
            }
            const merged = survivorId === left.id ? right : left;
            if (!OPEN_STATES.includes(merged.state)) {
              throw AppError.of('INVALID_STATE', `A ${merged.state} lead cannot be merged away.`);
            }
            const updated = await repo.updateLead(
              tx,
              ctx.principal.tenantId,
              merged.id,
              merged.lock_version,
              {
                state: 'MERGED',
                merged_into_id: survivorId,
                updated_by: ctx.principal.id,
              },
            );
            if (!updated) throw AppError.of('VERSION_CONFLICT', 'The lead changed during the merge.');
            await history(deps, tx, ctx, merged, 'MERGED', 'T-LEAD-08', 'DUPLICATE');
            await emit(deps, tx, ctx, 'lead.merged', merged.id, {
              leadId: merged.id,
              survivorId,
              reviewId: review.id,
            });
          }
          const status = input.action === 'MERGE' ? 'MERGED' : 'DISMISSED';
          const done = await sql<Row>`
            update duplicate_review
               set status = ${status}, resolution = ${input.action}, survivor_id = ${survivorId}, reason = ${input.reason},
                   resolved_by = ${ctx.principal.id}, resolved_at = ${ctx.now}, updated_by = ${ctx.principal.id}
             where id = ${String(review.id)} returning *`.execute(tx);
          // A lead with no open review left is no longer flagged.
          for (const lead of [left, right]) {
            await sql`
              update lead set duplicate_flag = 'NONE', duplicate_candidate_ids = '{}', updated_by = ${ctx.principal.id}
               where id = ${lead.id} and state <> 'MERGED' and duplicate_flag <> 'NONE'
                 and not exists (select 1 from duplicate_review d where d.status = 'OPEN'
                                  and (d.left_id = ${lead.id} or d.right_id = ${lead.id}))`.execute(tx);
          }
          await deps.audit.record(tx, ctx, {
            action: `duplicate_review.${input.action === 'MERGE' ? 'merged' : 'dismissed'}`,
            entityType: 'DUPLICATE_REVIEW',
            entityId: String(review.id),
            before: { status: 'OPEN' },
            after: { status, survivorId },
            reason: input.reason,
            permissionUsed: 'lead.merge',
          });
          await emit(deps, tx, ctx, 'duplicate_review.resolved', right.id, {
            reviewId: review.id,
            resolution: input.action,
          });
          return { status: 200, body: toReview(done.rows[0]!), resourceRef: String(review.id) };
        },
      ),
    );
    sendResource(res, result.status, result.body, result.replayed);
  });

  // API-LEAD-012
  router.post('/leads/:id/reroute', async (req, res) => {
    const ctx = requireCtx(req);
    const version = ifMatchVersion(req);
    const key = idempotencyKey(req);
    const input = LeadReroute.parse(req.body ?? {});
    const result = await deps.txRunner.withTenantTx(ctx, (tx) =>
      withIdempotency(
        tx,
        ctx,
        { key, method: 'POST', path: `/v1/leads/${req.params.id}/reroute`, body: input },
        async () => {
          const lead = await leadFor(repo, tx, ctx, req.params.id, 'lead.assign');
          checkVersion(lead, version);
          if (!OPEN_STATES.includes(lead.state))
            throw AppError.of('INVALID_STATE', `A ${lead.state} lead is not routed.`);
          const routed = await service.routeNewLead(tx, ctx, {
            branchId: lead.branch_id,
            productCategory: lead.product_category,
            source: lead.source,
            indicativeAmount: lead.indicative_amount
              ? { amount: String(lead.indicative_amount), currency: lead.amount_currency ?? 'INR' }
              : null,
            pincode: lead.pincode,
          } as never);
          const updated = await repo.updateLead(tx, ctx.principal.tenantId, lead.id, lead.lock_version, {
            owner_user_id: routed.ownerUserId,
            owner_queue_id: routed.ownerQueueId,
            last_routing_decision_id: routed.decisionRecordId,
            updated_by: ctx.principal.id,
          });
          if (!updated) throw AppError.of('VERSION_CONFLICT', 'The lead changed while it was rerouted.');
          await repo.insertLeadAssignment(tx, {
            id: deps.ids.next('asg'),
            tenant_id: ctx.principal.tenantId,
            lead_id: lead.id,
            from_user_id: lead.owner_user_id,
            from_queue_id: lead.owner_queue_id,
            to_user_id: routed.ownerUserId,
            to_queue_id: routed.ownerUserId ? null : routed.ownerQueueId,
            reason_code: 'AUTO_ROUTING',
            actor: ctx.principal.id,
            decision_record_id: routed.decisionRecordId,
            assigned_at: ctx.now,
          });
          await deps.audit.record(tx, ctx, {
            action: 'lead.rerouted',
            entityType: 'lead',
            entityId: lead.id,
            before: { ownerUserId: lead.owner_user_id, ownerQueueId: lead.owner_queue_id },
            after: {
              ownerUserId: routed.ownerUserId,
              ownerQueueId: routed.ownerQueueId,
              decisionRecordId: routed.decisionRecordId,
            },
            reason: input.reason,
            permissionUsed: 'lead.assign',
          });
          await emit(deps, tx, ctx, 'lead.assigned', lead.id, {
            leadId: lead.id,
            ownerUserId: routed.ownerUserId,
            ownerQueueId: routed.ownerQueueId,
          });
          const body = service.toResource(updated);
          return { status: 200, body: { ...body, version: updated.lock_version }, resourceRef: lead.id };
        },
      ),
    );
    res.set('ETag', `"${(result.body as { lockVersion: number }).lockVersion}"`);
    if (result.replayed) res.set('Idempotent-Replayed', 'true');
    res.status(result.status).json(result.body);
  });

  // API-LEAD-013
  router.post('/leads/bulk-assignments', async (req, res) => {
    const ctx = requireCtx(req);
    requirePermission(ctx, 'lead.assign');
    const key = idempotencyKey(req);
    const input = BulkLeadAssignment.parse(req.body);
    const result = await deps.txRunner.withTenantTx(ctx, (tx) =>
      withIdempotency(
        tx,
        ctx,
        { key, method: 'POST', path: '/v1/leads/bulk-assignments', body: input },
        async () => {
          // One transaction: any refusal (scope, state, version, invalid assignee) rolls every assignment back.
          const assigned: { leadId: string; version: number }[] = [];
          for (const [i, leadId] of input.leadIds.entries()) {
            const lead = await repo.findLeadById(tx, ctx.principal.tenantId, leadId);
            if (!lead)
              throw AppError.of('NOT_FOUND', 'Lead not found or outside authorized scope', [
                { field: `leadIds.${i}`, issue: 'NOT_FOUND' },
              ]);
            const out = await service.assignLead(
              tx,
              ctx,
              leadId,
              `"${lead.lock_version}"`,
              `${key.slice(0, 100)}_b${i}`,
              {
                toUserId: input.toUserId ?? null,
                toQueueId: input.toQueueId ?? null,
                reasonCode: input.reasonCode,
                transferOpenTasks: input.transferOpenTasks,
              },
            );
            assigned.push({ leadId, version: out.resource.lockVersion });
          }
          return { status: 200, body: { assigned: assigned.length, leads: assigned } };
        },
      ),
    );
    if (result.replayed) res.set('Idempotent-Replayed', 'true');
    res.status(result.status).json(result.body);
  });

  // API-LEAD-014
  router.post('/leads/:id/restore', async (req, res) => {
    const ctx = requireCtx(req);
    const version = ifMatchVersion(req);
    const input = LeadRestore.parse(req.body);
    const body = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const lead = await leadFor(repo, tx, ctx, req.params.id, 'lead.archive');
      checkVersion(lead, version);
      if (lead.state !== 'ARCHIVED')
        throw AppError.of('INVALID_STATE', 'Only an archived lead can be restored.');
      const prior = await sql<{ from_state: string | null }>`
        select from_state from lead_status_history
         where lead_id = ${lead.id} and to_state = 'ARCHIVED' order by occurred_at desc, id desc limit 1`.execute(
        tx,
      );
      const to =
        prior.rows[0]?.from_state && prior.rows[0].from_state !== 'ARCHIVED'
          ? prior.rows[0].from_state
          : 'NEW';
      const updated = await repo.updateLead(tx, ctx.principal.tenantId, lead.id, lead.lock_version, {
        state: to as LeadRow['state'],
        archived_at: null,
        updated_by: ctx.principal.id,
      });
      if (!updated) throw AppError.of('VERSION_CONFLICT', 'The lead changed while it was restored.');
      await history(deps, tx, ctx, lead, to, 'T-LEAD-09', 'RESTORED');
      await deps.audit.record(tx, ctx, {
        action: 'lead.restored',
        entityType: 'lead',
        entityId: lead.id,
        before: { state: 'ARCHIVED' },
        after: { state: to },
        reason: input.reason,
        permissionUsed: 'lead.archive',
      });
      await emit(deps, tx, ctx, 'lead.state_changed', lead.id, {
        leadId: lead.id,
        fromState: 'ARCHIVED',
        toState: to,
        transitionCode: 'T-LEAD-09',
      });
      return service.toResource(updated);
    });
    res.set('ETag', `"${body.lockVersion}"`);
    res.json(body);
  });
}

const serviceCtx = (tenantId: string, branchId: string | null): RequestContext => ({
  principal: {
    kind: 'SERVICE',
    id: 'SYSTEM:apply-link',
    tenantId,
    primaryBranchId: branchId,
    managedTeamMemberIds: [],
    queueIds: [],
    // The form may only create a lead, in the link's branch.
    grants: branchId ? [{ code: 'lead.create', scope: 'BRANCH', branchIds: [branchId] }] : [],
    authTime: null,
  },
  correlationId: `apl_${crypto.randomUUID()}`,
  now: new Date(),
});

/** API-LEAD-011: the public enquiry form behind an Apply Link. The link resolves the tenant; nothing else is trusted. */
export function createPublicApplyRouter(deps: ApiDeps, makeService: () => LeadService): Router {
  const router = express.Router();
  // Stricter than the public default: a person submits a form a few times at most.
  const limiter = rateLimit({ perMinute: 10 });
  router.post('/apply/:token', limiter, async (req, res) => {
    const parsed = PublicApplySubmission.safeParse(req.body);
    if (!parsed.success) {
      // A filled honeypot gets the same answer as a real submission, so a bot learns nothing.
      if (parsed.error.issues.some((i) => i.path[0] === 'website')) {
        res.status(202).json({ status: 'RECEIVED' });
        return;
      }
      throw parsed.error;
    }
    const input = parsed.data;
    const tokenHash = sha256(String(req.params.token));
    const resolved = await deps.txRunner.withTenantTx(
      serviceCtx('SYSTEM', null),
      async (tx) =>
        (await sql<Row>`select * from app.resolve_public_apply_link(${tokenHash})`.execute(tx)).rows[0],
    );
    if (!resolved) throw AppError.of('NOT_FOUND', 'This link is not valid or has expired.');
    const productCategory = (resolved.product_category as string | null) ?? input.productCategory;
    if (!productCategory) {
      throw AppError.of('VALIDATION_ERROR', 'Choose a loan type.', [
        { field: 'productCategory', issue: 'REQUIRED' },
      ]);
    }
    const ctx = serviceCtx(String(resolved.tenant_id), String(resolved.branch_id));
    const lead = CreateLeadInputSchema.parse({
      fullName: input.fullName,
      mobile: input.mobile,
      email: input.email ?? null,
      productCategory,
      indicativeAmount: input.indicativeAmount ?? null,
      pincode: input.pincode ?? null,
      branchId: resolved.branch_id,
      source: 'WEBSITE',
      subSource: 'APPLY_LINK',
      campaign: (resolved.campaign as string | null) ?? null,
      consent: {
        purpose: 'CONTACT',
        noticeVersion: resolved.notice_version,
        channel: 'WEB_FORM',
        evidenceRef: `apply_link:${String(resolved.apply_link_id)}`,
      },
    });
    const created = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const out = await makeService().createLead(
        tx,
        ctx,
        lead,
        `apl_${crypto.randomUUID().replace(/-/g, '')}`,
      );
      await sql`update apply_link set submissions = submissions + 1, updated_by = ${ctx.principal.id}
                 where id = ${String(resolved.apply_link_id)}`.execute(tx);
      return out.resource;
    });
    // The enquirer gets a reference, never the internal record.
    res.status(201).json({ status: 'RECEIVED', reference: created.id.slice(-8) });
  });
  return router;
}
