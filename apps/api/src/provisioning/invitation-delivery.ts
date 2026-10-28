// Staff invitation delivery (owner: platform, API-USR-001; Architecture B, migration 0093). Runs only in the provisioning worker
// process. For each QUEUED invitation it:
//   1. claims the row in its own tenant (QUEUED -> SENDING, one worker wins), and checks the user is still INVITED and the request is
//      not older than an invitation's lifetime;
//   2. outside any transaction, creates or reuses the Supabase Auth account, writes the tenant claim, and asks Supabase for the e-mail;
//   3. records the result in the tenant: binds the user to the account's subject, marks the invitation SENT with a fresh expiry, or
//      records the failure (retried later, or FAILED for good).
// The worker never changes a user's status, so a retry cannot reactivate a deactivated user. An account is reused only when it already
// carries this tenant's claim; an account with no claim or another tenant's claim is never adopted, because whoever controls it could
// then sign in as the invitee. Every step is audited. Nothing here logs an e-mail address, a token or a key.
import { AppError, type AuditPort, type RequestContext, type Tx, type TxRunner } from '@dsa/contracts';
import { sql } from 'kysely';
import { INVITATION_TTL_MS, invitationExpiry, isUnboundSubject } from '../modules/platform/invitations';
import type { AuthAccount, AuthAdminPort } from './auth-admin';

export const PROVISIONING_ACTOR = 'SYSTEM:provisioning-worker';
/** Sends tried for one request before it is FAILED for good. */
export const MAX_DELIVERY_ATTEMPTS = 5;
/** A claim held longer than this by a worker that stopped is offered to another worker. */
export const STALE_CLAIM_SECONDS = 600;
const RETRY_BASE_MS = 60_000;
const RETRY_MAX_MS = 60 * 60_000;

/** Short codes stored in staff_invitation.last_failure and audited. Never a provider message. */
export type DeliveryFailure =
  'EMAIL_NOT_AVAILABLE' | 'SUBJECT_CONFLICT' | 'REQUEST_EXPIRED' | 'DELIVERY_RETRY' | 'DELIVERY_FAILED';

export interface DeliveryOutcome {
  invitationId: string;
  tenantId: string;
  result: 'SENT' | 'RETRY' | 'FAILED' | 'CANCELLED' | 'SKIPPED' | 'ERROR';
  failure?: DeliveryFailure;
  /** Supabase's HTTP status and code when it refused, e.g. "429 over_email_send_rate_limit". */
  provider?: string;
  authAccount?: 'CREATED' | 'REUSED';
}

export interface InvitationDeliveryDeps {
  txRunner: TxRunner;
  authAdmin: AuthAdminPort;
  audit: AuditPort;
  /** Where the e-mail link returns the invitee (the web app's /accept-invitation). */
  redirectTo: string;
  /** Names this worker in claims, so a worker only records results for rows it holds. */
  workerId: string;
  now?: () => Date;
  /** Unexpected errors (database, bugs). The row stays claimed and is offered again after STALE_CLAIM_SECONDS. */
  onError?: (invitationId: string, err: unknown) => void;
}

/** A refusal that no retry can fix. */
class DeliveryRefusal extends Error {
  constructor(readonly failure: 'EMAIL_NOT_AVAILABLE' | 'SUBJECT_CONFLICT') {
    super(failure);
  }
}

export function retryDelayMs(attempt: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** Math.max(attempt - 1, 0), RETRY_MAX_MS);
}

const serviceContext = (tenantId: string, correlationId: string, now: Date): RequestContext => ({
  principal: {
    kind: 'SERVICE',
    id: PROVISIONING_ACTOR,
    tenantId,
    primaryBranchId: null,
    managedTeamMemberIds: [],
    queueIds: [],
    grants: [],
    authTime: null,
  },
  correlationId,
  now,
});

interface ClaimedRow {
  id: string;
  user_id: string;
  status: string;
  requested_at: Date;
  delivery_attempts: number;
}

