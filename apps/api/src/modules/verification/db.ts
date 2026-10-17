// apps/api/src/modules/verification/db.ts — owner: Developer 2 (Module 19: Verification)
import {
  AppError,
  type CompleteVerificationRequest,
  type CreateVerificationRequest,
  type RequestContext,
  type Tx,
  type UpdateVerificationRequest,
  type VerificationListQuery,
  type VerificationResponse,
  type ChecklistAttestationRequest,
  type VerificationType,
  type VerificationStatus,
  type VerificationOutcome,
  type VerificationPriority,
  type RejectionReason,
} from '@dsa/contracts';
import { sql, type RawBuilder } from 'kysely';

export interface RawVerificationRow {
  id: string;
  tenant_id: string;
  application_id: string;
  party_id: string | null;
  customer_id: string | null;
  verification_type: string;
  status: string;
  outcome: string | null;
  assigned_to_user_id: string | null;
  assigned_to_queue_id: string | null;
  branch_id: string;
  priority: string;
  scheduled_at: string | Date | null;
  completed_at: string | Date | null;
  verified_by: string | null;
  findings_summary: string | null;
  rejection_reason: string | null;
  checklist_item_ids: string[] | null;
  lock_version: number;
  created_at: string | Date;
  created_by: string;
  updated_at: string | Date;
  updated_by: string;
}

export function formatVerificationRow(row: RawVerificationRow): VerificationResponse {
  return {
    id: row.id as VerificationResponse['id'],
    tenantId: row.tenant_id,
    applicationId: row.application_id,
    partyId: row.party_id ?? null,
    customerId: row.customer_id ?? null,
    verificationType: row.verification_type as VerificationType,
    status: row.status as VerificationStatus,
    outcome: (row.outcome as VerificationOutcome | null) ?? null,
    assignedToUserId: row.assigned_to_user_id ?? null,
    assignedToQueueId: row.assigned_to_queue_id ?? null,
    branchId: row.branch_id,
    priority: row.priority as VerificationPriority,
    scheduledAt: row.scheduled_at ? new Date(row.scheduled_at).toISOString() : null,
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    verifiedBy: row.verified_by ?? null,
    findingsSummary: row.findings_summary ?? null,
    rejectionReason: (row.rejection_reason as RejectionReason | null) ?? null,
    checklistItmIds: Array.isArray(row.checklist_item_ids) ? row.checklist_item_ids : [],
    lockVersion: Number(row.lock_version ?? 0),
    createdAt: new Date(row.created_at).toISOString(),
    createdBy: row.created_by,
    updatedAt: new Date(row.updated_at).toISOString(),
    updatedBy: row.updated_by,
  };
}

export async function getVerificationById(
  tx: Tx,
  _ctx: RequestContext,
  id: string,
): Promise<VerificationResponse> {
  const result = await sql<RawVerificationRow>`
    SELECT * FROM app.verification_request WHERE id = ${id}
  `.execute(tx);

  const row = result.rows[0];
  if (!row) {
    throw AppError.of('NOT_FOUND', `Verification request with id '${id}' not found.`);
  }
  return formatVerificationRow(row);
}

