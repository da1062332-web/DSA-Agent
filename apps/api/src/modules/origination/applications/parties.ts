// MOD-APP creation, parties and ownership (owner: Dev 3; DSA Notion MODULE 16). APIs: API-APP-001 create from an existing
// customer, API-APP-006 add or remove a co-applicant or guarantor (plus GET of the party list), API-APP-011 assign owners.
// Creation is scoped to a branch the caller may create in: TENANT anywhere, BRANCH in its branches, OWN or TEAM in the
// caller's primary branch (OWN also owns what it creates). A customer the caller cannot see is 404.
// Parties are append-only: a removal sets removed_at (M-072), never deletes, and the party's open checklist items become
// NOT_APPLICABLE; an added party gets its own checklist once the application is collecting documents. Each write bumps
// the application's lock_version (If-Match), and writes audit and outbox in the same transaction.
import { AppError, type PartyPort, type PermissionCode, type RequestContext, type Tx } from '@dsa/contracts';
import { withIdempotency } from '@dsa/kernel';
import type { Router } from 'express';
import { sql } from 'kysely';
import { idempotencyKey, ifMatchVersion, requireCtx, sendResource } from '../../../http/request';
import type { ApiDeps } from '../../types';
import { advanceWhenDocumentsComplete, generateChecklist, insertDraftApplication } from './application-port';
import { applicationScope, loadScopedForUpdate, toApplication } from './applications';
import { assertVersion, iso, updateVersioned, type Row } from './db';
import {
  ApplicationAssignment,
  ApplicationCreate,
  ApplicationPartyChange,
  TERMINAL_STATUSES,
  type ApplicationStatus,
} from './schemas';

/** States where the checklist exists, so a new party gets its documents at once. */
const COLLECTING_STATUSES: readonly ApplicationStatus[] = ['DOCUMENTS_PENDING', 'UNDER_REVIEW'];
/** Parties change only before the application is with a lender. */
const PARTY_EDITABLE_STATUSES: readonly ApplicationStatus[] = ['DRAFT', 'DOCUMENTS_PENDING', 'UNDER_REVIEW'];

export const toParty = (r: Row) => ({
  id: String(r.id),
  customerId: String(r.customer_id),
  role: r.role as 'PRIMARY' | 'CO_APPLICANT' | 'GUARANTOR',
  partyType: r.party_type as 'INDIVIDUAL' | 'ENTITY',
  relationshipToPrimary: (r.relationship_to_primary as string | null) ?? null,
  removedAt: r.removed_at ? iso(r.removed_at) : null,
  createdAt: iso(r.created_at),
});

function partyPort(deps: ApiDeps): PartyPort {
  const port = deps.partyPort;
  if (!port) throw AppError.of('DEPENDENCY_UNAVAILABLE', 'The customer directory is not available.');
  return port;
}

/** The branch rule for creating an application (403 when the caller has the code but not for that branch). */
export function requireCreateInBranch(ctx: RequestContext, branchId: string): void {
  const p = ctx.principal;
  const grants = p.grants.filter((g) => g.code === 'application.create');
  const ok = grants.some(
    (g) =>
      g.scope === 'TENANT' ||
      (g.scope === 'BRANCH' && g.branchIds.includes(branchId)) ||
      ((g.scope === 'TEAM' || g.scope === 'OWN') && p.primaryBranchId === branchId),
  );
  if (ok) return;
  throw AppError.of('FORBIDDEN', 'You do not have permission for this action.', [
    {
      issue: grants.length ? 'OUT_OF_BRANCH_SCOPE' : 'PERMISSION_MISSING',
      meta: { permission: 'application.create' },
    },
  ]);
}

async function requireActiveUser(deps: ApiDeps, tx: Tx, userId: string, branchId: string, field: string) {
  const user = await deps.userDirectory.getUser(tx, userId);
  if (!user || user.status !== 'ACTIVE' || !user.branchIds.includes(branchId)) {
    throw AppError.of('VALIDATION_ERROR', 'The user must be active and work in the application branch.', [
      { field, issue: user ? 'NOT_ELIGIBLE' : 'NOT_FOUND' },
    ]);
  }
}

async function listParties(tx: Tx, applicationId: string): Promise<Row[]> {
  const r = await sql<Row>`
    select * from application_party where application_id = ${applicationId} order by created_at, id`.execute(
    tx,
  );
  return r.rows;
}

async function emit(
  deps: ApiDeps,
  tx: Tx,
  ctx: RequestContext,
  eventType: string,
  applicationId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await sql`
    insert into outbox_event (id, tenant_id, event_type, event_version, subject_type, subject_id, payload,
                              correlation_id, chain_depth, created_at)
    values (${deps.ids.next('evt')}, ${ctx.principal.tenantId}, ${eventType}, 1, 'LOAN_APPLICATION', ${applicationId},
            ${JSON.stringify({ applicationId, ...payload })}::jsonb, ${ctx.correlationId}, 0, ${ctx.now})`.execute(
    tx,
  );
}

