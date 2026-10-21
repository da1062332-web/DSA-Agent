// The platform realm (owner: Dev 1; DSA Notion MODULE 1 and MODULE 40). Platform operators work from one dedicated platform
// tenant, never from a customer tenant. A permission in PLATFORM_PERMISSIONS is honoured only for a USER principal whose
// tenant is the platform tenant; the database enforces the same rule through app.is_platform_realm() (migration 0050).
// Keep PLATFORM_TENANT_ID in step with supabase/migrations/20261001000050_platform_realm.sql.
import type { Principal } from './kernel';
import type { PermissionCode } from './permissions';

export const PLATFORM_TENANT_ID = 'ten_01M4ZG67WTS51Q0XN7F1Y9CCYG';

export const PLATFORM_ROLE_CODES = ['ROLE-PLATFORM-SUPERADMIN', 'ROLE-PLATFORM-SUPPORT'] as const;

/** Operator-only permissions. data_correction.* is not here: corrections are requested and approved inside a tenant. */
export const PLATFORM_PERMISSIONS: readonly PermissionCode[] = [
  'platform.console',
  'platform.flags',
  'platform.master_data',
  'platform.jobs',
  'platform.support_access',
  'platform.release',
  // MOD-TEN lifecycle (M-082)
  'platform.tenant.create',
  'platform.tenant.suspend',
  'platform.tenant.offboard',
  'platform.tenant.entitlements',
];

/** True for a signed-in user of the platform tenant. Service identities are never platform operators. */
export const isPlatformRealm = (principal: Pick<Principal, 'kind' | 'tenantId'>): boolean =>
  principal.kind === 'USER' && principal.tenantId === PLATFORM_TENANT_ID;