export async function listVerifications(
  tx: Tx,
  ctx: RequestContext,
  query: VerificationListQuery,
): Promise<{
  data: VerificationResponse[];
  meta: { nextCursor: string | null; limit: number; totalCount?: number };
}> {
  const conditions: RawBuilder<unknown>[] = [];

  // Scoping check: if user has branch grants and not tenant scope, enforce their branch
  const grants = ctx.principal.grants.filter(
    (g) => g.code === 'verification.read' || g.code === 'verification.complete',
  );
  const isTenantWide = ctx.principal.kind === 'SERVICE' || grants.some((g) => g.scope === 'TENANT');
  if (!isTenantWide) {
    const allowedBranches = new Set<string>();
    for (const g of grants) {
      if (g.branchIds) g.branchIds.forEach((b) => allowedBranches.add(b));
    }
    if (allowedBranches.size > 0) {
      conditions.push(sql`branch_id IN (${sql.join(Array.from(allowedBranches).map((b) => sql`${b}`))})`);
    }
  }

  if (query.status) {
    conditions.push(sql`status = ${query.status}`);
  }
  if (query.verificationType) {
    conditions.push(sql`verification_type = ${query.verificationType}`);
  }
  if (query.priority) {
    conditions.push(sql`priority = ${query.priority}`);
  }
  if (query.applicationId) {
    conditions.push(sql`application_id = ${query.applicationId}`);
  }
  if (query.branchId) {
    conditions.push(sql`branch_id = ${query.branchId}`);
  }
  if (query.assignedToUserId) {
    conditions.push(sql`assigned_to_user_id = ${query.assignedToUserId}`);
  }

  if (query.cursor) {
    conditions.push(sql`id < ${query.cursor}`);
  }

  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  const whereClause = conditions.length > 0 ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;

  const result = await sql<RawVerificationRow>`
    SELECT * FROM app.verification_request
    ${whereClause}
    ORDER BY created_at DESC, id DESC
    LIMIT ${limit + 1}
  `.execute(tx);

  const rows = result.rows;
  const hasMore = rows.length > limit;
  const dataRows = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore && dataRows.length > 0 ? dataRows[dataRows.length - 1]!.id : null;

  return {
    data: dataRows.map(formatVerificationRow),
    meta: {
      nextCursor,
      limit,
    },
  };
}

export async function createVerification(
  tx: Tx,
  ctx: RequestContext,
  id: string,
  input: CreateVerificationRequest,
): Promise<VerificationResponse> {
  const actor = ctx.principal.id;
  const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;
  const checklistArray = input.checklistItmIds ?? [];

  const result = await sql<RawVerificationRow>`
    INSERT INTO app.verification_request (
      id,
      tenant_id,
      application_id,
      party_id,
      customer_id,
      verification_type,
      status,
      assigned_to_user_id,
      assigned_to_queue_id,
      branch_id,
      priority,
      scheduled_at,
      findings_summary,
      checklist_item_ids,
      created_by,
      updated_by
    ) VALUES (
      ${id},
      ${ctx.principal.tenantId},
      ${input.applicationId},
      ${input.partyId ?? null},
      ${input.customerId ?? null},
      ${input.verificationType},
      'INITIATED',
      ${input.assignedToUserId ?? null},
      ${input.assignedToQueueId ?? null},
      ${input.branchId},
      ${input.priority},
      ${scheduledAt},
      ${input.findingsSummary ?? null},
      ${checklistArray},
      ${actor},
      ${actor}
    )
    RETURNING *
  `.execute(tx);

  const row = result.rows[0];
  if (!row) {
    throw AppError.of('INTERNAL_ERROR', 'Failed to create verification record.');
  }
  return formatVerificationRow(row);
}

export async function updateVerification(
  tx: Tx,
  ctx: RequestContext,
  id: string,
  ifMatchVersion: number,
  input: UpdateVerificationRequest,
): Promise<VerificationResponse> {
  const existing = await sql<RawVerificationRow>`
    SELECT * FROM app.verification_request WHERE id = ${id} FOR UPDATE
  `.execute(tx);

  const current = existing.rows[0];
  if (!current) {
    throw AppError.of('NOT_FOUND', `Verification request with id '${id}' not found.`);
  }

  if (Number(current.lock_version) !== ifMatchVersion) {
    throw AppError.of('VERSION_CONFLICT', 'Record was modified by another user.', [
      { field: 'If-Match', issue: 'STALE', meta: { currentVersion: current.lock_version } },
    ]);
  }

  const updates: RawBuilder<unknown>[] = [];
  if (input.status !== undefined) updates.push(sql`status = ${input.status}`);
  if (input.priority !== undefined) updates.push(sql`priority = ${input.priority}`);
  if (input.assignedToUserId !== undefined)
    updates.push(sql`assigned_to_user_id = ${input.assignedToUserId}`);
  if (input.assignedToQueueId !== undefined)
    updates.push(sql`assigned_to_queue_id = ${input.assignedToQueueId}`);
  if (input.scheduledAt !== undefined) {
    const sAt = input.scheduledAt ? new Date(input.scheduledAt) : null;
    updates.push(sql`scheduled_at = ${sAt}`);
  }
  if (input.findingsSummary !== undefined) updates.push(sql`findings_summary = ${input.findingsSummary}`);
  if (input.checklistItmIds !== undefined) updates.push(sql`checklist_item_ids = ${input.checklistItmIds}`);

  updates.push(sql`updated_by = ${ctx.principal.id}`);

  const result = await sql<RawVerificationRow>`
    UPDATE app.verification_request
    SET ${sql.join(updates, sql`, `)}
    WHERE id = ${id}
    RETURNING *
  `.execute(tx);

  const row = result.rows[0];
  if (!row) {
    throw AppError.of('INTERNAL_ERROR', 'Failed to update verification record.');
  }
  return formatVerificationRow(row);
}

