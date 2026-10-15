// Mandatory two-step verification (owner: Dev 1, SUB-AUTH.02, DSA Notion MODULE 3 / Doc 03 §5.1).
// A user whose grants include any of these permissions must hold an aal2 session (authenticator code) before using
// /v1, except GET /v1/me so the web app can read the state and send them to the enrolment or challenge screen.
// Keep this list in step with apps/web/src/api/useMe.ts (MFA_REQUIRED), which drives the screen redirect.
import type { Principal, PermissionCode } from '@dsa/contracts';

export const MFA_REQUIRED_PERMISSIONS: readonly PermissionCode[] = [
  'config.manage',
  'user.manage',
  'role.manage',
  'audit.read',
  'document.review',
  'lender_case.submit',
  'lender_case.update_status',
  'application.review',
  'rule.author',
  'rule.approve',
  'rule.publish',
  'rule.suspend',
  'export.run',
  'payout.approve',
  'payout.record_payment',
  // Platform realm (MODULE 1: MFA mandatory for platform roles) and four-eyes data correction approval.
  'platform.console',
  'platform.flags',
  'platform.master_data',
  'platform.jobs',
  'platform.support_access',
  'platform.release',
  'data_correction.approve',
];

export function requiresMfa(principal: Principal): boolean {
  return principal.kind === 'USER' && principal.grants.some((g) => MFA_REQUIRED_PERMISSIONS.includes(g.code));
}
