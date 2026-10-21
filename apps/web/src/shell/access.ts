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
    title: 'Overview',
    items: [{ label: 'Home', to: '/' }],
  },
  {
    title: 'Leads and customers (DOM-B)',
    items: [
      { label: 'Leads', to: '/leads', anyOf: ['lead.read'] },
      { label: 'Customers', to: '/customers', anyOf: ['customer.read'] },
    ],
  },
  {
    title: 'Follow-ups and communication (DOM-C)',
    items: [
      { label: 'Tasks', to: '/tasks', anyOf: ['task.read'] },
      {
        label: 'Activity',
        to: '/activities',
        anyOf: ['lead.read', 'customer.read', 'application.read', 'activity.create'],
      },
      { label: 'Messaging', to: '/messaging', anyOf: ['message.send', 'config.manage'] },
      { label: 'Notifications', to: '/notifications' },
      { label: 'Grievances', to: '/complaints', anyOf: ['complaint.create', 'complaint.manage'] },
    ],
  },
  {
    title: 'Lenders and products (DOM-D)',
    items: [
      { label: 'Lenders', to: '/lenders' },
      { label: 'Products', to: '/products' },
    ],
  },
  {
    title: 'Origination (DOM-E)',
    items: [
      { label: 'Applications', to: '/applications', anyOf: ['application.read'] },
      { label: 'Lender cases', to: '/lender-cases', anyOf: ['application.read', 'lender_case.submit'] },
      { label: 'Eligibility', task: 'MOD-ELG' },
      {
        label: 'Sanction and disbursement',
        to: '/sanctions',
        anyOf: ['sanction.record', 'disbursement.record', 'disbursement.verify'],
      },
    ],
  },
  {
    title: 'KYC, documents and verification (DOM-F)',
    items: [
      { label: 'Documents', to: '/documents', anyOf: ['application.read'] },
      { label: 'Document sharing', to: '/document-sharing', anyOf: ['document.upload', 'share.create'] },
      { label: 'Verification', to: '/verifications', anyOf: ['verification.read', 'verification.perform'] },
      {
        label: 'Verification workbench',
        to: '/verifications/workbench',
        anyOf: ['verification.read', 'verification.perform'],
      },
    ],
  },
  {
    title: 'Business rules (DOM-G)',
    items: [
      { label: 'Rule sets', to: '/rules', anyOf: RULE_PERMISSIONS },
      { label: 'Decisions', to: '/decisions', anyOf: RULE_PERMISSIONS },
    ],
  },
  {
    title: 'Workflow automation (DOM-H)',
    items: [
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
    ],
  },
  {
    title: 'Team and performance (DOM-I)',
    items: [
      { label: 'Performance Dashboard', to: '/performance', anyOf: ['report.read'] },
      { label: 'Targets', to: '/targets', anyOf: ['report.read', 'target.manage'] },
      { label: 'Leaderboard', to: '/performance/leaderboard', anyOf: ['report.read'] },
      { label: 'Workforce', to: '/workforce' },
    ],
  },
  {
    title: 'Connectors (DOM-J)',
    items: [
      { label: 'Connectors', to: '/connectors', anyOf: ['connector.read', 'connector.manage'] },
      { label: 'Connector portal', task: 'MOD-CPT' },
    ],
  },
  {
    title: 'Commission, payouts and reconciliation (DOM-K)',
    items: [
      {
        label: 'Commission',
        to: '/commission',
        anyOf: ['finance.view', 'commission.plan.edit', 'commission.plan.approve'],
      },
      { label: 'Ledger', to: '/ledger', anyOf: ['finance.view'] },
      {
        label: 'Payouts',
        to: '/payouts',
        anyOf: ['finance.view', 'payout.request', 'payout.approve', 'payout.record_payment'],
      },
      { label: 'Reconciliation', to: '/reconciliation', anyOf: ['finance.view', 'finance.reconcile'] },
      { label: 'Invoices', to: '/invoices', anyOf: ['finance.view', 'invoice.manage'] },
    ],
  },
  {
    // "Performance Dashboards" used to be listed here as well, pointing at the same /performance screen as "Performance Dashboard" above (F-15).
    title: 'Reporting (DOM-L)',
    items: [{ label: 'Reports & Catalogue', to: '/reports', anyOf: ['report.read', 'report.manage'] }],
  },
  {
    title: 'Integrations and API (DOM-M)',
    items: [
      {
        label: 'Integrations',
        to: '/integrations',
        anyOf: ['integration.read', 'integration.manage', 'config.manage'],
      },
      { label: 'API management', to: '/api-management', anyOf: ['api.read', 'api.manage', 'config.manage'] },
    ],
  },
  {
    title: 'Security and compliance (DOM-N)',
    items: [
      { label: 'Audit', to: '/audit', anyOf: ['audit.read', 'audit.export_evidence', 'config.manage'] },
      { label: 'Privacy and consent', to: '/privacy', anyOf: ['audit.read', 'customer.read'] },
      {
        label: 'Approvals',
        to: '/approvals',
        anyOf: ['config.manage', 'data_correction.request', 'data_correction.approve'],
      },
      { label: 'Security events and incidents', to: '/security', anyOf: ['security.incident'] },
      { label: 'Security', to: '/account/security' },
    ],
  },
  {
    title: 'Administration (DOM-O)',
    adminOnly: true,
    items: [
      { label: 'Organisation', to: '/admin/organisation', anyOf: ['config.manage'] },
      { label: 'Branches', to: '/admin/branches', anyOf: ['config.manage'] },
      { label: 'Teams', to: '/admin/teams', anyOf: ['config.manage'] },
      { label: 'Work queues', to: '/admin/queues', anyOf: ['config.manage'] },
      { label: 'Users', to: '/users', anyOf: ['user.manage'] },
      // The API accepts user.manage or role.manage on every roles route; the DSA owner holds only role.manage (F-13).
      { label: 'Access control', to: '/roles', anyOf: ['user.manage', 'role.manage'] },
      { label: 'Configuration', to: '/config', anyOf: ['config.manage'] },
      { label: 'Platform Console', to: '/platform-admin', anyOf: ['platform.console'] },
      { label: 'Import and export', to: '/admin/import-export', anyOf: ['import.run', 'export.run'] },
    ],
  },
];

/**
 * Screens that have a route but no sidebar entry, or that need more than the section they sit in. The longest matching path wins, so
 * '/leads/new' (create) is stricter than '/leads' (read). Every other route is covered by the nav item whose path is its prefix.
 */
export const EXTRA_ROUTE_RULES: { to: string; anyOf?: string[] }[] = [
  { to: '/leads/new', anyOf: ['lead.create'] },
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
