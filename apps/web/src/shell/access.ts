// The one place that says who may see which screen (owner: Dev 1; audit F-07, F-08, F-13 to F-15 in docs/PERMISSION_UI_VISIBILITY_AUDIT.md).
// The sidebar, the Home cards and the route guard in AppLayout all read NAV_GROUPS and EXTRA_ROUTE_RULES through the functions below, so a
// screen cannot be hidden in one place and open in another. This is presentation only: the API enforces every permission itself, and nothing
// here grants access. A screen the API answers with 403 for a role is hidden from that role; a screen with no rule is open to every signed-in
// user of a customer tenant by decision (Home, Notifications, Lenders, Products, Workforce, account Security).

export interface NavItem {
  label: string;
  /** Route when the screen exists. Omit for modules that are not built yet. */
  to?: string;
  /** Spec reference, shown in the tooltip for items that are not built. */
  task?: string;
  /** Shown only to users holding at least one of these permissions. Omit to show the item to everyone signed in. */
  anyOf?: string[];
}

export interface NavGroup {
  title: string;
  /** Hidden unless the user can administer the tenant. */
  adminOnly?: boolean;
  items: NavItem[];
}

// Permissions the API checks for each screen (DSA Notion module pages MSG, GRV, LCS and SND; the routers for the rest).
// Items without anyOf (Home, Notifications, Lenders, Products, Workforce, the account Security page and the Soon items) are shown
// to everyone: the spec says any staff may use them, so there is no permission to check. Every other screen is filtered by the
// permission its list endpoint enforces, so a role never sees a screen that would answer 403.
const RULE_PERMISSIONS = ['rule.author', 'rule.simulate', 'rule.approve', 'rule.publish', 'rule.suspend'];

