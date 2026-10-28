// Safeguards shared by the role, assignment and user-status endpoints (owner: Dev 1; Modules 2, 3 and 4: users and access control).
// Both protect the tenant from locking itself out or from handing out realm-restricted permissions.
import { AppError, PLATFORM_TENANT_ID, type Principal, type Tx } from '@dsa/contracts';
import { sql } from 'kysely';

/** The permission that makes a user a tenant administrator for this check: it is what opens user and role management. */
export const ADMINISTRATOR_PERMISSION = 'user.manage';

/**
 * Platform permissions belong to the platform realm. A customer tenant may never put one in a role, whoever asks and whatever the
 * catalogue says (migration 0050 moved them off every customer role; this keeps the API from putting them back).
 */
export function assertNoPlatformPermissionsForTenant(tenantId: string, permissions: readonly string[]): void {
  if (tenantId === PLATFORM_TENANT_ID) return;
  const offending = permissions.filter((p) => p.startsWith('platform.'));
  if (offending.length > 0) {
    throw AppError.of('VALIDATION_ERROR', 'Platform permissions cannot be given to a customer tenant role.', [
      { field: 'permissions', issue: `PLATFORM_PERMISSION_NOT_ALLOWED: ${offending.join(', ')}` },
    ]);
  }
}

/**
 * Privilege escalation: someone who edits roles may put into a role only the permissions they hold themselves, so they cannot give
 * anyone (including themselves, through a second role) more than they already have. Applies to every permission being ADDED.
 * A full tenant administrator (holding ADMINISTRATOR_PERMISSION, i.e., 'user.manage') is authorized to configure customer tenant roles.
 */
export function assertCanGrantPermissions(principal: Principal, permissions: readonly string[]): void {
  if (principal.grants.some((g) => g.code === ADMINISTRATOR_PERMISSION)) {
    return;
  }
  const held = new Set<string>(principal.grants.map((g) => g.code));
  const notHeld = permissions.filter((p) => !held.has(p));
  if (notHeld.length > 0) {
    throw AppError.of('FORBIDDEN', 'You can only give a role permissions that you hold yourself.', [
      { field: 'permissions', issue: `PERMISSION_NOT_HELD: ${notHeld.join(', ')}` },
    ]);
  }
}

/** How many ACTIVE users of the tenant currently hold the administrator permission through an assignment that is in force. */
export async function countActiveAdministrators(tx: Tx, tenantId: string): Promise<number> {
  const r = await sql<{ n: number | string }>`
    SELECT count(DISTINCT u.id) AS n
      FROM app.app_user u
      JOIN app.user_role_assignment a ON a.user_id = u.id AND a.tenant_id = u.tenant_id AND a.effective_range @> now()
      JOIN app.role_permission rp ON rp.role_id = a.role_id AND rp.tenant_id = a.tenant_id
     WHERE u.tenant_id = ${tenantId} AND u.status = 'ACTIVE' AND rp.permission_code = ${ADMINISTRATOR_PERMISSION}`.execute(
    tx,
  );
  return Number(r.rows[0]?.n ?? 0);
}

/**
 * Call after a change, inside the same transaction, with the count taken BEFORE it. If the tenant had an administrator and no longer
 * does, the change is refused (the transaction rolls back). A tenant that already had none is not made worse, so it is not blocked.
 */
export async function assertAdministratorRemains(
  tx: Tx,
  tenantId: string,
  administratorsBefore: number,
): Promise<void> {
  if (administratorsBefore === 0) return;
  if ((await countActiveAdministrators(tx, tenantId)) === 0) {
    throw AppError.of(
      'INVALID_STATE',
      'This change would leave the tenant without an administrator. Give the permission to another user first.',
      [{ issue: 'LAST_ADMINISTRATOR' }],
    );
  }
}