export async function completeVerification(
  tx: Tx,
  ctx: RequestContext,
  id: string,
  ifMatchVersion: number | null,
  input: CompleteVerificationRequest,
): Promise<VerificationResponse> {
  const existing = await sql<RawVerificationRow>`
    SELECT * FROM app.verification_request WHERE id = ${id} FOR UPDATE
  `.execute(tx);

  const current = existing.rows[0];
  if (!current) {
    throw AppError.of('NOT_FOUND', `Verification request with id '${id}' not found.`);
  }

  if (ifMatchVersion !== null && Number(current.lock_version) !== ifMatchVersion) {
    throw AppError.of('VERSION_CONFLICT', 'Record was modified by another user.', [
      { field: 'If-Match', issue: 'STALE', meta: { currentVersion: current.lock_version } },
    ]);
  }

  // Prevent self-verification if current user is the submitter
  if (current.created_by === ctx.principal.id && current.status === 'INITIATED') {
    throw AppError.of('FORBIDDEN', 'Separation of duties: Submitter cannot complete their own verification.');
  }

  const now = new Date();
  const markStatus = input.markStatus ?? (input.outcome === 'POSITIVE' ? 'VERIFIED' : 'REJECTED');
  const rejectionReason = markStatus === 'REJECTED' ? (input.rejectionReason ?? 'OTHER') : null;

  const result = await sql<RawVerificationRow>`
    UPDATE app.verification_request
    SET
      status = ${markStatus},
      outcome = ${input.outcome},
      findings_summary = ${input.findingsSummary},
      rejection_reason = ${rejectionReason},
      completed_at = ${now},
      verified_by = ${ctx.principal.id},
      updated_by = ${ctx.principal.id}
    WHERE id = ${id}
    RETURNING *
  `.execute(tx);

  const row = result.rows[0];
  if (!row) {
    throw AppError.of('INTERNAL_ERROR', 'Failed to complete verification record.');
  }
  return formatVerificationRow(row);
}

export async function reviewChecklistItem(
  tx: Tx,
  ctx: RequestContext,
  verificationId: string,
  input: ChecklistAttestationRequest,
): Promise<{ checklistItemId: string; status: string; reviewedBy: string; reviewedAt: string }> {
  // Ensure the verification request exists
  const vrfRes = await sql<RawVerificationRow>`
    SELECT * FROM app.verification_request WHERE id = ${verificationId}
  `.execute(tx);
  if (!vrfRes.rows[0]) {
    throw AppError.of('NOT_FOUND', `Verification request '${verificationId}' not found.`);
  }

  const now = new Date();
  const actor = ctx.principal.id;
  const rejectReason = input.status === 'REJECTED' ? (input.rejectReason ?? 'OTHER') : null;

  const itemRes = await sql<{ id: string; status: string; reviewed_by: string; reviewed_at: string }>`
    UPDATE app.checklist_item
    SET
      status = ${input.status},
      attestation_note = ${input.attestationNote ?? null},
      reject_reason = ${rejectReason},
      reviewed_by = ${actor},
      reviewed_at = ${now},
      updated_by = ${actor}
    WHERE id = ${input.checklistItemId}
    RETURNING id, status, reviewed_by, reviewed_at
  `.execute(tx);

  const updatedItem = itemRes.rows[0];
  if (!updatedItem) {
    throw AppError.of('NOT_FOUND', `Checklist item '${input.checklistItemId}' not found.`);
  }

  return {
    checklistItemId: updatedItem.id,
    status: updatedItem.status,
    reviewedBy: updatedItem.reviewed_by,
    reviewedAt: new Date(updatedItem.reviewed_at).toISOString(),
  };
}
