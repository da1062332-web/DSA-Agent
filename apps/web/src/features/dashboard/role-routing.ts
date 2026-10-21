import type { Me } from '../../api/useMe';

export type DashboardRole =
  | 'ROLE-SALES-EXEC'
  | 'ROLE-LOAN-OPS'
  | 'ROLE-DOC-VERIFIER'
  | 'ROLE-RM'
  | 'ROLE-BRANCH-MGR'
  | 'ROLE-TEAM-MGR'
  | 'ROLE-FINANCE-EXEC'
  | 'ROLE-COMMISSION-APPROVER'
  | 'ROLE-COMPLIANCE'
  | 'ROLE-RULE-AUTHOR'
  | 'ROLE-RULE-APPROVER'
  | 'ROLE-ORG-OWNER'
  | 'ROLE-TENANT-ADMIN';

export const ROLE_LABELS: Record<DashboardRole, string> = {
  'ROLE-SALES-EXEC': 'Sales Executive',
  'ROLE-LOAN-OPS': 'Loan Operations',
  'ROLE-DOC-VERIFIER': 'Document Verifier',
  'ROLE-RM': 'Relationship Manager',
  'ROLE-BRANCH-MGR': 'Branch Manager',
  'ROLE-TEAM-MGR': 'Team Manager',
  'ROLE-FINANCE-EXEC': 'Finance Executive',
  'ROLE-COMMISSION-APPROVER': 'Commission Approver',
  'ROLE-COMPLIANCE': 'Compliance Officer',
  'ROLE-RULE-AUTHOR': 'Rule Author',
  'ROLE-RULE-APPROVER': 'Rule Approver',
  'ROLE-ORG-OWNER': 'Organisation Owner',
  'ROLE-TENANT-ADMIN': 'Tenant Administrator',
};

export const ROLE_PRIORITY: DashboardRole[] = [
  'ROLE-SALES-EXEC',
  'ROLE-LOAN-OPS',
  'ROLE-DOC-VERIFIER',
  'ROLE-RM',
  'ROLE-BRANCH-MGR',
  'ROLE-TEAM-MGR',
  'ROLE-FINANCE-EXEC',
  'ROLE-COMMISSION-APPROVER',
  'ROLE-COMPLIANCE',
  'ROLE-RULE-AUTHOR',
  'ROLE-RULE-APPROVER',
  'ROLE-ORG-OWNER',
  'ROLE-TENANT-ADMIN',
];

/**
 * Resolves the user's assigned roles in fixed priority order.
 * Uses explicit `me.roles` if present, with a deterministic fallback
 * checking permissions (for mocked contexts or test fixtures).
 */
export function resolveUserRoles(me: Me | undefined): DashboardRole[] {
  if (!me) return [];

  const assigned = new Set<string>(me.roles ?? []);
  const matched = ROLE_PRIORITY.filter((r) => assigned.has(r));
  if (matched.length > 0) return matched;

  // Fallback: infer based on grant signatures
  const grantCodes = new Set(me.grants?.map((g) => g.code) ?? []);
  const inferred: DashboardRole[] = [];

  if (grantCodes.has('rule.author') && !grantCodes.has('rule.approve')) {
    inferred.push('ROLE-RULE-AUTHOR');
  }
  if (grantCodes.has('rule.approve')) {
    inferred.push('ROLE-RULE-APPROVER');
  }
  if (
    grantCodes.has('finance.reconcile') ||
    (grantCodes.has('finance.period_close') && grantCodes.has('adjustment.create'))
  ) {
    inferred.push('ROLE-FINANCE-EXEC');
  }
  if (grantCodes.has('payout.approve') || grantCodes.has('commission.plan.approve')) {
    inferred.push('ROLE-COMMISSION-APPROVER');
  }
  if (grantCodes.has('audit.read') && grantCodes.has('security.incident') && !grantCodes.has('lead.create')) {
    inferred.push('ROLE-COMPLIANCE');
  }
  if (
    grantCodes.has('verification.perform') &&
    !grantCodes.has('application.create') &&
    !grantCodes.has('lead.create')
  ) {
    inferred.push('ROLE-DOC-VERIFIER');
  }
  if (
    grantCodes.has('lender_case.submit') &&
    grantCodes.has('sanction.record') &&
    !grantCodes.has('config.manage') &&
    !grantCodes.has('user.manage')
  ) {
    inferred.push('ROLE-LOAN-OPS');
  }
  if (
    grantCodes.has('application.create') &&
    grantCodes.has('customer.create') &&
    !grantCodes.has('lender_case.submit') &&
    !grantCodes.has('lead.assign')
  ) {
    inferred.push('ROLE-RM');
  }
  if (
    grantCodes.has('lead.create') &&
    !grantCodes.has('application.create') &&
    !grantCodes.has('lead.assign')
  ) {
    inferred.push('ROLE-SALES-EXEC');
  }
  if (
    grantCodes.has('lead.assign') &&
    !grantCodes.has('user.manage') &&
    !grantCodes.has('config.manage')
  ) {
    inferred.push('ROLE-TEAM-MGR');
  }
  if (
    grantCodes.has('attendance.manage') &&
    grantCodes.has('user.manage') &&
    !grantCodes.has('config.manage')
  ) {
    inferred.push('ROLE-BRANCH-MGR');
  }
  if (grantCodes.has('role.manage') && !grantCodes.has('user.manage')) {
    inferred.push('ROLE-ORG-OWNER');
  }
  if (grantCodes.has('config.manage') && grantCodes.has('user.manage')) {
    inferred.push('ROLE-TENANT-ADMIN');
  }

  return inferred.length > 0 ? inferred : (grantCodes.has('config.manage') ? ['ROLE-TENANT-ADMIN'] : []);
}