export function registerPartyRoutes(router: Router, deps: ApiDeps): void {
  // API-APP-001
  router.post('/applications', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'application.create');
    const key = idempotencyKey(req);
    const input = ApplicationCreate.parse(req.body);
    requireCreateInBranch(ctx, input.branchId);
    const ownsOnly = !ctx.principal.grants.some((g) => g.code === 'application.create' && g.scope !== 'OWN');
    const salesOwnerUserId = input.salesOwnerUserId ?? ctx.principal.id;
    if (ownsOnly && salesOwnerUserId !== ctx.principal.id) {
      throw AppError.of('FORBIDDEN', 'You can only create applications that you own.', [
        { field: 'salesOwnerUserId', issue: 'OUT_OF_SCOPE' },
      ]);
    }

    const result = await deps.txRunner.withTenantTx(ctx, (tx) =>
      withIdempotency(tx, ctx, { key, method: 'POST', path: '/v1/applications', body: input }, async () => {
        const party = await partyPort(deps).getParty(tx, input.customerId);
        if (!party) throw AppError.of('NOT_FOUND', 'Customer not found.');
        if (
          input.applicantType === 'NON_INDIVIDUAL'
            ? party.partyType !== 'ENTITY'
            : party.partyType !== 'INDIVIDUAL'
        ) {
          throw AppError.of('VALIDATION_ERROR', 'The applicant type does not match the customer.', [
            { field: 'applicantType', issue: 'PARTY_TYPE_MISMATCH' },
          ]);
        }
        await requireActiveUser(deps, tx, salesOwnerUserId, input.branchId, 'salesOwnerUserId');
        const applicationId = await insertDraftApplication(tx, ctx, deps, {
          leadId: null,
          customerId: input.customerId,
          branchId: input.branchId,
          partyType: party.partyType,
          productCategory: input.productCategory,
          requestedAmount: input.requestedAmount,
          tenureMonths: input.tenureMonths,
          purposeCode: input.purposeCode,
          applicantType: input.applicantType,
          salesOwnerUserId,
        });
        const r = await sql<Row>`select * from loan_application where id = ${applicationId}`.execute(tx);
        return { status: 201, body: toApplication(r.rows[0]!), resourceRef: applicationId };
      }),
    );
    res.location(`/v1/applications/${result.body.id}`);
    sendResource(res, result.status, result.body, result.replayed);
  });

  router.get('/applications/:id/parties', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'application.read');
    const body = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const app = await sql<Row>`
        select id, lock_version from loan_application
         where id = ${req.params.id} and ${applicationScope(ctx, 'application.read')}`.execute(tx);
      if (!app.rows[0]) throw AppError.of('NOT_FOUND', 'Application not found.');
      const parties = await listParties(tx, req.params.id);
      return { data: parties.map(toParty), version: Number(app.rows[0].lock_version) };
    });
    res.set('ETag', `"${body.version}"`);
    res.json({ data: body.data, meta: { nextCursor: null, limit: body.data.length } });
  });

  // API-APP-006
  router.post('/applications/:id/parties', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'application.update');
    const version = ifMatchVersion(req);
    const key = idempotencyKey(req);
    const input = ApplicationPartyChange.parse(req.body);

    const result = await deps.txRunner.withTenantTx(ctx, (tx) =>
      withIdempotency(
        tx,
        ctx,
        { key, method: 'POST', path: `/v1/applications/${req.params.id}/parties`, body: input },
        async () => {
          const current = await loadScopedForUpdate(tx, ctx, 'application.update', req.params.id);
          assertVersion(current, version);
          if (!PARTY_EDITABLE_STATUSES.includes(current.status as ApplicationStatus)) {
            throw AppError.of(
              'INVALID_STATE',
              `Parties cannot change when the application is ${String(current.status)}.`,
            );
          }
          const parties = await listParties(tx, String(current.id));
          const active = parties.filter((p) => !p.removed_at);
          let partyId: string;

          if (input.action === 'ADD') {
            if (active.some((p) => p.customer_id === input.customerId)) {
              throw AppError.of('VALIDATION_ERROR', 'The customer is already a party to this application.', [
                { field: 'customerId', issue: 'DUPLICATE' },
              ]);
            }
            const party = await partyPort(deps).getParty(tx, input.customerId);
            if (!party) {
              throw AppError.of('VALIDATION_ERROR', 'The customer was not found.', [
                { field: 'customerId', issue: 'NOT_FOUND' },
              ]);
            }
            partyId = deps.ids.next('pty');
            await sql`
              insert into application_party (id, tenant_id, application_id, customer_id, role, party_type,
                                             relationship_to_primary, created_by)
              values (${partyId}, ${ctx.principal.tenantId}, ${String(current.id)}, ${input.customerId}, ${input.role},
                      ${party.partyType}, ${input.relationshipToPrimary ?? null}, ${ctx.principal.id})`.execute(
              tx,
            );
          } else {
            const target = active.find((p) => p.id === input.partyId);
            if (!target) {
              throw AppError.of('VALIDATION_ERROR', 'The party is not on this application.', [
                { field: 'partyId', issue: 'NOT_FOUND' },
              ]);
            }
            if (target.role === 'PRIMARY') {
              throw AppError.of('INVALID_STATE', 'The primary applicant cannot be removed.');
            }
            partyId = String(target.id);
            await sql`
              update application_party set removed_at = ${ctx.now}, removed_by = ${ctx.principal.id}
               where id = ${partyId}`.execute(tx);
            await sql`
              update checklist_item set status = 'NOT_APPLICABLE', updated_by = ${ctx.principal.id}
               where application_id = ${String(current.id)} and party_id = ${partyId}
                 and status in ('PENDING', 'SUBMITTED', 'REJECTED', 'EXPIRED')`.execute(tx);
            // Removing the only party with open documents can leave the checklist complete.
            await advanceWhenDocumentsComplete(tx, ctx, deps, String(current.id));
          }

          const changes: Record<string, unknown> = {};
          if (input.action === 'ADD' && COLLECTING_STATUSES.includes(current.status as ApplicationStatus)) {
            const checklist = await generateChecklist(tx, ctx, deps, current);
            changes.last_checklist_decision_ids = checklist.decisionIds;
          }
          const row = await updateVersioned(
            tx,
            ctx.principal.id,
            'loan_application',
            current,
            version,
            changes,
          );
          const eventType = input.action === 'ADD' ? 'application.party_added' : 'application.party_removed';
          await emit(deps, tx, ctx, eventType, String(row.id), { partyId });
          await deps.audit.record(tx, ctx, {
            action: eventType,
            entityType: 'LOAN_APPLICATION',
            entityId: String(row.id),
            after: { partyId, ...(input.action === 'ADD' ? { role: input.role } : {}) },
            permissionUsed: 'application.update',
          });
          const after = await listParties(tx, String(row.id));
          return {
            status: 200,
            body: {
              applicationId: String(row.id),
              parties: after.map(toParty),
              version: Number(row.lock_version),
            },
            resourceRef: String(row.id),
          };
        },
      ),
    );
    sendResource(res, result.status, result.body, result.replayed);
  });

  // API-APP-011
  router.post('/applications/:id/assignments', async (req, res) => {
    const ctx = requireCtx(req);
    const permission: PermissionCode = 'application.assign';
    deps.authz.requirePermission(ctx, permission);
    const version = ifMatchVersion(req);
    const key = idempotencyKey(req);
    const input = ApplicationAssignment.parse(req.body);

    const result = await deps.txRunner.withTenantTx(ctx, (tx) =>
      withIdempotency(
        tx,
        ctx,
        { key, method: 'POST', path: `/v1/applications/${req.params.id}/assignments`, body: input },
        async () => {
          const current = await loadScopedForUpdate(tx, ctx, permission, req.params.id);
          assertVersion(current, version);
          if (TERMINAL_STATUSES.includes(current.status as ApplicationStatus)) {
            throw AppError.of(
              'INVALID_STATE',
              `An application that is ${String(current.status)} cannot be reassigned.`,
            );
          }
          const branchId = String(current.branch_id);
          if (input.salesOwnerUserId) {
            await requireActiveUser(deps, tx, input.salesOwnerUserId, branchId, 'salesOwnerUserId');
          }
          if (input.opsOwnerUserId) {
            await requireActiveUser(deps, tx, input.opsOwnerUserId, branchId, 'opsOwnerUserId');
          }
          if (input.opsQueueId) {
            const queue = await deps.userDirectory.getQueue(tx, input.opsQueueId);
            if (!queue || !queue.active || (queue.branchId !== null && queue.branchId !== branchId)) {
              throw AppError.of(
                'VALIDATION_ERROR',
                'The queue must be active and serve the application branch.',
                [{ field: 'opsQueueId', issue: queue ? 'NOT_ELIGIBLE' : 'NOT_FOUND' }],
              );
            }
          }
          const changes = {
            sales_owner_id: input.salesOwnerUserId,
            ops_owner_id: input.opsOwnerUserId,
            ops_queue_id: input.opsQueueId,
          };
          const row = await updateVersioned(
            tx,
            ctx.principal.id,
            'loan_application',
            current,
            version,
            changes,
          );
          const owners = (r: Row) => ({
            salesOwnerId: r.sales_owner_id,
            opsOwnerId: r.ops_owner_id ?? null,
            opsQueueId: r.ops_queue_id ?? null,
          });
          await emit(deps, tx, ctx, 'application.assigned', String(row.id), owners(row));
          await deps.audit.record(tx, ctx, {
            action: 'application.assigned',
            entityType: 'LOAN_APPLICATION',
            entityId: String(row.id),
            before: owners(current),
            after: owners(row),
            reason: input.reason,
            permissionUsed: permission,
          });
          return { status: 200, body: toApplication(row), resourceRef: String(row.id) };
        },
      ),
    );
    sendResource(res, result.status, result.body, result.replayed);
  });
}
