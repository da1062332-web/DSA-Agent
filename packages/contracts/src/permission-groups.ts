// packages/contracts/src/permission-groups.ts — owner: Dev 1 — additive (migration M-098 change set)
// Presentation grouping of the permission catalogue and the transition aliases for the sub-permissions in SUB_PERMISSION_CODES.
// Nothing here grants access: grants stay explicit rows in role_permission, and no permission implies another at runtime.
import {
  PERMISSION_CODES,
  SUB_PERMISSION_CODES,
  type PermissionCode,
  type SubPermissionCode,
} from './permissions';

/**
 * The coarse codes that gated a sub-permission's feature before the split. During the transition the API and the web accept the new
 * code OR any of these, so the screen the sidebar shows is the screen the API serves. The backfill in migration M-098 gives the new code
 * to every role holding one of these, so nobody loses access when it ships. Removed once the role matrix is applied (see the plan).
 */
export const LEGACY_PARENTS: Record<SubPermissionCode, readonly PermissionCode[]> = {
  // Origination
  'lender_case.read': ['application.read', 'lender_case.submit', 'lender_case.update_status'],
  'sanction.read': [
    'sanction.record',
    'disbursement.record',
    'disbursement.verify',
    'disbursement.exception_approve',
  ],
  'disbursement.read': [
    'sanction.record',
    'disbursement.record',
    'disbursement.verify',
    'disbursement.exception_approve',
  ],
  'eligibility.read': ['application.read'],
  // Administration and configuration
  'org.manage': ['config.manage'],
  'team.manage': ['config.manage', 'user.manage'],
  'settings.manage': ['config.manage'],
  'message_template.manage': ['config.manage'],
  // Users and access
  'user.read': ['user.manage'],
  'user.invite': ['user.manage'],
  'user.offboard': ['user.manage'],
  'role.read': ['role.manage', 'user.manage'],
  'access_review.manage': ['user.manage'],
  // CRM
  'activity.read': ['lead.read', 'customer.read', 'application.read', 'activity.create'],
  'complaint.read': ['complaint.create', 'complaint.manage'],
  'attendance.read': ['attendance.manage'],
  // Finance
  'commission.view': ['finance.view', 'commission.plan.edit', 'commission.plan.approve'],
  'payout.view': ['finance.view', 'payout.request', 'payout.approve', 'payout.record_payment'],
  'ledger.view': ['finance.view'],
  'reconciliation.view': ['finance.view', 'finance.reconcile'],
  'invoice.view': ['finance.view', 'invoice.manage'],
  'payout.disburse': ['payout.record_payment'],
  // Manual journal posting over the API is closed to every human session by design (LedgerService.assertManualPostingAllowed,
  // pinned by TEST-HARD-LED-06) until the business decides who may post (audit decision D-03). The code is defined and granted
  // to nobody, like customer.reveal_sensitive; wiring it into that check is a one-line change once D-03 is made. No parent.
  'ledger.journal_post': [],
  // Connectors
  'connector.bank_account_manage': ['connector.manage'],
  'connector.agreement_manage': ['connector.manage'],
  'connector.portal_user_manage': ['connector.manage'],
  // Reporting
  'performance.read': ['report.read'],
  'target.read': ['report.read', 'target.manage'],
  // Audit, security, privacy
  'audit.seal': ['audit.read'],
  'security.read': ['security.incident'],
  'privacy.read': ['audit.read', 'customer.read', 'privacy.manage'],
  // Integrations and data
  'import.read': ['import.run', 'config.manage'],
};

/**
 * Parents that are NOT kept as runtime aliases. Each is a read code that many roles legitimately hold for their own work (reading
 * applications, customers, leads, reports, the audit trail), so aliasing it would keep opening the sub-permission's screen for all of
 * them: an RM could still open Lender cases through application.read, Sales could still open Privacy through customer.read, and
 * trimming the role could never fix that, because the role must keep the parent. The backfill in M-098 already gives every current
 * holder of such a parent the new code explicitly, so dropping the alias loses nobody their screen once the migration is applied.
 * Apply M-098 before deploying code that uses withLegacy.
 */
export const BROAD_PARENTS: ReadonlySet<PermissionCode> = new Set<PermissionCode>([
  'application.read',
  'customer.read',
  'lead.read',
  'report.read',
  'audit.read',
]);

/** The legacy parents that still authorise a sub-permission at runtime: LEGACY_PARENTS without the broad ones. */
export const TRANSITION_PARENTS: Record<SubPermissionCode, readonly PermissionCode[]> = (() => {
  const out = {} as Record<SubPermissionCode, readonly PermissionCode[]>;
  for (const code of SUB_PERMISSION_CODES)
    out[code] = LEGACY_PARENTS[code].filter((p) => !BROAD_PARENTS.has(p));
  return out;
})();

/**
 * The codes that authorise what `code` guards: the code itself and, for a sub-permission, the feature-specific legacy parents that held
 * it before the split (TRANSITION_PARENTS). The API and the web both use this, so a screen the sidebar shows is a screen the API serves.
 */
