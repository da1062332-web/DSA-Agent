// packages/contracts/src/permissions.ts — owner: Dev 1 — frozen at Gate 1
// MVP permission codes (Contracts §8, Doc 03 §5.6). Role grants are seeded by migration M-001.

export const PERMISSION_CODES = [
  'lead.read',
  'lead.create',
  'lead.update',
  'lead.qualify',
  'customer.read',
  'consent.record',
  'activity.create',
  'activity.update',
  'task.read',
  'task.create',
  'task.update',
  'application.read',
  'application.create',
  'application.update',
  'application.cancel',
  'application.review',
  'document.review',
  'lender_case.submit',
  'lender_case.update_status',
  'rule.author',
  'rule.simulate',
  'rule.approve',
  'rule.publish',
  'rule.suspend',
  'audit.read',
  'config.manage',
  'user.manage',
  'message.send',
] as const;

export type PermissionCode = (typeof PERMISSION_CODES)[number];