interface InviteeRow {
  id: string;
  email: string;
  display_name: string;
  status: string;
  idp_subject: string;
}

/** Finds due invitations across tenants (SYSTEM context, ids only) and delivers each one in its own tenant. */
export async function runInvitationDeliveries(
  deps: InvitationDeliveryDeps,
  maxRows = 20,
): Promise<DeliveryOutcome[]> {
  const now = (deps.now ?? (() => new Date()))();
  const due = await deps.txRunner.withTenantTx(
    serviceContext('SYSTEM', 'invitation_delivery_discovery', now),
    async (tx) =>
      (
        await sql<{ tenant_id: string; id: string }>`
        select tenant_id, id from app.pending_staff_invitation_deliveries(${maxRows}, ${STALE_CLAIM_SECONDS})`.execute(
          tx,
        )
      ).rows,
  );
  const outcomes: DeliveryOutcome[] = [];
  for (const row of due) {
    try {
      outcomes.push(await deliverInvitation(deps, row.tenant_id, row.id));
    } catch (err) {
      deps.onError?.(row.id, err);
      outcomes.push({ invitationId: row.id, tenantId: row.tenant_id, result: 'ERROR' });
    }
  }
  return outcomes;
}

/** Delivers one invitation. Safe to call twice for the same row: only the worker that claims it does anything. */
export async function deliverInvitation(
  deps: InvitationDeliveryDeps,
  tenantId: string,
  invitationId: string,
): Promise<DeliveryOutcome> {
  const now = (deps.now ?? (() => new Date()))();
  const ctx = serviceContext(tenantId, `invitation_delivery_${invitationId}`, now);
  const base = { invitationId, tenantId };

  // 1. Claim, and the checks that need no network.
  type Claim = { done: DeliveryOutcome } | { row: ClaimedRow; invitee: InviteeRow };
  const claimed = await deps.txRunner.withTenantTx<Claim>(ctx, async (tx) => {
    const row = (
      await sql<ClaimedRow>`
        update staff_invitation
           set delivery_state = 'SENDING', claimed_at = ${now}::timestamptz, claimed_by = ${deps.workerId},
               delivery_attempts = delivery_attempts + 1, updated_by = ${PROVISIONING_ACTOR}
         where id = ${invitationId}
           and ((delivery_state = 'QUEUED' and next_attempt_at <= ${now}::timestamptz)
             or (delivery_state = 'SENDING'
                 and claimed_at < ${new Date(now.getTime() - STALE_CLAIM_SECONDS * 1000)}::timestamptz))
        returning id, user_id, status, requested_at, delivery_attempts`.execute(tx)
    ).rows[0];
    if (!row) return { done: { ...base, result: 'SKIPPED' } as DeliveryOutcome };

    const invitee = (
      await sql<InviteeRow>`
        select id, email::text as email, display_name, status, idp_subject from app_user where id = ${row.user_id}`.execute(
        tx,
      )
    ).rows[0];
    if (!invitee || invitee.status !== 'INVITED' || row.status !== 'PENDING') {
      await cancel(tx, ctx, deps, row);
      return { done: { ...base, result: 'CANCELLED' } as DeliveryOutcome };
    }
    // A request older than an invitation's lifetime is not sent late: the administrator asks again.
    if (now.getTime() - row.requested_at.getTime() >= INVITATION_TTL_MS) {
      await fail(tx, ctx, deps, row, 'REQUEST_EXPIRED', true);
      return { done: { ...base, result: 'FAILED', failure: 'REQUEST_EXPIRED' } as DeliveryOutcome };
    }
    return { row, invitee };
  });
  if ('done' in claimed) return claimed.done;
  const { row, invitee } = claimed;

  // 2. Supabase Auth, outside any transaction.
  let account: AuthAccount;
  let created: boolean;
  try {
    ({ account, created } = await provisionAccount(deps, tenantId, invitee));
  } catch (err) {
    const refusal = err instanceof DeliveryRefusal ? err : undefined;
    if (!refusal && !(err instanceof AppError && err.code === 'DEPENDENCY_UNAVAILABLE')) throw err;
    const final = refusal !== undefined || row.delivery_attempts >= MAX_DELIVERY_ATTEMPTS;
    const failure: DeliveryFailure = refusal ? refusal.failure : final ? 'DELIVERY_FAILED' : 'DELIVERY_RETRY';
    const provider =
      err instanceof AppError ? err.details.find((d) => d.field === 'supabase')?.issue : undefined;
    const recorded = await deps.txRunner.withTenantTx(ctx, (tx) =>
      failIfHeld(tx, ctx, deps, row, failure, final, provider),
    );
    if (!recorded) return { ...base, result: 'SKIPPED' };
    return { ...base, result: final ? 'FAILED' : 'RETRY', failure, ...(provider ? { provider } : {}) };
  }

  // 3. Record: bind the user, mark the invitation SENT.
  try {
    return await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const held = await lockHeld(tx, deps, invitationId);
      if (!held) return { ...base, result: 'SKIPPED' } as DeliveryOutcome;
      const user = (
        await sql<{ status: string; idp_subject: string }>`
          select status, idp_subject from app_user where id = ${row.user_id} for update`.execute(tx)
      ).rows[0];
      if (!user) throw new DeliveryRefusal('SUBJECT_CONFLICT');
      if (isUnboundSubject(user.idp_subject)) {
        await sql`
          update app_user set idp_subject = ${account.id}, updated_by = ${PROVISIONING_ACTOR}
           where id = ${row.user_id} and idp_subject = ${user.idp_subject}`.execute(tx);
      } else if (user.idp_subject !== account.id) {
        throw new DeliveryRefusal('SUBJECT_CONFLICT');
      }
      if (user.status !== 'INVITED') {
        await cancel(tx, ctx, deps, row);
        return { ...base, result: 'CANCELLED' } as DeliveryOutcome;
      }
      await sql`
        update staff_invitation
           set delivery_state = 'SENT', status = 'PENDING', sent_at = ${now}::timestamptz,
               expires_at = ${invitationExpiry(now)}::timestamptz, last_failure = null, claimed_at = null, claimed_by = null,
               updated_by = ${PROVISIONING_ACTOR}
         where id = ${invitationId}`.execute(tx);
      await deps.audit.record(tx, ctx, {
        action: 'user.invitation_sent',
        entityType: 'USER',
        entityId: row.user_id,
        after: { invitationId, authAccount: created ? 'CREATED' : 'REUSED', attempt: row.delivery_attempts },
        externalSideEffect: true,
      });
      return { ...base, result: 'SENT', authAccount: created ? 'CREATED' : 'REUSED' } as DeliveryOutcome;
    });
  } catch (err) {
    // The subject is already bound to another user (idp_subject is unique), or the user points at another account.
    const conflict = err instanceof DeliveryRefusal || (err as { code?: string })?.code === '23505';
    if (!conflict) throw err;
    const recorded = await deps.txRunner.withTenantTx(ctx, (tx) =>
      failIfHeld(tx, ctx, deps, row, 'SUBJECT_CONFLICT', true),
    );
    if (!recorded) return { ...base, result: 'SKIPPED' };
    return { ...base, result: 'FAILED', failure: 'SUBJECT_CONFLICT' };
  }
}

