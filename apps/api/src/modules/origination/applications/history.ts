// The status journey of one loan application (owner: Bhushan; loan-file page redesign, 2026-11-28).
//   GET /v1/applications/{id}/status-history   application.read; oldest first
// Reads application_status_history (ENT-047, written by every transition and the roll-ups in the same transaction as the change).
// The application is found inside the caller's scope, so another tenant's, an unknown or an out-of-scope application is 404. The
// reason is the code or the short reason the transition recorded (already refused at write time if it held a PAN, Aadhaar or an
// account number); the actor is a user id, which the web app turns into a name.
import { AppError } from '@dsa/contracts';
import type { Router } from 'express';
import { sql } from 'kysely';
import { z } from 'zod';
import { requireCtx } from '../../../http/request';
import type { ApiDeps } from '../../types';
import { applicationScope } from './applications';
import { iso, type Row } from './db';

/** A file rarely has more than a dozen steps; 200 keeps one page and the list contract (limit ≤ 200). */
export const STATUS_HISTORY_LIMIT = 200;

export const StatusHistoryEntry = z.object({
  id: z.string(),
  fromStatus: z.string().nullable(),
  toStatus: z.string(),
  fromSubStatus: z.string().nullable(),
  toSubStatus: z.string().nullable(),
  transitionCode: z.string(),
  reason: z.string().nullable(),
  actorId: z.string(),
  causedByLenderCaseId: z.string().nullable(),
  occurredAt: z.string(),
});
export type StatusHistoryEntry = z.infer<typeof StatusHistoryEntry>;

const toEntry = (r: Row): StatusHistoryEntry => ({
  id: String(r.id),
  fromStatus: (r.from_status as string | null) ?? null,
  toStatus: String(r.to_status),
  fromSubStatus: (r.from_sub_status as string | null) ?? null,
  toSubStatus: (r.to_sub_status as string | null) ?? null,
  transitionCode: String(r.transition_code),
  reason: (r.reason_code as string | null) ?? null,
  actorId: String(r.actor),
  causedByLenderCaseId: (r.caused_by_lender_case_id as string | null) ?? null,
  occurredAt: iso(r.occurred_at),
});

export function registerHistoryRoutes(router: Router, deps: ApiDeps): void {
  router.get('/applications/:id/status-history', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'application.read');
    const data = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const app = await sql<Row>`
        select id from loan_application
         where id = ${req.params.id} and ${applicationScope(ctx, 'application.read')}`.execute(tx);
      if (!app.rows[0]) throw AppError.of('NOT_FOUND', 'Application not found.');
      const r = await sql<Row>`
        select * from application_status_history
         where application_id = ${req.params.id}
         order by occurred_at, id
         limit ${STATUS_HISTORY_LIMIT}`.execute(tx);
      return r.rows.map(toEntry);
    });
    res.json({ data, meta: { nextCursor: null, limit: STATUS_HISTORY_LIMIT } });
  });
}
