// MOD-PRV retention schedule and data-principal requests (owner: Dev 1; DSA Notion MODULE 38; M-078). privacy.manage.
//   API-PRV-005 GET  /v1/retention-policies                 the schedule: one entry per data class, tenant value or default
//   API-PRV-006 PUT  /v1/retention-policies/{class}         If-Match (0 for a class still on the default); step-up; never
//               below the platform minimum. The step-up stands for the approval the page asks for; approved_by is the actor.
//   API-PRV-001 POST /v1/data-subject-requests              Idempotency-Key; due 30 days after receipt unless given
//   API-PRV-002 GET  /v1/data-subject-requests              queue, oldest due first; cursor
//   API-PRV-003 PATCH /v1/data-subject-requests/{id}        If-Match; RECEIVED → IN_PROGRESS → COMPLETED or REJECTED
// Platform minimums and defaults are Proposed until OD-008 is decided: R-SHORT 3 months, R-OPS and R-CFG 36, R-LOAN 60
// (KYC records five years after the relationship ends), R-FIN and R-AUD 96.
import { AppError, type RequestContext, type Tx } from '@dsa/contracts';
import { withIdempotency } from '@dsa/kernel';
import type { Router } from 'express';
import { sql } from 'kysely';
import { z } from 'zod';
import {
  decodeCursor,
  encodeCursor,
  idempotencyKey,
  ifMatchVersion,
  requireCtx,
  sendResource,
} from '../../http/request';
import type { ApiDeps } from '../types';

type Row = Record<string, unknown>;

export const DATA_CLASSES = ['R-CFG', 'R-OPS', 'R-LOAN', 'R-FIN', 'R-AUD', 'R-SHORT'] as const;
const PLATFORM: Record<
  (typeof DATA_CLASSES)[number],
  { minimumMonths: number; trigger: string; action: string }
> = {
  'R-CFG': { minimumMonths: 36, trigger: 'RECORD_CLOSED', action: 'PURGE' },
  'R-OPS': { minimumMonths: 36, trigger: 'RECORD_CLOSED', action: 'ANONYMISE' },
  'R-LOAN': { minimumMonths: 60, trigger: 'RELATIONSHIP_ENDED', action: 'ANONYMISE' },
  'R-FIN': { minimumMonths: 96, trigger: 'RECORD_CREATED', action: 'PURGE' },
  'R-AUD': { minimumMonths: 96, trigger: 'RECORD_CREATED', action: 'PURGE' },
  'R-SHORT': { minimumMonths: 3, trigger: 'RECORD_CREATED', action: 'PURGE' },
};

const NO_S3 = [/[A-Z]{5}[0-9]{4}[A-Z]/i, /\b\d{4}\s?\d{4}\s?\d{4}\b/, /\b\d{9,18}\b/];
const safe = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((s) => !NO_S3.some((p) => p.test(s)), 'must not contain identity or account numbers');

export const RetentionPolicyPut = z
  .object({
    retentionMonths: z.number().int().min(1).max(600),
    triggerEvent: z.enum(['RECORD_CREATED', 'RELATIONSHIP_ENDED', 'LOAN_CLOSED', 'RECORD_CLOSED']),
    action: z.enum(['PURGE', 'ANONYMISE']),
    reason: safe(3, 200),
  })
  .strict();

export const DataSubjectRequestCreate = z
  .object({
    subjectType: z.enum(['CUSTOMER', 'LEAD']),
    subjectId: z.string().min(3).max(64),
    requestType: z.enum(['ACCESS', 'CORRECTION', 'ERASURE', 'GRIEVANCE', 'CONSENT_WITHDRAWAL']),
    channel: z.enum(['EMAIL', 'PHONE', 'IN_PERSON', 'PORTAL', 'LETTER']),
    receivedAt: z.string().datetime().optional(),
    dueAt: z.string().datetime().optional(),
    notes: safe(1, 1000).optional(),
  })
  .strict();

export const DataSubjectRequestPatch = z
  .object({
    status: z.enum(['IN_PROGRESS', 'COMPLETED', 'REJECTED']).optional(),
    handledBy: z.string().min(3).max(64).optional(),
    decision: z.enum(['FULFILLED', 'PARTIALLY_FULFILLED', 'DECLINED']).optional(),
    decisionReason: safe(3, 500).optional(),
    responsePackageKey: z.string().min(3).max(200).optional(),
    notes: safe(1, 1000).optional(),
  })
  .strict()
  .refine((p) => Object.values(p).some((v) => v !== undefined), {
    message: 'at least one field is required',
  });

