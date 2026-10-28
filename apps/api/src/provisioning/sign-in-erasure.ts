// Deleting the sign-in account of a deleted user (owner: platform; POST /v1/users/:id/erasure). Runs only in the provisioning worker,
// the only holder of the service-role key. The API has already erased the person's details and deactivated the record; their old Supabase
// account then matches no user. This step deletes that account, so the e-mail address is gone from Supabase too, and retires the
// subject. An account is deleted only if it carries the user's own tenant claim; anything else is left alone and reported.
// Tenants are listed in the platform context (row-level security policy platform_read); each user is handled in its own tenant.
import { PLATFORM_TENANT_ID, type RequestContext } from '@dsa/contracts';
import { sql } from 'kysely';
import {
  ERASED_EMAIL_DOMAIN,
  ERASED_SUBJECT_PREFIX,
  UNBOUND_SUBJECT_PREFIX,
  erasedSubject,
} from '../modules/platform/invitations';
import { PROVISIONING_ACTOR, type InvitationDeliveryDeps } from './invitation-delivery';

export interface SignInErasureOutcome {
  userId: string;
  tenantId: string;
  result: 'DELETED' | 'ALREADY_GONE' | 'KEPT_OTHER_TENANT' | 'ERROR';
}

const serviceContext = (tenantId: string, now: Date): RequestContext => ({
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
  correlationId: 'sign_in_erasure',
  now,
});

export async function runSignInErasures(deps: InvitationDeliveryDeps): Promise<SignInErasureOutcome[]> {
  const now = (deps.now ?? (() => new Date()))();
  const tenants = await deps.txRunner.withTenantTx(serviceContext(PLATFORM_TENANT_ID, now), async (tx) =>
    (await sql<{ id: string }>`select id from tenant order by id`.execute(tx)).rows.map((r) => r.id),
  );
  const outcomes: SignInErasureOutcome[] = [];
  for (const tenantId of tenants) {
    const ctx = serviceContext(tenantId, now);
    const waiting = await deps.txRunner.withTenantTx(
      ctx,
      async (tx) =>
        (
          await sql<{ id: string; idp_subject: string }>`
          select id, idp_subject from app_user
           where email::text like ${`%${ERASED_EMAIL_DOMAIN}`}
             and idp_subject not like ${`${ERASED_SUBJECT_PREFIX}%`}
             and idp_subject not like ${`${UNBOUND_SUBJECT_PREFIX}%`}`.execute(tx)
        ).rows,
    );
    for (const user of waiting) {
      try {
        const account = await deps.authAdmin.getAccount(user.idp_subject);
        let result: SignInErasureOutcome['result'];
        if (!account) result = 'ALREADY_GONE';
        else if (account.tenantId !== tenantId) result = 'KEPT_OTHER_TENANT';
        else {
          await deps.authAdmin.deleteAccount(account.id);
          result = 'DELETED';
        }
        await deps.txRunner.withTenantTx(ctx, async (tx) => {
          const retired = await sql`
            update app_user set idp_subject = ${erasedSubject(user.id)}, updated_by = ${PROVISIONING_ACTOR}
             where id = ${user.id} and idp_subject = ${user.idp_subject}`.execute(tx);
          if (Number(retired.numAffectedRows ?? 0) === 0) return;
          await deps.audit.record(tx, ctx, {
            action: 'user.sign_in_deleted',
            entityType: 'USER',
            entityId: user.id,
            after: { authAccount: result },
            externalSideEffect: result === 'DELETED',
          });
        });
        outcomes.push({ userId: user.id, tenantId, result });
      } catch (err) {
        deps.onError?.(user.id, err);
        outcomes.push({ userId: user.id, tenantId, result: 'ERROR' });
      }
    }
  }
  return outcomes;
}