async function provisionAccount(
  deps: InvitationDeliveryDeps,
  tenantId: string,
  invitee: InviteeRow,
): Promise<{ account: AuthAccount; created: boolean }> {
  const email = invitee.email.toLowerCase();
  // Already bound (a resend): the account must still be this user's, in this tenant, at this address.
  if (!isUnboundSubject(invitee.idp_subject)) {
    const account = await deps.authAdmin.getAccount(invitee.idp_subject);
    if (!account || account.tenantId !== tenantId || account.email !== email) {
      throw new DeliveryRefusal('SUBJECT_CONFLICT');
    }
    await deps.authAdmin.sendSetPasswordEmail({ email, redirectTo: deps.redirectTo });
    return { account, created: false };
  }
  const existing = await deps.authAdmin.findAccountByEmail(email);
  if (existing) {
    if (existing.tenantId !== tenantId) throw new DeliveryRefusal('EMAIL_NOT_AVAILABLE');
    await deps.authAdmin.sendSetPasswordEmail({ email, redirectTo: deps.redirectTo });
    return { account: existing, created: false };
  }
  const account = await deps.authAdmin.createInvitedAccount({
    email,
    displayName: invitee.display_name,
    tenantId,
    redirectTo: deps.redirectTo,
  });
  return { account, created: true };
}

