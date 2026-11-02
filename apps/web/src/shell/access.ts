// The one place that says who may see which screen (owner: Dev 1; audit F-07, F-08, F-13 to F-15 in docs/PERMISSION_UI_VISIBILITY_AUDIT.md).
// The sidebar, the Home cards and the route guard in AppLayout all read NAV_GROUPS and EXTRA_ROUTE_RULES through the functions below, so a
// screen cannot be hidden in one place and open in another. This is presentation only: the API enforces every permission itself, and nothing
// here grants access. A screen the API answers with 403 for a role is hidden from that role; a screen with no rule is open to every signed-in
// user of a customer tenant by decision (Home, Notifications, Lenders, Products, Workforce, account Security).

import { withLegacy, type PermissionCode } from '@dsa/contracts';

/**
 * What a screen needs. Every part that is present must hold: the tenant must have the module switched on, the user must hold at
 * least one of `anyOf`, and all of `allOf`. A rule with none of them is open to every signed-in user of a customer tenant.
 */
export interface AccessRule {
  /** A gated module (MOD-TEN entitlement). Hidden when the tenant has it off: the API answers 403 MODULE_NOT_ENABLED for it. */
  module?: string;
  /** Shown only to users holding at least one of these permissions. */
  anyOf?: string[];
  /** Shown only to users holding every one of these permissions. */
  allOf?: string[];
  /** A connector portal login only. Staff never see it: the page has nothing for them. */
  connectorOnly?: boolean;
}

export interface NavItem extends AccessRule {
  label: string;
  /** Route when the screen exists. Omit for modules that are not built yet. */
  to?: string;
  /** Spec reference, shown in the tooltip for items that are not built. */
  task?: string;
}

/**
 * The permissions that open a screen: the sub-permission(s) given and, until the role matrix is applied, the coarse codes that opened it
 * before the split (withLegacy). The API accepts the same set, so a screen the sidebar shows is a screen the API serves.
 */
const opens = (...codes: PermissionCode[]): string[] => [...new Set(codes.flatMap((c) => withLegacy(c)))];

/** May the user pass this rule? `disabledModules` comes from GET /v1/me; absent means every module is on. */
export function ruleAllows(
  rule: AccessRule,
  can: (code: string) => boolean,
  disabledModules: readonly string[] = [],
): boolean {
  if (rule.module && disabledModules.includes(rule.module)) return false;
  if (rule.anyOf && !rule.anyOf.some(can)) return false;
  if (rule.allOf && !rule.allOf.every(can)) return false;
  return true;
}

export interface NavGroup {
  title: string;
  /** Hidden unless the user can administer the tenant. */
  adminOnly?: boolean;
  items: NavItem[];
}

