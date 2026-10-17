// MOD-DOC checklist slice (owner: Dev 3; DSA Notion MODULE 20, SUB-DOC.02). API-APP-007: GET /v1/applications/{id}/checklist.
// The checklist rows are written by the requirement generator and moved by the verifier attestation (verification module) and by
// document sharing; this endpoint only reads them. application.read, scoped like the application itself: a caller who cannot see
// the application gets 404, never someone else's list. Upload, storage, scanning and versioning (SUB-DOC.03 to .07) wait for
// object storage and a malware scanner (TASK-401) and are not part of this slice.
import { AppError, type PermissionCode, type RequestContext, type Tx } from '@dsa/contracts';
import type { Router } from 'express';
import { sql } from 'kysely';
import { requireCtx } from '../../../http/request';
import type { ApiDeps } from '../../types';
import { applicationScope } from './applications';
import { iso, type Row } from './db';
import { CHECKLIST_DONE_STATUSES, type ChecklistItem, type ChecklistResponse } from './checklist-schemas';

export function toChecklistItem(r: Row): ChecklistItem {
  return {
    id: String(r.id),
    applicationId: String(r.application_id),
    partyId: String(r.party_id),
    documentTypeCode: String(r.document_type_code),
    ordinal: Number(r.ordinal),
    mandatory: Boolean(r.mandatory),
    requiredCount: Number(r.required_count),
    periodMonths: r.period_months === null || r.period_months === undefined ? null : Number(r.period_months),
    status: String(r.status) as ChecklistItem['status'],
    rejectReason: (r.reject_reason as string | null) ?? null,
    attestationNote: (r.attestation_note as string | null) ?? null,
    reviewedBy: (r.reviewed_by as string | null) ?? null,
    reviewedAt: r.reviewed_at ? iso(r.reviewed_at) : null,
    documentId: (r.document_id as string | null) ?? null,
    sourceDecisionId: String(r.source_decision_id),
    version: Number(r.lock_version),
  };
}

/** Mandatory items still open decide whether the file is document-complete; waived and not-applicable items count as done. */
export function summarise(items: ChecklistItem[]): ChecklistResponse['summary'] {
  const mandatory = items.filter((i) => i.mandatory);
  const outstanding = mandatory.filter((i) => !CHECKLIST_DONE_STATUSES.includes(i.status));
  const count = (s: ChecklistItem['status']) => items.filter((i) => i.status === s).length;
  return {
    total: items.length,
    mandatory: mandatory.length,
    outstandingMandatory: outstanding.length,
    accepted: count('ACCEPTED'),
    rejected: count('REJECTED'),
    expired: count('EXPIRED'),
    complete: items.length > 0 && outstanding.length === 0,
  };
}

async function loadApplication(tx: Tx, ctx: RequestContext, code: PermissionCode, id: string): Promise<Row> {
  const r = await sql<Row>`
    select * from loan_application where id = ${id} and ${applicationScope(ctx, code)}`.execute(tx);
  if (!r.rows[0]) throw AppError.of('NOT_FOUND', 'Application not found.');
  return r.rows[0];
}

export function registerChecklistRoutes(router: Router, deps: ApiDeps): void {
  router.get('/applications/:id/checklist', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'application.read');
    const items = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      await loadApplication(tx, ctx, 'application.read', req.params.id);
      const rows = await sql<Row>`
        select * from checklist_item
         where application_id = ${req.params.id}
         order by party_id, document_type_code, ordinal`.execute(tx);
      return rows.rows.map(toChecklistItem);
    });
    const body: ChecklistResponse = { data: items, summary: summarise(items) };
    res.json(body);
  });
}