export const DataSubjectRequestQuery = z.object({
  status: z.enum(['RECEIVED', 'IN_PROGRESS', 'COMPLETED', 'REJECTED']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

const NEXT: Record<string, string[]> = {
  RECEIVED: ['IN_PROGRESS', 'REJECTED'],
  IN_PROGRESS: ['COMPLETED', 'REJECTED'],
  COMPLETED: [],
  REJECTED: [],
};

const iso = (v: unknown) => (v ? new Date(String(v)).toISOString() : null);

const toRequest = (r: Row) => ({
  id: String(r.id),
  subjectType: String(r.subject_type),
  subjectId: String(r.subject_id),
  requestType: String(r.request_type),
  channel: String(r.channel),
  receivedAt: iso(r.received_at)!,
  dueAt: iso(r.due_at)!,
  status: String(r.status),
  decision: (r.decision as string | null) ?? null,
  decisionReason: (r.decision_reason as string | null) ?? null,
  responsePackageKey: (r.response_package_key as string | null) ?? null,
  handledBy: (r.handled_by as string | null) ?? null,
  notes: (r.notes as string | null) ?? null,
  completedAt: iso(r.completed_at),
  version: Number(r.lock_version),
  createdAt: iso(r.created_at)!,
});

async function emitAudit(
  deps: ApiDeps,
  tx: Tx,
  ctx: RequestContext,
  action: string,
  type: string,
  id: string,
  extra: object,
) {
  await deps.audit.record(tx, ctx, {
    action,
    entityType: type,
    entityId: id,
    permissionUsed: 'privacy.manage',
    ...extra,
  });
}

export function registerPrivacyControlRoutes(router: Router, deps: ApiDeps): void {
  // API-PRV-005
  router.get('/retention-policies', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'privacy.manage');
    const rows = await deps.txRunner.withTenantTx(
      ctx,
      async (tx) => (await sql<Row>`select * from retention_policy`.execute(tx)).rows,
    );
    const byClass = new Map(rows.map((r) => [String(r.data_class), r]));
    const data = DATA_CLASSES.map((c) => {
      const r = byClass.get(c);
      const p = PLATFORM[c];
      return {
        dataClass: c,
        retentionMonths: r ? Number(r.retention_months) : p.minimumMonths,
        platformMinimumMonths: p.minimumMonths,
        triggerEvent: r ? String(r.trigger_event) : p.trigger,
        action: r ? String(r.action) : p.action,
        isDefault: !r,
        approvedBy: r ? String(r.approved_by) : null,
        approvedAt: r ? iso(r.approved_at) : null,
        version: r ? Number(r.lock_version) : 0,
      };
    });
    res.json({ data, meta: { nextCursor: null, limit: DATA_CLASSES.length } });
  });

  // API-PRV-006
  router.put('/retention-policies/:class', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'privacy.manage');
    deps.authz.requireStepUp(ctx);
    const version = ifMatchVersion(req);
    const dataClass = req.params.class as (typeof DATA_CLASSES)[number];
    if (!DATA_CLASSES.includes(dataClass)) throw AppError.of('NOT_FOUND', 'Unknown data class.');
    const input = RetentionPolicyPut.parse(req.body);
    const minimum = PLATFORM[dataClass].minimumMonths;
    if (input.retentionMonths < minimum) {
      throw AppError.of(
        'VALIDATION_ERROR',
        `Retention for ${dataClass} cannot be below the platform minimum of ${minimum} months.`,
        [{ field: 'retentionMonths', issue: 'BELOW_PLATFORM_MINIMUM', meta: { minimum } }],
      );
    }
    const body = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const cur = (
        await sql<Row>`select * from retention_policy where data_class = ${dataClass} for update`.execute(tx)
      ).rows[0];
      // Version 0 is the platform default; the first saved policy is version 1.
      const currentVersion = cur ? Number(cur.lock_version) : 0;
      if (currentVersion !== version) {
        throw AppError.of(
          'VERSION_CONFLICT',
          'The policy was changed by someone else. Reload and try again.',
          [{ field: 'If-Match', issue: 'STALE', meta: { currentVersion } }],
        );
      }
      const r = cur
        ? await sql<Row>`
            update retention_policy
               set retention_months = ${input.retentionMonths}, trigger_event = ${input.triggerEvent}, action = ${input.action},
                   reason = ${input.reason}, approved_by = ${ctx.principal.id}, approved_at = now(), updated_by = ${ctx.principal.id}
             where id = ${String(cur.id)} returning *`.execute(tx)
        : await sql<Row>`
            insert into retention_policy (id, tenant_id, data_class, retention_months, trigger_event, action, reason, approved_by,
                                          lock_version, created_by, updated_by)
            values (${deps.ids.next('rtp')}, ${ctx.principal.tenantId}, ${dataClass}, ${input.retentionMonths}, ${input.triggerEvent},
                    ${input.action}, ${input.reason}, ${ctx.principal.id}, 1, ${ctx.principal.id}, ${ctx.principal.id})
            returning *`.execute(tx);
      const row = r.rows[0]!;
      await emitAudit(deps, tx, ctx, 'retention_policy.changed', 'RETENTION_POLICY', String(row.id), {
        before: cur
          ? { retentionMonths: Number(cur.retention_months), action: cur.action }
          : { default: true },
        after: {
          retentionMonths: input.retentionMonths,
          action: input.action,
          triggerEvent: input.triggerEvent,
        },
        reason: input.reason,
      });
      return {
        dataClass,
        retentionMonths: Number(row.retention_months),
        platformMinimumMonths: minimum,
        triggerEvent: String(row.trigger_event),
        action: String(row.action),
        isDefault: false,
        approvedBy: String(row.approved_by),
        approvedAt: iso(row.approved_at),
        version: Number(row.lock_version),
      };
    });
    sendResource(res, 200, body);
  });

  // API-PRV-001
  router.post('/data-subject-requests', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'privacy.manage');
    const key = idempotencyKey(req);
    const input = DataSubjectRequestCreate.parse(req.body);
    const receivedAt = input.receivedAt ? new Date(input.receivedAt) : ctx.now;
    const dueAt = input.dueAt ? new Date(input.dueAt) : new Date(receivedAt.getTime() + 30 * 86_400_000);
    if (receivedAt.getTime() > ctx.now.getTime() + 60_000) {
      throw AppError.of('VALIDATION_ERROR', 'A request cannot be received in the future.', [
        { field: 'receivedAt', issue: 'FUTURE' },
      ]);
    }
    if (dueAt <= receivedAt) {
      throw AppError.of('VALIDATION_ERROR', 'The due date must follow receipt.', [
        { field: 'dueAt', issue: 'BEFORE_RECEIPT' },
      ]);
    }
    const result = await deps.txRunner.withTenantTx(ctx, (tx) =>
      withIdempotency(
        tx,
        ctx,
        { key, method: 'POST', path: '/v1/data-subject-requests', body: input },
        async () => {
          const subject =
            input.subjectType === 'CUSTOMER'
              ? await sql`select 1 from customer where id = ${input.subjectId}`.execute(tx)
              : await sql`select 1 from lead where id = ${input.subjectId}`.execute(tx);
          if (!subject.rows.length) {
            throw AppError.of('VALIDATION_ERROR', 'The data principal was not found.', [
              { field: 'subjectId', issue: 'NOT_FOUND' },
            ]);
          }
          const id = deps.ids.next('dsr');
          const r = await sql<Row>`
          insert into data_subject_request (id, tenant_id, subject_type, subject_id, request_type, channel, received_at, due_at,
                                            notes, created_by, updated_by)
          values (${id}, ${ctx.principal.tenantId}, ${input.subjectType}, ${input.subjectId}, ${input.requestType}, ${input.channel},
                  ${receivedAt}, ${dueAt}, ${input.notes ?? null}, ${ctx.principal.id}, ${ctx.principal.id})
          returning *`.execute(tx);
          await emitAudit(deps, tx, ctx, 'data_subject_request.logged', 'DATA_SUBJECT_REQUEST', id, {
            after: { requestType: input.requestType, dueAt: dueAt.toISOString() },
          });
          return { status: 201, body: toRequest(r.rows[0]!), resourceRef: id };
        },
      ),
    );
    sendResource(res, result.status, result.body, result.replayed);
  });

  // API-PRV-002
  router.get('/data-subject-requests', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'privacy.manage');
    const q = DataSubjectRequestQuery.parse(req.query);
    const after = decodeCursor(q.cursor);
    const page = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const r = await sql<Row>`
        select * from data_subject_request
         where true ${q.status ? sql`and status = ${q.status}` : sql``}
           ${after ? sql`and (due_at, id) > (${after.k}::timestamptz, ${after.id})` : sql``}
         order by due_at, id
         limit ${q.limit + 1}`.execute(tx);
      const rows = r.rows.slice(0, q.limit);
      const last = rows[rows.length - 1];
      return {
        data: rows.map(toRequest),
        meta: {
          nextCursor:
            r.rows.length > q.limit && last ? encodeCursor(iso(last.due_at)!, String(last.id)) : null,
          limit: q.limit,
        },
      };
    });
    res.json(page);
  });

  // API-PRV-003
  router.patch('/data-subject-requests/:id', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'privacy.manage');
    const version = ifMatchVersion(req);
    const input = DataSubjectRequestPatch.parse(req.body);
    const body = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const cur = (
        await sql<Row>`select * from data_subject_request where id = ${req.params.id} for update`.execute(tx)
      ).rows[0];
      if (!cur) throw AppError.of('NOT_FOUND', 'Data subject request not found.');
      if (Number(cur.lock_version) !== version) {
        throw AppError.of(
          'VERSION_CONFLICT',
          'The request was changed by someone else. Reload and try again.',
          [{ field: 'If-Match', issue: 'STALE', meta: { currentVersion: cur.lock_version } }],
        );
      }
      const status = input.status ?? String(cur.status);
      if (input.status && input.status !== cur.status && !NEXT[String(cur.status)]!.includes(input.status)) {
        throw AppError.of(
          'INVALID_TRANSITION',
          `A ${String(cur.status)} request cannot move to ${input.status}.`,
        );
      }
      if (['COMPLETED', 'REJECTED'].includes(String(cur.status))) {
        throw AppError.of('INVALID_STATE', 'A closed request cannot be changed.');
      }
      const closing = status === 'COMPLETED' || status === 'REJECTED';
      if (closing && !input.decision) {
        throw AppError.of('VALIDATION_ERROR', 'A decision is required to close the request.', [
          { field: 'decision', issue: 'REQUIRED' },
        ]);
      }
      if (status === 'REJECTED' && input.decision !== 'DECLINED') {
        throw AppError.of('VALIDATION_ERROR', 'A rejected request is DECLINED.', [
          { field: 'decision', issue: 'MISMATCH' },
        ]);
      }
      if (input.decision === 'DECLINED' && !input.decisionReason) {
        throw AppError.of('VALIDATION_ERROR', 'A reason is required to decline.', [
          { field: 'decisionReason', issue: 'REQUIRED' },
        ]);
      }
      if (input.handledBy) {
        const u =
          await sql`select 1 from app_user where id = ${input.handledBy} and status = 'ACTIVE'`.execute(tx);
        if (!u.rows.length)
          throw AppError.of('VALIDATION_ERROR', 'The handler must be an active user.', [
            { field: 'handledBy', issue: 'NOT_ACTIVE' },
          ]);
      }
      const r = await sql<Row>`
        update data_subject_request
           set status = ${status},
               handled_by = ${input.handledBy ?? (cur.handled_by as string | null) ?? (status === 'IN_PROGRESS' ? ctx.principal.id : null)},
               decision = ${closing ? input.decision! : null},
               decision_reason = ${input.decisionReason ?? (cur.decision_reason as string | null) ?? null},
               response_package_key = ${input.responsePackageKey ?? (cur.response_package_key as string | null) ?? null},
               notes = ${input.notes ?? (cur.notes as string | null) ?? null},
               completed_at = ${closing ? ctx.now : null},
               updated_by = ${ctx.principal.id}
         where id = ${String(cur.id)} returning *`.execute(tx);
      await emitAudit(deps, tx, ctx, 'data_subject_request.updated', 'DATA_SUBJECT_REQUEST', String(cur.id), {
        before: { status: cur.status },
        after: { status, decision: closing ? input.decision : null },
        reason: input.decisionReason,
      });
      return toRequest(r.rows[0]!);
    });
    sendResource(res, 200, body);
  });
}