// Permissions the API checks for each screen (DSA Notion module pages MSG, GRV, LCS and SND; the routers for the rest).
// Each screen is filtered by the permission its list endpoint enforces, so a role never sees a screen that would answer 403. The
// sub-permissions (opens(...)) give a screen its own code where one coarse code used to open several (finance.view, application.read,
// report.read, customer.read), and `module` hides a screen whose module the tenant has switched off. Items with no rule (Home,
// Notifications, the account Security page and the Soon items) are open to every signed-in user: they belong to the person, not a role.
const RULE_AUTHORING = ['rule.author', 'rule.simulate'];

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
          'data_correction.approve',
          'data_correction.request',
          'commission.plan.approve',
          'payout.approve',
        ],
      },
      { label: 'Activity', to: '/activities', anyOf: opens('activity.read') },
      { label: 'Notifications', to: '/notifications' },
    ],
  },
  {
    title: 'Sales & CRM',
    items: [
      { label: 'Leads', to: '/leads', anyOf: ['lead.read'] },
      { label: 'Customers', to: '/customers', anyOf: ['customer.read'] },
      { label: 'Messaging', to: '/messaging', anyOf: ['message.send', ...opens('message_template.manage')] },
      { label: 'Grievances', to: '/complaints', anyOf: opens('complaint.read') },
    ],
  },
  {
    title: 'Loan Origination',
    items: [
      { label: 'Applications', to: '/applications', anyOf: ['application.read'] },
      // The document workbench is for people who hold a document permission (view, download, review, waive): application.read opens
      // the application, not the workbench. document.upload is not here: it belongs to Document sharing (customer upload links).
      {
        label: 'Documents',
        to: '/documents',
        anyOf: ['document.view', 'document.download', 'document.review', 'document.waive'],
      },
      {
        label: 'Document sharing',
        to: '/document-sharing',
        anyOf: ['document.upload', 'share.create'],
        module: 'MOD-DSH',
      },
      { label: 'Verification', to: '/verifications', anyOf: ['verification.read'], module: 'MOD-VER' },
      {
        // The workbench lists the requests (verification.read) and records the checks (verification.perform): it needs both.
        label: 'Verification workbench',
        to: '/verifications/workbench',
        allOf: ['verification.read', 'verification.perform'],
        module: 'MOD-VER',
      },
      { label: 'Lender cases', to: '/lender-cases', anyOf: opens('lender_case.read') },
      {
        label: 'Sanction and disbursement',
        to: '/sanctions',
        anyOf: opens('sanction.read', 'disbursement.read'),
      },
      { label: 'Eligibility', to: '/eligibility', anyOf: opens('eligibility.read') },
      { label: 'Lenders', to: '/lenders', anyOf: ['lender.read'] },
      { label: 'Products', to: '/products', anyOf: ['product.read'] },
    ],
  },
  {
    title: 'Finance & Settlement',
    items: [
      { label: 'Commission', to: '/commission', anyOf: opens('commission.view'), module: 'MOD-COM' },
      { label: 'Payouts', to: '/payouts', anyOf: opens('payout.view'), module: 'MOD-PAY' },
      { label: 'Ledger', to: '/ledger', anyOf: opens('ledger.view') },
      { label: 'Invoices', to: '/invoices', anyOf: opens('invoice.view'), module: 'MOD-INV' },
      {
        label: 'Reconciliation',
        to: '/reconciliation',
        anyOf: opens('reconciliation.view'),
        module: 'MOD-REC',
      },
    ],
  },
  {
    title: 'Partners & Operations',
    items: [
      { label: 'Connectors', to: '/connectors', anyOf: ['connector.read'], module: 'MOD-CON' },
      { label: 'Workforce', to: '/workforce', anyOf: opens('attendance.read') },
      { label: 'Connector portal', to: '/connector-portal', connectorOnly: true, module: 'MOD-CPT' },
    ],
  },
  {
    title: 'Analytics & Performance',
    items: [
      {
        label: 'Performance Dashboard',
        to: '/performance',
        anyOf: opens('performance.read'),
        module: 'MOD-RPT',
      },
      { label: 'Targets', to: '/targets', anyOf: opens('target.read'), module: 'MOD-PERF' },
      {
        label: 'Leaderboard',
        to: '/performance/leaderboard',
        anyOf: opens('performance.read'),
        module: 'MOD-PERF',
      },
      {
        label: 'Reports & Catalogue',
        to: '/reports',
        anyOf: ['report.read', 'report.manage'],
        module: 'MOD-RPT',
      },
    ],
  },
  {
    title: 'Governance & Administration',
    items: [
      { label: 'Rule sets', to: '/rules', anyOf: RULE_AUTHORING },
      { label: 'Decisions', to: '/decisions', anyOf: ['rule.simulate'] },
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
        module: 'MOD-WFA',
      },
      { label: 'Users', to: '/users', anyOf: opens('user.read') },
      { label: 'Access control', to: '/roles', anyOf: opens('role.read') },
      { label: 'Organisation', to: '/admin/organisation', anyOf: opens('org.manage') },
      { label: 'Branches', to: '/admin/branches', anyOf: opens('org.manage') },
      { label: 'Teams', to: '/admin/teams', anyOf: opens('team.manage') },
      { label: 'Work queues', to: '/admin/queues', anyOf: opens('team.manage') },
      { label: 'Configuration', to: '/config', anyOf: opens('settings.manage') },
      { label: 'Audit', to: '/audit', anyOf: ['audit.read', 'audit.export_evidence'] },
      { label: 'Privacy and consent', to: '/privacy', anyOf: opens('privacy.read') },
      { label: 'Security events and incidents', to: '/security', anyOf: opens('security.read') },
      { label: 'Security', to: '/account/security' },
      {
        label: 'Integrations',
        to: '/integrations',
        anyOf: ['integration.read', 'integration.manage', 'config.manage'],
      },
      {
        label: 'API management',
        to: '/api-management',
        anyOf: ['api.read', 'api.manage', 'config.manage'],
        module: 'MOD-API',
      },
      {
        label: 'Import and export',
        to: '/admin/import-export',
        anyOf: [...opens('import.read'), 'export.run'],
      },
      { label: 'Platform Console', to: '/platform-admin', anyOf: ['platform.console'] },
    ],
  },
];

/**
 * Screens that have a route but no sidebar entry, or that need more than the section they sit in. The longest matching path wins, so
 * '/leads/new' (create) is stricter than '/leads' (read). Every other route is covered by the nav item whose path is its prefix.
 */
export const EXTRA_ROUTE_RULES: (AccessRule & { to: string })[] = [
  { to: '/leads/new', anyOf: ['lead.create'] },
  // The duplicate review queue (API-LEAD-008) answers 403 without lead.merge.
  { to: '/leads/duplicates', anyOf: ['lead.merge'] },
  { to: '/permissions', anyOf: opens('role.read') },
  { to: '/grievances', anyOf: opens('complaint.read') },
  { to: '/message-templates', anyOf: ['message.send', ...opens('message_template.manage')] },
  { to: '/admin/integrations', anyOf: ['integration.read', 'integration.manage', 'config.manage'] },
  { to: '/platform-console', anyOf: ['platform.console'] },
  // The /admin layout page itself (its sections are the Administration items above).
  { to: '/admin', anyOf: [...opens('org.manage'), ...opens('team.manage'), ...opens('settings.manage')] },
];

/** A platform operator has no customer data, so the menu offers only these screens (the API refuses the rest anyway). */
const PLATFORM_REALM_SCREENS = new Set(['/', '/platform-admin', '/account/security']);
const PLATFORM_PATHS = ['/platform-admin', '/platform-console'];
/**
 * What a connector portal login sees: the portal and nothing else. It holds no role, so the staff menu (whose items without a permission
 * rule are open to every staff user) does not apply to it.
 */