export const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Workspace',
    items: [
      { label: 'Home', to: '/' },
      { label: 'Tasks', to: '/tasks', anyOf: ['task.read'] },
      {
        label: 'Approvals',
        to: '/approvals',
        anyOf: [
          'config.manage',
          'data_correction.request',
          'data_correction.approve',
          'commission.plan.approve',
          'payout.approve',
        ],
      },
      {
        label: 'Activity',
        to: '/activities',
        anyOf: ['lead.read', 'customer.read', 'application.read', 'activity.create'],
      },
      { label: 'Notifications', to: '/notifications' },
    ],
  },
  {
    title: 'Sales & CRM',
    items: [
      { label: 'Leads', to: '/leads', anyOf: ['lead.read'] },
      { label: 'Customers', to: '/customers', anyOf: ['customer.read'] },
      { label: 'Messaging', to: '/messaging', anyOf: ['message.send', 'config.manage'] },
      { label: 'Grievances', to: '/complaints', anyOf: ['complaint.create', 'complaint.manage'] },
    ],
  },
  {
    title: 'Loan Origination',
    items: [
      { label: 'Applications', to: '/applications', anyOf: ['application.read'] },
      { label: 'Documents', to: '/documents', anyOf: ['application.read'] },
      { label: 'Document sharing', to: '/document-sharing', anyOf: ['document.upload', 'share.create'] },
      { label: 'Verification', to: '/verifications', anyOf: ['verification.read', 'verification.perform'] },
      {
        label: 'Verification workbench',
        to: '/verifications/workbench',
        anyOf: ['verification.read', 'verification.perform'],
      },
      { label: 'Lender cases', to: '/lender-cases', anyOf: ['application.read', 'lender_case.submit'] },
      {
        label: 'Sanction and disbursement',
        to: '/sanctions',
        anyOf: ['sanction.record', 'disbursement.record', 'disbursement.verify'],
      },
      { label: 'Eligibility', task: 'MOD-ELG' },
      { label: 'Lenders', to: '/lenders' },
      { label: 'Products', to: '/products' },
    ],
  },
  {
    title: 'Finance & Settlement',
    items: [
      {
        label: 'Commission',
        to: '/commission',
        anyOf: ['finance.view', 'commission.plan.edit', 'commission.plan.approve'],
      },
      {
        label: 'Payouts',
        to: '/payouts',
        anyOf: ['finance.view', 'payout.request', 'payout.approve', 'payout.record_payment'],
      },
      { label: 'Ledger', to: '/ledger', anyOf: ['finance.view'] },
      { label: 'Invoices', to: '/invoices', anyOf: ['finance.view', 'invoice.manage'] },
      { label: 'Reconciliation', to: '/reconciliation', anyOf: ['finance.view', 'finance.reconcile'] },
    ],
  },
  {
    title: 'Partners & Operations',
    items: [
      { label: 'Connectors', to: '/connectors', anyOf: ['connector.read', 'connector.manage'] },
      { label: 'Workforce', to: '/workforce' },
      { label: 'Connector portal', task: 'MOD-CPT' },
    ],
  },
  {
    title: 'Analytics & Performance',
    items: [
      { label: 'Performance Dashboard', to: '/performance', anyOf: ['report.read'] },
      { label: 'Targets', to: '/targets', anyOf: ['report.read', 'target.manage'] },
      { label: 'Leaderboard', to: '/performance/leaderboard', anyOf: ['report.read'] },
      { label: 'Reports & Catalogue', to: '/reports', anyOf: ['report.read', 'report.manage'] },
    ],
  },
  {
    title: 'Governance & Administration',
    items: [
      { label: 'Rule sets', to: '/rules', anyOf: RULE_PERMISSIONS },
      { label: 'Decisions', to: '/decisions', anyOf: RULE_PERMISSIONS },
      {
        label: 'Automation rules',
        to: '/automations',
        anyOf: [
          'automation.read',
          'automation.author',
          'automation.approve',
          'automation.execute',
          'automation.operator',
        ],
      },
      { label: 'Users', to: '/users', anyOf: ['user.manage'] },
      { label: 'Access control', to: '/roles', anyOf: ['user.manage', 'role.manage'] },
      { label: 'Organisation', to: '/admin/organisation', anyOf: ['config.manage'] },
      { label: 'Branches', to: '/admin/branches', anyOf: ['config.manage'] },
      { label: 'Teams', to: '/admin/teams', anyOf: ['config.manage'] },
      { label: 'Work queues', to: '/admin/queues', anyOf: ['config.manage'] },
      { label: 'Configuration', to: '/config', anyOf: ['config.manage'] },
      { label: 'Audit', to: '/audit', anyOf: ['audit.read', 'audit.export_evidence', 'config.manage'] },
      { label: 'Privacy and consent', to: '/privacy', anyOf: ['audit.read', 'customer.read'] },
      { label: 'Security events and incidents', to: '/security', anyOf: ['security.incident'] },
      { label: 'Security', to: '/account/security' },
      {
        label: 'Integrations',
        to: '/integrations',
        anyOf: ['integration.read', 'integration.manage', 'config.manage'],
      },
      { label: 'API management', to: '/api-management', anyOf: ['api.read', 'api.manage', 'config.manage'] },
      { label: 'Import and export', to: '/admin/import-export', anyOf: ['import.run', 'export.run'] },
      { label: 'Platform Console', to: '/platform-admin', anyOf: ['platform.console'] },
    ],
  },
];

/**
 * Screens that have a route but no sidebar entry, or that need more than the section they sit in. The longest matching path wins, so
 * '/leads/new' (create) is stricter than '/leads' (read). Every other route is covered by the nav item whose path is its prefix.
 */
export const EXTRA_ROUTE_RULES: { to: string; anyOf?: string[] }[] = [
  { to: '/leads/new', anyOf: ['lead.create'] },
  // The duplicate review queue (API-LEAD-008) answers 403 without lead.merge.
  { to: '/leads/duplicates', anyOf: ['lead.merge'] },
  { to: '/permissions', anyOf: ['user.manage', 'role.manage'] },
  { to: '/grievances', anyOf: ['complaint.create', 'complaint.manage'] },
  { to: '/message-templates', anyOf: ['message.send', 'config.manage'] },
  { to: '/admin/integrations', anyOf: ['integration.read', 'integration.manage', 'config.manage'] },
  { to: '/platform-console', anyOf: ['platform.console'] },
  // The /admin layout page itself (its sections are the Administration items above).
  { to: '/admin', anyOf: ['config.manage', 'user.manage'] },
];

/** A platform operator has no customer data, so the menu offers only these screens (the API refuses the rest anyway). */
const PLATFORM_REALM_SCREENS = new Set(['/', '/platform-admin', '/account/security']);
const PLATFORM_PATHS = ['/platform-admin', '/platform-console'];