export function withLegacy(code: PermissionCode): PermissionCode[] {
  const parents =
    (TRANSITION_PARENTS as Partial<Record<PermissionCode, readonly PermissionCode[]>>)[code] ?? [];
  return [code, ...parents];
}

/** Screens that were open to every staff user and are now gated by their own read permission (lender.read, product.read, attendance.read). */
export const OPEN_TO_STAFF_PERMISSIONS = ['lender.read', 'product.read', 'attendance.read'] as const;

/**
 * What a role that held `permissions` before M-098 holds after its backfill: every sub-permission whose LEGACY_PARENTS it held, plus the
 * three read permissions of the screens that were open to all staff. Mirrors the migration (TEST-PERM-07 pins the SQL to LEGACY_PARENTS),
 * and is what the demo seed and the role-navigation tests use, so a freshly provisioned tenant matches a migrated one.
 */
export function withSubPermissionBackfill(permissions: readonly string[]): string[] {
  const held = new Set(permissions);
  const added = (Object.entries(LEGACY_PARENTS) as [SubPermissionCode, readonly PermissionCode[]][])
    .filter(([, parents]) => parents.some((p) => held.has(p)))
    .map(([code]) => code as string);
  return [...new Set([...permissions, ...added, ...OPEN_TO_STAFF_PERMISSIONS])];
}

export interface PermissionFeature {
  id: string;
  label: string;
  codes: readonly PermissionCode[];
}
export interface PermissionModuleGroup {
  id: string;
  label: string;
  features: readonly PermissionFeature[];
}

/**
 * Module → feature → permission codes, for the role editor. Every catalogue code is in exactly one feature (TEST-PERM-06); a code
 * missing here is shown under "Other" so a future code is never invisible in the editor.
 */