/** Locks the invitation and confirms this worker still holds the claim. */
async function lockHeld(tx: Tx, deps: InvitationDeliveryDeps, invitationId: string): Promise<boolean> {
  const held = (
    await sql<{ delivery_state: string; claimed_by: string | null }>`
      select delivery_state, claimed_by from staff_invitation where id = ${invitationId} for update`.execute(
      tx,
    )
  ).rows[0];
  return held?.delivery_state === 'SENDING' && held.claimed_by === deps.workerId;
}

async function failIfHeld(
  tx: Tx,
  ctx: RequestContext,
  deps: InvitationDeliveryDeps,
  row: ClaimedRow,
  failure: DeliveryFailure,
  final: boolean,
  provider?: string,
): Promise<boolean> {
  if (!(await lockHeld(tx, deps, row.id))) return false;
  await fail(tx, ctx, deps, row, failure, final, provider);
  return true;
}

async function fail(
  tx: Tx,
  ctx: RequestContext,
  deps: InvitationDeliveryDeps,
  row: ClaimedRow,
  failure: DeliveryFailure,
  final: boolean,
  provider?: string,
): Promise<void> {
  if (final) {
    await sql`
      update staff_invitation
         set delivery_state = 'FAILED', last_failure = ${failure}, claimed_at = null, claimed_by = null,
             status = case when ${failure}::text = 'REQUEST_EXPIRED' then 'EXPIRED' else status end,
             updated_by = ${PROVISIONING_ACTOR}
       where id = ${row.id}`.execute(tx);
  } else {
    const next = new Date(ctx.now.getTime() + retryDelayMs(row.delivery_attempts));
    await sql`
      update staff_invitation
         set delivery_state = 'QUEUED', last_failure = ${failure}, next_attempt_at = ${next}::timestamptz,
             claimed_at = null, claimed_by = null, updated_by = ${PROVISIONING_ACTOR}
       where id = ${row.id}`.execute(tx);
  }
  await deps.audit.record(tx, ctx, {
    action: 'user.invitation_failed',
    entityType: 'USER',
    entityId: row.user_id,
    after: {
      invitationId: row.id,
      failure,
      final,
      attempt: row.delivery_attempts,
      ...(provider ? { provider } : {}),
    },
  });
}

/** The user is no longer INVITED: nothing is sent, and the invitation can never activate anyone. */
async function cancel(
  tx: Tx,
  ctx: RequestContext,
  deps: InvitationDeliveryDeps,
  row: ClaimedRow,
): Promise<void> {
  await sql`
    update staff_invitation
       set delivery_state = 'CANCELLED', status = case when status = 'PENDING' then 'REVOKED' else status end,
           claimed_at = null, claimed_by = null, updated_by = ${PROVISIONING_ACTOR}
     where id = ${row.id}`.execute(tx);
  await deps.audit.record(tx, ctx, {
    action: 'user.invitation_cancelled',
    entityType: 'USER',
    entityId: row.user_id,
    after: { invitationId: row.id, reason: 'USER_NOT_INVITED' },
  });
}