/** Groups and items the current user may see. A group with no visible item is dropped. */
export function visibleGroups(
  isAdmin: boolean,
  can: (code: string) => boolean = () => true,
  platformRealm = false,
): NavGroup[] {
  // A platform operator holds no tenant admin permission, yet its one admin-group screen is the Platform Console.
  return NAV_GROUPS.filter((g) => !g.adminOnly || isAdmin || platformRealm)
    .map((g) => ({
      ...g,
      items: g.items.filter(
        (i) =>
          (!platformRealm || (!!i.to && PLATFORM_REALM_SCREENS.has(i.to))) &&
          // The Platform Console belongs to the platform realm only. A customer-tenant role that holds platform.console by mistake
          // (found on hosted, 2026-10-17) must not get a menu entry that leads to a refusal.
          (platformRealm || i.to !== '/platform-admin') &&
          (!i.anyOf || i.anyOf.some(can)),
      ),
    }))
    .filter((g) => g.items.length > 0);
}

const underPath = (pathname: string, to: string): boolean =>
  to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`);

/** The rule that governs a path: the longest matching nav item or extra rule. Undefined for a path no rule covers (the not-found page). */
export function ruleFor(pathname: string): { to: string; anyOf?: string[] } | undefined {
  const candidates = [
    ...NAV_GROUPS.flatMap((g) => g.items).filter((i): i is NavItem & { to: string } => !!i.to),
    ...EXTRA_ROUTE_RULES,
  ];
  return candidates
    .filter((c) => underPath(pathname, c.to))
    .sort((a, b) => b.to.length - a.to.length)
    .at(0);
}

/**
 * May this user open this screen? Used by the route guard and the Home cards, so a link is offered only where the page would open.
 * Fails closed: `can` must be given (permissions not loaded means no); a platform operator reaches only the Platform Console, Home and
 * its own account security; a customer-tenant user never reaches the Platform Console, whatever it holds.
 */
export function routeAllowed(
  pathname: string,
  can: (code: string) => boolean,
  platformRealm: boolean,
): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const isPlatformPath = PLATFORM_PATHS.some((p) => underPath(path, p));
  if (platformRealm) {
    return path === '/' || path === '/account/security' || (isPlatformPath && can('platform.console'));
  }
  if (isPlatformPath) return false;
  const rule = ruleFor(path);
  if (!rule) return true; // the not-found page
  return !rule.anyOf || rule.anyOf.some(can);
}

export type ActionId =
  // Leads
  | 'lead.create'
  | 'lead.update'
  | 'lead.assign'
  | 'lead.reopen'
  | 'lead.convert'
  | 'lead.qualify'
  | 'lead.merge'
  | 'lead.archive'
  // Lender cases
  | 'lender_case.submit'
  | 'lender_case.update_status'
  | 'lender_case.package'
  // Verifications & Documents
  | 'verification.create'
  | 'verification.update'
  | 'verification.perform'
  | 'verification.complete'
  | 'document.review'
  | 'document.upload'
  | 'share.create'
  // Business Rules
  | 'rule.author'
  | 'rule.approve'
  | 'rule.publish'
  | 'rule.suspend'
  | 'rule.simulate'
  // Sanctions & Disbursements
  | 'sanction.record'
  | 'disbursement.record'
  | 'disbursement.verify'
  // Connectors
  | 'connector.manage'
  | 'connector.attribution_change'
  | 'connector.bank_change_approve'
  | 'connector.dispute_resolve'
  // Finance & Payouts
  | 'finance.reconcile'
  | 'finance.period_close'
  | 'payout.request'
  | 'payout.approve'
  | 'payout.record_payment'
  | 'commission.plan.edit'
  | 'commission.plan.approve'
  | 'commission.calculate'
  | 'invoice.manage'
  // Tasks & Applications
  | 'task.create'
  | 'task.update'
  | 'application.create'
  | 'application.review'
  // Customers & Complaints
  | 'customer.create'
  | 'customer.update'
  | 'customer.reveal_sensitive'
  | 'consent.record'
  | 'complaint.create'
  | 'complaint.manage'
  | 'attendance.manage'
  // Administration & Platform
  | 'user.manage'
  | 'role.manage'
  | 'config.manage'
  | 'lender.manage'
  | 'product.manage'
  | 'import.run'
  | 'export.run'
  | 'audit.export_evidence'
  | 'security.incident'
  | 'target.manage'
  | 'message.send';

/**
 * Standard mapping from Action IDs to the permission codes required to execute them.
 * Evaluated with anyOf semantics (holding ANY of the listed permissions authorizes the action).
 */
export const ACTION_RULES: Record<ActionId, string[]> = {
  // Leads
  'lead.create': ['lead.create'],
  'lead.update': ['lead.update'],
  'lead.assign': ['lead.assign'],
  'lead.reopen': ['lead.reopen', 'lead.update'], // fallback to lead.update supported
  'lead.convert': ['lead.convert'],
  'lead.qualify': ['lead.qualify'],
  'lead.merge': ['lead.merge'],
  'lead.archive': ['lead.archive'],

  // Lender cases
  'lender_case.submit': ['lender_case.submit'],
  'lender_case.update_status': ['lender_case.update_status'],
  'lender_case.package': ['lender_case.submit', 'application.read'],

  // Verifications & Documents
  'verification.create': ['verification.create'],
  'verification.update': ['verification.update'],
  'verification.perform': ['verification.perform'],
  'verification.complete': ['verification.complete'],
  'document.review': ['document.review'],
  'document.upload': ['document.upload'],
  'share.create': ['share.create'],

  // Business Rules
  'rule.author': ['rule.author'],
  'rule.approve': ['rule.approve'],
  'rule.publish': ['rule.publish'],
  'rule.suspend': ['rule.suspend'],
  'rule.simulate': ['rule.simulate'],

  // Sanctions & Disbursements
  'sanction.record': ['sanction.record'],
  'disbursement.record': ['disbursement.record'],
  'disbursement.verify': ['disbursement.verify'],

  // Connectors
  'connector.manage': ['connector.manage'],
  'connector.attribution_change': ['connector.attribution_change', 'connector.manage'],
  'connector.bank_change_approve': ['connector.bank_change_approve', 'connector.manage'],
  'connector.dispute_resolve': ['connector.dispute_resolve', 'connector.manage'],

  // Finance & Payouts
  'finance.reconcile': ['finance.reconcile'],
  'finance.period_close': ['finance.period_close'],
  'payout.request': ['payout.request'],
  'payout.approve': ['payout.approve'],
  'payout.record_payment': ['payout.record_payment'],
  'commission.plan.edit': ['commission.plan.edit'],
  'commission.plan.approve': ['commission.plan.approve'],
  'commission.calculate': ['commission.calculate', 'finance.view'],
  'invoice.manage': ['invoice.manage'],

  // Tasks & Applications
  'task.create': ['task.create'],
  'task.update': ['task.update'],
  'application.create': ['application.create'],
  'application.review': ['application.review'],

  // Customers & Complaints
  'customer.create': ['customer.create'],
  'customer.update': ['customer.update'],
  'customer.reveal_sensitive': ['customer.reveal_sensitive'],
  'consent.record': ['consent.record'],
  'complaint.create': ['complaint.create'],
  'complaint.manage': ['complaint.manage'],
  'attendance.manage': ['attendance.manage'],

  // Administration & Platform
  'user.manage': ['user.manage'],
  'role.manage': ['role.manage', 'user.manage'],
  'config.manage': ['config.manage'],
  'lender.manage': ['lender.manage', 'config.manage'],
  'product.manage': ['product.manage', 'config.manage'],
  'import.run': ['import.run'],
  'export.run': ['export.run'],
  'audit.export_evidence': ['audit.export_evidence'],
  'security.incident': ['security.incident'],
  'target.manage': ['target.manage'],
  'message.send': ['message.send'],
};

/**
 * Checks whether a user holding a given permission tester can perform an action.
 * Evaluates anyOf semantics against ACTION_RULES, or falls back to testing the code directly.
 */
export function canPerformAction(action: ActionId | string, can: (code: string) => boolean): boolean {
  const allowedCodes = (ACTION_RULES as Record<string, string[]>)[action];
  if (!allowedCodes || allowedCodes.length === 0) {
    return can(action);
  }
  return allowedCodes.some((code) => can(code));
}