export const PERMISSION_GROUPS: readonly PermissionModuleGroup[] = [
  {
    id: 'leads',
    label: 'Leads and sourcing',
    features: [
      {
        id: 'leads',
        label: 'Leads',
        codes: [
          'lead.read',
          'lead.create',
          'lead.update',
          'lead.qualify',
          'lead.assign',
          'lead.reopen',
          'lead.merge',
          'lead.archive',
        ],
      },
    ],
  },
  {
    id: 'customers',
    label: 'Customers and consent',
    features: [
      {
        id: 'customers',
        label: 'Customers',
        codes: ['customer.read', 'customer.create', 'customer.update', 'customer.reveal_sensitive'],
      },
      { id: 'consent', label: 'Consent', codes: ['consent.record'] },
    ],
  },
  {
    id: 'crm',
    label: 'Tasks, activities and communication',
    features: [
      { id: 'tasks', label: 'Tasks', codes: ['task.read', 'task.create', 'task.update', 'task.assign'] },
      {
        id: 'activities',
        label: 'Activities',
        codes: ['activity.read', 'activity.create', 'activity.update'],
      },
      {
        id: 'grievances',
        label: 'Grievances',
        codes: ['complaint.read', 'complaint.create', 'complaint.manage'],
      },
      { id: 'messaging', label: 'Messaging', codes: ['message.send', 'message_template.manage'] },
      { id: 'workforce', label: 'Workforce', codes: ['attendance.read', 'attendance.manage'] },
    ],
  },
  {
    id: 'origination',
    label: 'Applications, documents and verification',
    features: [
      {
        id: 'applications',
        label: 'Applications',
        codes: [
          'application.read',
          'application.create',
          'application.update',
          'application.cancel',
          'application.review',
          'application.assign',
          'application.close',
          'application.withdraw',
          'application.reopen',
        ],
      },
      { id: 'eligibility', label: 'Eligibility', codes: ['eligibility.read', 'eligibility.override'] },
      {
        id: 'documents',
        label: 'Documents and sharing',
        codes: [
          'document.view',
          'document.download',
          'document.upload',
          'document.review',
          'document.waive',
          'share.create',
        ],
      },
      {
        id: 'verification',
        label: 'Verification',
        codes: [
          'verification.read',
          'verification.perform',
          'verification.create',
          'verification.update',
          'verification.complete',
        ],
      },
    ],
  },
  {
    id: 'lending',
    label: 'Lenders, products and lender cases',
    features: [
      { id: 'lenders', label: 'Lenders', codes: ['lender.read', 'lender.manage'] },
      { id: 'products', label: 'Products', codes: ['product.read', 'product.manage'] },
      {
        id: 'lender-cases',
        label: 'Lender cases',
        codes: ['lender_case.read', 'lender_case.submit', 'lender_case.update_status'],
      },
      {
        id: 'sanctions',
        label: 'Sanctions and disbursements',
        codes: [
          'sanction.read',
          'sanction.record',
          'disbursement.read',
          'disbursement.record',
          'disbursement.verify',
          'disbursement.exception_approve',
        ],
      },
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    features: [
      {
        id: 'commission',
        label: 'Commission',
        codes: ['commission.view', 'commission.plan.edit', 'commission.plan.approve', 'commission.calculate'],
      },
      {
        id: 'payouts',
        label: 'Payouts',
        codes: [
          'payout.view',
          'payout.request',
          'payout.approve',
          'payout.record_payment',
          'payout.disburse',
        ],
      },
      {
        id: 'ledger',
        label: 'Ledger',
        codes: ['ledger.view', 'ledger.journal_post', 'finance.period_close'],
      },
      {
        id: 'reconciliation',
        label: 'Reconciliation',
        codes: ['reconciliation.view', 'finance.reconcile', 'finance.dispute'],
      },
      { id: 'invoices', label: 'Invoices', codes: ['invoice.view', 'invoice.manage'] },
      { id: 'adjustments', label: 'Adjustments', codes: ['adjustment.create', 'adjustment.approve'] },
      { id: 'finance-all', label: 'All finance screens (legacy umbrella)', codes: ['finance.view'] },
    ],
  },
  {
    id: 'partners',
    label: 'Connectors and partners',
    features: [
      {
        id: 'connectors',
        label: 'Connectors',
        codes: [
          'connector.read',
          'connector.manage',
          'connector.bank_account_manage',
          'connector.agreement_manage',
          'connector.portal_user_manage',
          'connector.bank_change_approve',
          'connector.attribution_change',
          'connector.dispute_resolve',
        ],
      },
      { id: 'partner-api', label: 'Partner API', codes: ['partner.lead_ingest', 'partner.application_read'] },
    ],
  },
  {
    id: 'analytics',
    label: 'Reports and performance',
    features: [
      { id: 'performance', label: 'Performance', codes: ['performance.read'] },
      { id: 'targets', label: 'Targets', codes: ['target.read', 'target.manage'] },
      { id: 'reports', label: 'Reports', codes: ['report.read', 'report.manage', 'report.schedule'] },
    ],
  },
  {
    id: 'rules',
    label: 'Rules and automation',
    features: [
      {
        id: 'business-rules',
        label: 'Business rules',
        codes: [
          'rule.author',
          'rule.simulate',
          'rule.approve',
          'rule.publish',
          'rule.suspend',
          'decision.evaluate',
        ],
      },
      {
        id: 'automation',
        label: 'Workflow automation',
        codes: [
          'automation.read',
          'automation.author',
          'automation.approve',
          'automation.execute',
          'automation.operator',
          'automation.manage',
          'automation.operate',
        ],
      },
    ],
  },
  {
    id: 'governance',
    label: 'Audit, security and privacy',
    features: [
      { id: 'audit', label: 'Audit', codes: ['audit.read', 'audit.export_evidence', 'audit.seal'] },
      { id: 'security', label: 'Security', codes: ['security.read', 'security.incident', 'security.vuln'] },
      { id: 'privacy', label: 'Privacy', codes: ['privacy.read', 'privacy.manage'] },
    ],
  },
  {
    id: 'administration',
    label: 'Administration',
    features: [
      { id: 'organisation', label: 'Organisation and configuration', codes: ['org.manage', 'config.manage'] },
      { id: 'teams', label: 'Teams and work queues', codes: ['team.manage'] },
      { id: 'settings', label: 'Tenant settings', codes: ['settings.manage'] },
      {
        id: 'users',
        label: 'Users',
        codes: ['user.read', 'user.invite', 'user.offboard', 'user.manage', 'access_review.manage'],
      },
      { id: 'roles', label: 'Roles', codes: ['role.read', 'role.manage'] },
      {
        id: 'data-corrections',
        label: 'Data corrections',
        codes: ['data_correction.request', 'data_correction.approve'],
      },
    ],
  },
  {
    id: 'integrations',
    label: 'Integrations, API and data',
    features: [
      {
        id: 'integrations',
        label: 'Integrations',
        codes: ['integration.read', 'integration.manage', 'integration.dlq_manage'],
      },
      { id: 'api', label: 'API and webhooks', codes: ['api.read', 'api.manage', 'webhook.manage'] },
      { id: 'import-export', label: 'Import and export', codes: ['import.read', 'import.run', 'export.run'] },
    ],
  },
  {
    id: 'platform',
    label: 'Platform operations',
    features: [
      {
        id: 'platform',
        label: 'Platform console',
        codes: [
          'platform.console',
          'platform.flags',
          'platform.master_data',
          'platform.jobs',
          'platform.support_access',
          'platform.release',
          'platform.tenant.create',
          'platform.tenant.suspend',
          'platform.tenant.offboard',
          'platform.tenant.entitlements',
        ],
      },
    ],
  },
];

/** The module and feature a code is grouped under, or undefined for a code that is not in PERMISSION_GROUPS. */
export function permissionGroupOf(
  code: string,
): { module: PermissionModuleGroup; feature: PermissionFeature } | undefined {
  for (const module of PERMISSION_GROUPS)
    for (const feature of module.features)
      if ((feature.codes as readonly string[]).includes(code)) return { module, feature };
  return undefined;
}

/** Catalogue codes the groups do not cover. Empty while the catalogue and the groups agree (TEST-PERM-06). */
export function ungroupedPermissionCodes(): PermissionCode[] {
  return PERMISSION_CODES.filter((c) => !permissionGroupOf(c));
}