export const CONNECTOR_LOGIN_GROUPS: NavGroup[] = [
  { title: 'Partner', items: [{ label: 'Connector Portal', to: '/connector-portal' }] },
];

/**
 * Groups and items the current user may see. A group with no visible item is dropped. `connectorLogin` is a connector portal login,
 * which holds no role and sees the portal only; `disabledModules` is from GET /v1/me (tenant entitlements).
 */
export function visibleGroups(
  isAdmin: boolean,
  can: (code: string) => boolean = () => false,
  platformRealm = false,
  connectorLogin = false,
  disabledModules: readonly string[] = [],
): NavGroup[] {
  if (connectorLogin) return CONNECTOR_LOGIN_GROUPS;
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
          // The connector portal is for connector logins; staff have nothing there.
          !i.connectorOnly &&
          ruleAllows(i, can, disabledModules),
      ),
    }))
    .filter((g) => g.items.length > 0);
}

const underPath = (pathname: string, to: string): boolean =>
  to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`);

/** The rule that governs a path: the longest matching nav item or extra rule. Undefined for a path no rule covers (the not-found page). */
export function ruleFor(pathname: string): (AccessRule & { to: string }) | undefined {
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
 * May this user open this screen? Used by the route guard, the search, the Settings hub and the Home cards, so a link is offered only
 * where the page would open. Fails closed: `can` must be given (permissions not loaded means no); a platform operator reaches only the
 * Platform Console, Home and its own account security; a customer-tenant user never reaches the Platform Console, whatever it holds; a
 * screen of a module the tenant has switched off is closed (`disabledModules`, from GET /v1/me).
 */
export function routeAllowed(
  pathname: string,
  can: (code: string) => boolean,
  platformRealm: boolean,
  disabledModules: readonly string[] = [],
): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const isPlatformPath = PLATFORM_PATHS.some((p) => underPath(path, p));
  if (platformRealm) {
    return (
      path === '/' ||
      path === '/account/security' ||
      path === '/settings' ||
      (isPlatformPath && can('platform.console'))
    );
  }
  if (isPlatformPath) return false;
  const rule = ruleFor(path);
  if (!rule) return true; // the not-found page
  if (rule.connectorOnly) return false; // a connector login is routed to its portal before this check is reached
  return ruleAllows(rule, can, disabledModules);
}

export interface SearchableItem {
  id: string;
  label: string;
  category: string;
  submodule?: string;
  description?: string;
  to: string;
  keywords?: string[];
  /** Not consulted by search: the route rule for `to` decides (getSearchableItems). Kept as a hint for readers of this list. */
  anyOf?: string[];
  adminOnly?: boolean;
}

export const ALL_SEARCHABLE_ITEMS: SearchableItem[] = [
  // Workspace
  {
    id: 'home',
    label: 'Home',
    category: 'Workspace',
    to: '/',
    description: 'CRM Overview and role-based dashboard',
    keywords: ['dashboard', 'overview', 'summary', 'metrics'],
  },
  {
    id: 'tasks',
    label: 'Tasks',
    category: 'Workspace',
    to: '/tasks',
    anyOf: ['task.read'],
    description: 'Assigned workflow tasks and activities',
    keywords: ['todo', 'assignments', 'queue', 'pending'],
  },
  {
    id: 'approvals',
    label: 'Approvals',
    category: 'Workspace',
    to: '/approvals',
    anyOf: [
      'config.manage',
      'data_correction.request',
      'data_correction.approve',
      'commission.plan.approve',
      'payout.approve',
    ],
    description: 'Pending approvals for payouts, corrections, and plans',
    keywords: ['review', 'approve', 'signoff', 'corrections', 'payout review'],
  },
  {
    id: 'activities',
    label: 'Activity',
    category: 'Workspace',
    to: '/activities',
    anyOf: ['lead.read', 'customer.read', 'application.read', 'activity.create'],
    description: 'Call logs, notes, meetings, and interaction history',
    keywords: ['log', 'calls', 'meetings', 'notes', 'timeline'],
  },
  {
    id: 'notifications',
    label: 'Notifications',
    category: 'Workspace',
    to: '/notifications',
    description: 'System alerts, task updates, and messages',
    keywords: ['alerts', 'messages', 'inbox', 'unread'],
  },

  // Sales & CRM
  {
    id: 'leads',
    label: 'Leads',
    category: 'Sales & CRM',
    to: '/leads',
    anyOf: ['lead.read'],
    description: 'Borrower inquiries and sales pipeline',
    keywords: ['prospects', 'inquiries', 'sales', 'pipeline'],
  },
  {
    id: 'leads-new',
    label: 'New Lead',
    category: 'Sales & CRM',
    submodule: 'Leads',
    to: '/leads/new',
    anyOf: ['lead.create'],
    description: 'Create and onboard a new loan prospect',
    keywords: ['create lead', 'add lead', 'new prospect', 'capture lead'],
  },
  {
    id: 'leads-duplicates',
    label: 'Duplicate Review',
    category: 'Sales & CRM',
    submodule: 'Leads',
    to: '/leads/duplicates',
    anyOf: ['lead.merge'],
    description: 'Deduplication queue and record merging',
    keywords: ['dedupe', 'merge leads', 'duplicate checks', 'conflict review'],
  },
  {
    id: 'customers',
    label: 'Customers',
    category: 'Sales & CRM',
    to: '/customers',
    anyOf: ['customer.read'],
    description: 'Borrower profiles, contact details, and consents',
    keywords: ['borrowers', 'clients', 'profiles', 'accounts'],
  },
  {
    id: 'messaging',
    label: 'Messaging',
    category: 'Sales & CRM',
    to: '/messaging',
    anyOf: ['message.send', 'config.manage'],
    description: 'Direct SMS, WhatsApp, and email dispatch',
    keywords: ['sms', 'whatsapp', 'email', 'broadcast', 'chat'],
  },
  {
    id: 'message-templates',
    label: 'Message Templates',
    category: 'Sales & CRM',
    submodule: 'Messaging',
    to: '/message-templates',
    anyOf: ['message.send', 'config.manage'],
    description: 'Pre-approved notification templates and merge tags',
    keywords: ['templates', 'dlt', 'sms templates', 'whatsapp templates'],
  },
  {
    id: 'complaints',
    label: 'Grievances',
    category: 'Sales & CRM',
    to: '/complaints',
    anyOf: ['complaint.create', 'complaint.manage'],
    description: 'Customer complaints, dispute tracking, and resolution',
    keywords: ['disputes', 'issues', 'tickets', 'customer support', 'grievance'],
  },

  // Loan Origination
  {
    id: 'applications',
    label: 'Applications',
    category: 'Loan Origination',
    to: '/applications',
    anyOf: ['application.read'],
    description: 'End-to-end loan application processing pipeline',
    keywords: ['loan files', 'applications', 'cases', 'origination'],
  },
  {
    id: 'documents',
    label: 'Documents',
    category: 'Loan Origination',
    to: '/documents',
    anyOf: ['application.read'],
    description: 'Customer document repository and checklist review',
    keywords: ['kyc documents', 'files', 'uploads', 'pan', 'aadhaar', 'bank statements'],
  },
  {
    id: 'document-sharing',
    label: 'Document Sharing',
    category: 'Loan Origination',
    to: '/document-sharing',
    anyOf: ['document.upload', 'share.create'],
    description: 'Generate secure customer document upload links',
    keywords: ['public upload', 'external link', 'customer upload', 'secure share'],
  },
  {
    id: 'verifications',
    label: 'Verification',
    category: 'Loan Origination',
    to: '/verifications',
    anyOf: ['verification.read', 'verification.perform'],
    description: 'Field inspection, residence, and employment checks',
    keywords: ['kyc check', 'field verification', 'tele-verification', 'checks'],
  },
  {
    id: 'verification-workbench',
    label: 'Verification Workbench',
    category: 'Loan Origination',
    submodule: 'Verification',
    to: '/verifications/workbench',
    anyOf: ['verification.read', 'verification.perform'],
    description: 'Underwriter queue for verifying applicant documents and data',
    keywords: ['workbench', 'underwriting', 'document review', 'verification queue'],
  },
  {
    id: 'lender-cases',
    label: 'Lender Cases',
    category: 'Loan Origination',
    to: '/lender-cases',
    anyOf: ['application.read', 'lender_case.submit'],
    description: 'Multi-lender loan submissions, offers, and decisions',
    keywords: ['bank submission', 'offers', 'lender cases', 'submissions'],
  },
  {
    id: 'sanctions',
    label: 'Sanction and Disbursement',
    category: 'Loan Origination',
    to: '/sanctions',
    anyOf: ['sanction.record', 'disbursement.record', 'disbursement.verify'],
    description: 'Sanction letter issuance and disbursement tracking',
    keywords: ['sanction letter', 'disbursement', 'payout', 'loan sanction'],
  },
  {
    id: 'eligibility',
    label: 'Eligibility',
    category: 'Loan Origination',
    to: '/eligibility',
    anyOf: ['application.read'],
    description: 'Preliminary checks of applications against the approved eligibility rules',
    keywords: ['eligibility check', 'eligibility rules', 'preliminary eligibility', 'credit rules'],
  },
  {
    id: 'lenders',
    label: 'Lenders',
    category: 'Loan Origination',
    to: '/lenders',
    description: 'Lender partners, contact managers, and integrations',
    keywords: ['banks', 'nbfcs', 'lending partners', 'directory'],
  },
  {
    id: 'products',
    label: 'Products',
    category: 'Loan Origination',
    to: '/products',
    description: 'Loan product schemes, interest rates, and criteria',
    keywords: ['schemes', 'interest rates', 'criteria', 'home loan', 'personal loan'],
  },

  // Finance & Settlement
  {
    id: 'commission',
    label: 'Commission',
    category: 'Finance & Settlement',
    to: '/commission',
    anyOf: ['finance.view', 'commission.plan.edit', 'commission.plan.approve'],
    description: 'Commission calculation rules, slabs, and earnings',
    keywords: ['commission plans', 'slabs', 'incentives', 'revenue'],
  },
  {
    id: 'payouts',
    label: 'Payouts',
    category: 'Finance & Settlement',
    to: '/payouts',
    anyOf: ['finance.view', 'payout.request', 'payout.approve', 'payout.record_payment'],
    description: 'Partner payouts, disbursements, and payment batches',
    keywords: ['payout batches', 'transfers', 'agent payout', 'settlement'],
  },
  {
    id: 'ledger',
    label: 'Ledger',
    category: 'Finance & Settlement',
    to: '/ledger',
    anyOf: ['finance.view'],
    description: 'Financial ledger transactions and audit balance entries',
    keywords: ['accounting', 'transactions', 'journal', 'double entry'],
  },
  {
    id: 'invoices',
    label: 'Invoices',
    category: 'Finance & Settlement',
    to: '/invoices',
    anyOf: ['finance.view', 'invoice.manage'],
    description: 'Tax invoices, billing, and GST compliance records',
    keywords: ['gst invoice', 'billing', 'statements', 'tax invoices'],
  },
  {
    id: 'reconciliation',
    label: 'Reconciliation',
    category: 'Finance & Settlement',
    to: '/reconciliation',
    anyOf: ['finance.view', 'finance.reconcile'],
    description: 'Bank statement matching and payout reconciliation',
    keywords: ['bank matching', 'discrepancy', 'statement match', 'reconcile'],
  },

  // Partners & Operations
  {
    id: 'connectors',
    label: 'Connectors',
    category: 'Partners & Operations',
    to: '/connectors',
    anyOf: ['connector.read', 'connector.manage'],
    description: 'DSA connector agents, brokers, and channel partners',
    keywords: ['agents', 'brokers', 'channel partners', 'onboarding'],
  },
  {
    id: 'workforce',
    label: 'Workforce',
    category: 'Partners & Operations',
    to: '/workforce',
    description: 'Employee roster, operational branches, and roles',
    keywords: ['staff directory', 'employees', 'organization workforce'],
  },
  {
    id: 'connector-portal',
    label: 'Connector Portal',
    category: 'Partners & Operations',
    to: '/connector-portal',
    anyOf: ['connector.read', 'connector.manage'],
    description: 'External connector partner dashboard experience',
    keywords: ['partner portal', 'connector view', 'external portal'],
  },

  // Analytics & Performance
  {
    id: 'performance',
    label: 'Performance Dashboard',
    category: 'Analytics & Performance',
    to: '/performance',
    anyOf: ['report.read'],
    description: 'Business conversion metrics and operational KPIs',
    keywords: ['analytics', 'metrics', 'conversion rate', 'funnel', 'kpi'],
  },
  {
    id: 'targets',
    label: 'Targets',
    category: 'Analytics & Performance',
    to: '/targets',
    anyOf: ['report.read', 'target.manage'],
    description: 'Monthly and quarterly branch and team quotas',
    keywords: ['sales goals', 'quotas', 'branch targets', 'performance targets'],
  },
  {
    id: 'performance-leaderboard',
    label: 'Leaderboard',
    category: 'Analytics & Performance',
    submodule: 'Performance',
    to: '/performance/leaderboard',
    anyOf: ['report.read'],
    description: 'Agent rankings and gamified performance leaderboard',
    keywords: ['rankings', 'top performers', 'gamification', 'leaderboard'],
  },
  {
    id: 'reports',
    label: 'Reports & Catalogue',
    category: 'Analytics & Performance',
    to: '/reports',
    anyOf: ['report.read', 'report.manage'],
    description: 'MIS exports, standard reports, and reporting catalogue',
    keywords: ['mis', 'csv export', 'reporting', 'data catalogue'],
  },

  // Governance & Administration
  {
    id: 'rules',
    label: 'Rule Sets',
    category: 'Governance & Administration',
    to: '/rules',
    anyOf: RULE_AUTHORING,
    description: 'Business rules engine, policy sets, and eligibility criteria',
    keywords: ['bre', 'decision rules', 'policy sets', 'underwriting rules'],
  },
  {
    id: 'decisions',
    label: 'Decisions',
    category: 'Governance & Administration',
    to: '/decisions',
    anyOf: ['rule.simulate'],
    description: 'Automated decision execution audit logs and rule simulations',
    keywords: ['decision log', 'simulation', 'rule evaluation audit'],
  },
  {
    id: 'automations',
    label: 'Automation rules',
    category: 'Governance & Administration',
    to: '/automations',
    anyOf: [
      'automation.read',
      'automation.author',
      'automation.approve',
      'automation.execute',
      'automation.operator',
    ],
    description: 'Event-driven triggers, alerts, and automated actions',
    keywords: ['triggers', 'workflows', 'automated actions', 'event rules'],
  },
  {
    id: 'users',
    label: 'Users',
    category: 'Governance & Administration',
    to: '/users',
    anyOf: ['user.manage'],
    description: 'User accounts, invitations, and status administration',
    keywords: ['accounts', 'staff logins', 'user directory'],
  },
  {
    id: 'users-new',
    label: 'Create User',
    category: 'Governance & Administration',
    submodule: 'Users',
    to: '/users/new',
    anyOf: ['user.manage'],
    description: 'Invite or provision a new staff user account',
    keywords: ['new user', 'add user', 'invite user', 'create account'],
  },
  {
    id: 'roles',
    label: 'Access control',
    category: 'Governance & Administration',
    to: '/roles',
    anyOf: ['user.manage', 'role.manage'],
    description: 'RBAC role assignments, permissions, and security policies',
    keywords: ['roles', 'rbac', 'permissions', 'grants', 'access control'],
  },
  {
    id: 'permissions',
    label: 'Permissions Catalog',
    category: 'Governance & Administration',
    submodule: 'Access control',
    to: '/permissions',
    anyOf: ['user.manage', 'role.manage'],
    description: 'Comprehensive directory of system security permissions',
    keywords: ['grants catalog', 'capabilities list', 'permission definitions'],
  },
  {
    id: 'admin-organisation',
    label: 'Organisation',
    category: 'Governance & Administration',
    submodule: 'Administration',
    to: '/admin/organisation',
    anyOf: ['config.manage'],
    description: 'Company information, GSTIN, legal address, and branding',
    keywords: ['company profile', 'tenant settings', 'business details'],
  },
  {
    id: 'admin-branches',
    label: 'Branches',
    category: 'Governance & Administration',
    submodule: 'Administration',
    to: '/admin/branches',
    anyOf: ['config.manage'],
    description: 'Operating branch offices, regional codes, and managers',
    keywords: ['branch offices', 'locations', 'hubs', 'branch management'],
  },
  {
    id: 'admin-teams',
    label: 'Teams',
    category: 'Governance & Administration',
    submodule: 'Administration',
    to: '/admin/teams',
    anyOf: ['config.manage'],
    description: 'Sales and operational teams and hierarchy',
    keywords: ['departments', 'squads', 'groups', 'team management'],
  },
  {
    id: 'admin-queues',
    label: 'Work queues',
    category: 'Governance & Administration',
    submodule: 'Administration',
    to: '/admin/queues',
    anyOf: ['config.manage'],
    description: 'Routing queues and automated task allocation rules',
    keywords: ['distribution', 'work allocation', 'routing queues'],
  },
  {
    id: 'config',
    label: 'Configuration',
    category: 'Governance & Administration',
    to: '/config',
    anyOf: ['config.manage'],
    description: 'Global system configuration, flags, and operational parameters',
    keywords: ['system settings', 'feature flags', 'system parameters'],
  },
  {
    id: 'audit',
    label: 'Audit',
    category: 'Governance & Administration',
    to: '/audit',
    anyOf: ['audit.read', 'audit.export_evidence', 'config.manage'],
    description: 'Tamper-evident audit log and compliance evidence exports',
    keywords: ['compliance log', 'audit trail', 'evidence export', 'history'],
  },
  {
    id: 'privacy',
    label: 'Privacy and consent',
    category: 'Governance & Administration',
    to: '/privacy',
    anyOf: ['audit.read', 'customer.read'],
    description: 'DPDP consent records, data access requests, and privacy policy',
    keywords: ['dpdp', 'consent management', 'gdpr', 'privacy dashboard'],
  },
  {
    id: 'security',
    label: 'Security events and incidents',
    category: 'Governance & Administration',
    to: '/security',
    anyOf: ['security.incident'],
    description: 'Security incident monitoring and suspicious activity review',
    keywords: ['threats', 'soc', 'incident log', 'breaches', 'security alerts'],
  },
  {
    id: 'account-security',
    label: 'Security',
    category: 'Governance & Administration',
    to: '/account/security',
    description: 'MFA setup, authenticator devices, and password settings',
    keywords: ['totp', '2fa', 'mfa', 'password', 'user security'],
  },
  {
    id: 'integrations',
    label: 'Integrations',
    category: 'Governance & Administration',
    to: '/integrations',
    anyOf: ['integration.read', 'integration.manage', 'config.manage'],
    description: 'Lender APIs, document OCR, bureaus, and external webhooks',
    keywords: ['webhooks', 'api connectors', 'third party services'],
  },
  {
    id: 'api-management',
    label: 'API management',
    category: 'Governance & Administration',
    to: '/api-management',
    anyOf: ['api.read', 'api.manage', 'config.manage'],
    description: 'API client credentials, webhook subscriptions, and token access',
    keywords: ['api credentials', 'client keys', 'tokens', 'developer api'],
  },
  {
    id: 'import-export',
    label: 'Import and export',
    category: 'Governance & Administration',
    submodule: 'Administration',
    to: '/admin/import-export',
    anyOf: ['import.run', 'export.run'],
    description: 'Bulk CSV data import, validation, and historical export runs',
    keywords: ['bulk upload', 'csv import', 'data export', 'batch import'],
  },
  {
    id: 'platform-admin',
    label: 'Platform Console',
    category: 'Governance & Administration',
    to: '/platform-admin',
    anyOf: ['platform.console'],
    description: 'Tenant management, platform feature flags, and global operations',
    keywords: ['platform console', 'tenants', 'superadmin', 'platform operator'],
  },
];

/**
 * Filter all main modules and submodules strictly by RBAC permissions and realm.
 * Guarantees that only screens the user is authorized to reach appear in suggestions.
 */
export function getSearchableItems(
  isAdmin: boolean,
  can: (code: string) => boolean = () => false,
  platformRealm = false,
  connectorLogin = false,
  disabledModules: readonly string[] = [],
): SearchableItem[] {
  // A connector portal login searches the portal only (see CONNECTOR_LOGIN_GROUPS).
  if (connectorLogin) {
    return [
      { id: 'connector-portal', label: 'Connector Portal', category: 'Partner', to: '/connector-portal' },
    ];
  }
  return ALL_SEARCHABLE_ITEMS.filter((item) => {
    // 1. Platform realm isolation
    if (platformRealm) {
      return (
        item.to === '/' ||
        item.to === '/account/security' ||
        (item.to === '/platform-admin' && can('platform.console'))
      );
    }

    // 2. Customer realm: NEVER show platform console
    if (item.to === '/platform-admin') {
      return false;
    }

    // 3. Admin-only check
    if (item.adminOnly && !isAdmin) {
      return false;
    }

    // 4. The route rule decides (permissions, module entitlement). The item's own anyOf is not consulted: it was a second copy of the
    // rule that drifted from NAV_GROUPS, and it could only hide what the guard allows.
    return routeAllowed(item.to, can, platformRealm, disabledModules);
  });
}

/**
 * Search and rank suggestions by relevance based on query.
 */
export function searchSuggestions(items: SearchableItem[], query: string): SearchableItem[] {
  const clean = query.trim().toLowerCase();
  if (!clean) return items.slice(0, 8); // top suggestions when empty

  return items
    .map((item) => {
      let score = 0;
      const labelLower = item.label.toLowerCase();
      const submoduleLower = item.submodule ? item.submodule.toLowerCase() : '';
      const categoryLower = item.category.toLowerCase();
      const descLower = item.description ? item.description.toLowerCase() : '';

      // Exact title match gets highest score
      if (labelLower === clean) score += 100;
      else if (labelLower.startsWith(clean)) score += 60;
      else if (labelLower.includes(clean)) score += 40;

      // Submodule match
      if (submoduleLower && submoduleLower.includes(clean)) score += 30;

      // Category match
      if (categoryLower.startsWith(clean)) score += 20;
      else if (categoryLower.includes(clean)) score += 10;

      // Keywords match
      if (item.keywords?.some((k) => k.toLowerCase().includes(clean))) score += 25;

      // Description match
      if (descLower.includes(clean)) score += 10;

      return { item, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item);
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
  | 'disbursement.exception_approve'
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
  | 'audit.seal'
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
  // Converting a lead creates an application: the API gates it with application.create (lead.convert is not a permission).
  'lead.convert': ['application.create'],
  'lead.qualify': ['lead.qualify'],
  'lead.merge': ['lead.merge'],
  'lead.archive': ['lead.archive'],

  // Lender cases
  'lender_case.submit': ['lender_case.submit'],
  'lender_case.update_status': ['lender_case.update_status'],
  'lender_case.package': ['lender_case.submit', 'application.read'],

  // Verifications & Documents
  'verification.create': ['verification.create'],
  // Each action asks for its own permission. document.review (accept or reject a checklist document) is not verification.perform
  // (record a check), so holding one no longer shows the other's buttons.
  'verification.update': ['verification.update', 'verification.perform'],
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
  'disbursement.exception_approve': ['disbursement.exception_approve'],

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
  'audit.seal': ['audit.seal'],
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

export interface SettingsItem {
  id: string;
  label: string;
  category: string;
  to: string;
  description: string;
  iconName: string;
  anyOf?: string[];
  adminOnly?: boolean;
  platformOnly?: boolean;
}

export interface SettingsCategory {
  id: string;
  title: string;
  description: string;
  iconName: string;
  items: SettingsItem[];
}

export const SETTINGS_CATEGORIES: SettingsCategory[] = [
  {
    id: 'org',
    title: 'Organization & Structure',
    description: 'Manage legal entity profile, branch networks, operational teams, and distribution queues',
    iconName: 'BusinessIcon',
    items: [
      {
        id: 'admin-org',
        label: 'Organisation profile',
        category: 'Organization',
        to: '/admin/organisation',
        description: 'Company information, legal branding, PAN, GSTIN & registered headquarters',
        iconName: 'BusinessIcon',
        anyOf: ['config.manage'],
      },
      {
        id: 'admin-branches',
        label: 'Branches',
        category: 'Organization',
        to: '/admin/branches',
        description: 'Operating branch offices, regional codes, city locations & branch managers',
        iconName: 'BusinessIcon',
        anyOf: ['config.manage'],
      },
      {
        id: 'admin-teams',
        label: 'Teams',
        category: 'Organization',
        to: '/admin/teams',
        description: 'Sales and operations teams, reporting hierarchies & team lead assignments',
        iconName: 'PeopleIcon',
        anyOf: ['config.manage'],
      },
      {
        id: 'admin-queues',
        label: 'Work queues',
        category: 'Organization',
        to: '/admin/queues',
        description: 'Automated lead routing, task allocation queues & assignment rules',
        iconName: 'AssignmentIcon',
        anyOf: ['config.manage'],
      },
    ],
  },
  {
    id: 'access',
    title: 'Users & Access Control',
    description: 'Manage employee accounts, directory status, role permissions, and authorization matrix',
    iconName: 'PeopleIcon',
    items: [
      {
        id: 'users',
        label: 'Users & Directory',
        category: 'Users & Access',
        to: '/users',
        description: 'Staff directory, user activation status, branch assignments & login credentials',
        iconName: 'PeopleIcon',
        anyOf: ['user.manage'],
      },
      {
        id: 'roles',
        label: 'Roles & RBAC',
        category: 'Users & Access',
        to: '/roles',
        description: 'Predefined and custom role definitions, permission scopes & access policies',
        iconName: 'AdminPanelSettingsIcon',
        anyOf: ['user.manage', 'role.manage'],
      },
      {
        id: 'permissions',
        label: 'Permissions Matrix',
        category: 'Users & Access',
        to: '/permissions',
        description: 'Granular system security permission catalog and role capability matrix',
        iconName: 'ChecklistIcon',
        anyOf: ['user.manage', 'role.manage'],
      },
    ],
  },
  {
    id: 'system',
    title: 'System & Integrations',
    description: 'Configure operational parameters, API keys, webhooks, third-party connectors & data jobs',
    iconName: 'HubIcon',
    items: [
      {
        id: 'config',
        label: 'Configuration & SLA',
        category: 'System & Integration',
        to: '/config',
        description: 'Global system configuration, operational thresholds, SLA policies & feature flags',
        iconName: 'SettingsIcon',
        anyOf: ['config.manage'],
      },
      {
        id: 'integrations',
        label: 'Integrations',
        category: 'System & Integration',
        to: '/integrations',
        description: 'Third-party API connectors, webhook event dispatchers & partner platforms',
        iconName: 'HubIcon',
        anyOf: ['integration.read', 'integration.manage', 'config.manage'],
      },
      {
        id: 'api-management',
        label: 'API Management',
        category: 'System & Integration',
        to: '/api-management',
        description: 'API keys, token rotation, rate limits, developer credentials & outgoing webhooks',
        iconName: 'KeyIcon',
        anyOf: ['api.read', 'api.manage', 'config.manage'],
      },
      {
        id: 'admin-import-export',
        label: 'Data Import & Export',
        category: 'System & Integration',
        to: '/admin/import-export',
        description: 'Bulk data migration, CSV file uploads, templates and system export records',
        iconName: 'DownloadIcon',
        anyOf: ['import.run', 'export.run'],
      },
    ],
  },
  {
    id: 'compliance',
    title: 'Compliance & Security',
    description: 'Inspect immutable audit trails, data consent records, and security incident investigations',
    iconName: 'ShieldIcon',
    items: [
      {
        id: 'audit',
        label: 'Audit Trail',
        category: 'Compliance & Security',
        to: '/audit',
        description: 'Immutable regulatory audit event logs, actor tracking & compliance evidence export',
        iconName: 'DescriptionIcon',
        anyOf: ['audit.read', 'audit.export_evidence', 'config.manage'],
      },
      {
        id: 'privacy',
        label: 'Privacy & Consent',
        category: 'Compliance & Security',
        to: '/privacy',
        description: 'Customer data consent history, DPDP compliance logs & data subject records',
        iconName: 'VerifiedUserIcon',
        anyOf: ['audit.read', 'customer.read'],
      },
      {
        id: 'security-incidents',
        label: 'Security Incidents',
        category: 'Compliance & Security',
        to: '/security',
        description: 'Security incident monitoring, anomalous event investigations & threat tracking',
        iconName: 'ShieldIcon',
        anyOf: ['security.incident'],
      },
    ],
  },
  {
    id: 'account',
    title: 'My Account & Preferences',
    description: 'Manage personal login security, password changes, and multi-factor authentication (MFA)',
    iconName: 'LockIcon',
    items: [
      {
        id: 'account-security',
        label: 'Account Security & MFA',
        category: 'My Account',
        to: '/account/security',
        description: 'Change login password, configure authenticator app MFA & active session security',
        iconName: 'LockIcon',
      },
    ],
  },
  {
    id: 'platform',
    title: 'Platform Operator',
    description: 'System-wide tenant administration, feature flags, support sessions & telemetry',
    iconName: 'AdminPanelSettingsIcon',
    items: [
      {
        id: 'platform-console',
        label: 'Platform Console',
        category: 'Platform Operator',
        to: '/platform-admin',
        description: 'Multi-tenant infrastructure health, global feature flags & support access',
        iconName: 'AdminPanelSettingsIcon',
        anyOf: ['platform.console'],
        platformOnly: true,
      },
    ],
  },
];

export function visibleSettings(
  isAdmin: boolean,
  can: (code: string) => boolean = () => false,
  platformRealm = false,
  disabledModules: readonly string[] = [],
): SettingsCategory[] {
  return SETTINGS_CATEGORIES.map((cat) => ({
    ...cat,
    items: cat.items.filter((item) => {
      if (item.platformOnly && !platformRealm) return false;
      if (!item.platformOnly && platformRealm && item.to !== '/account/security') return false;
      if (item.adminOnly && !isAdmin && !platformRealm) return false;
      // The route rule decides, like the sidebar and the guard. The item's own anyOf is kept for the platform-only cards, which have no
      // route rule of their own, and for any path no rule covers.
      if (!item.platformOnly && ruleFor(item.to))
        return routeAllowed(item.to, can, platformRealm, disabledModules);
      if (item.anyOf && !item.anyOf.some(can)) return false;
      return true;
    }),
  })).filter((cat) => cat.items.length > 0);
}
