// Sidebar navigation (owner: Dev 1). Groups follow the 15 DSA domains in the spec (DSA Notion, section 2). Items with a
// screen link to it. Items whose module is not built yet are shown greyed out with "Soon", so the whole product is
// visible without linking to empty pages. Admin-only groups appear only for users with config.manage or user.manage.
import {
  Box,
  Chip,
  Divider,
  List,
  ListItemButton,
  ListItemText,
  ListSubheader,
  Tooltip,
} from '@mui/material';
import { NavLink } from 'react-router-dom';

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
// Items without anyOf (Home, Activity, Notifications, Lenders, Products, Security and the Soon items) are shown to
// everyone: the spec says any staff may read them, so there is no permission to check.
const RULE_PERMISSIONS = ['rule.author', 'rule.simulate', 'rule.approve', 'rule.publish', 'rule.suspend'];

export const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Overview',
    items: [{ label: 'Home', to: '/' }],
  },
  {
    title: 'Leads and customers (DOM-B)',
    items: [
      { label: 'Leads', to: '/leads' },
      { label: 'Customers', to: '/customers' },
    ],
  },
  {
    title: 'Follow-ups and communication (DOM-C)',
    items: [
      { label: 'Tasks', to: '/tasks', anyOf: ['task.read'] },
      { label: 'Activity', to: '/activities' },
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
      { label: 'Documents', task: 'MOD-DOC' },
      { label: 'Document sharing', to: '/document-sharing', anyOf: ['document.upload', 'share.create'] },
      { label: 'Verification', to: '/verifications', anyOf: ['verification.read', 'verification.perform'] },
      { label: 'Verification workbench', to: '/verifications/workbench' },
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
    items: [{ label: 'Automation rules', to: '/automations' }],
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
      { label: 'Commission', to: '/commission' },
      { label: 'Ledger', to: '/ledger', anyOf: ['finance.view'] },
      { label: 'Payouts', to: '/payouts' },
      { label: 'Reconciliation', to: '/reconciliation' },
      { label: 'Invoices', to: '/invoices' },
    ],
  },
  {
    title: 'Reporting (DOM-L)',
    items: [
      { label: 'Reports & Catalogue', to: '/reports', anyOf: ['report.read', 'report.manage'] },
      { label: 'Performance Dashboards', to: '/performance', anyOf: ['report.read'] },
    ],
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
      { label: 'Access control', to: '/roles', anyOf: ['user.manage'] },
      { label: 'Configuration', to: '/config', anyOf: ['config.manage'] },
      { label: 'Platform Console', to: '/platform-admin', anyOf: ['platform.console'] },
      { label: 'Import and export', to: '/admin/import-export', anyOf: ['import.run', 'export.run'] },
    ],
  },
];

/** Groups and items the current user may see. A group with no visible item is dropped. */
export function visibleGroups(isAdmin: boolean, can: (code: string) => boolean = () => true): NavGroup[] {
  return NAV_GROUPS.filter((g) => !g.adminOnly || isAdmin)
    .map((g) => ({ ...g, items: g.items.filter((i) => !i.anyOf || i.anyOf.some(can)) }))
    .filter((g) => g.items.length > 0);
}

export function SidebarContent({
  isAdmin,
  can,
  onNavigate,
}: {
  isAdmin: boolean;
  can?: (code: string) => boolean;
  onNavigate?: () => void;
}) {
  return (
    <Box data-testid="shell.sidebar" sx={{ py: 1, pb: 6 }}>
      {visibleGroups(isAdmin, can).map((group, i) => (
        <Box key={group.title}>
          {i > 0 && <Divider sx={{ my: 1 }} />}
          <List
            dense
            disablePadding
            subheader={<ListSubheader sx={{ lineHeight: '28px', fontSize: 12 }}>{group.title}</ListSubheader>}
          >
            {group.items.map((item) =>
              item.to ? (
                <ListItemButton
                  key={item.label}
                  component={NavLink}
                  to={item.to}
                  end={item.to === '/'}
                  onClick={onNavigate}
                  data-testid={`shell.nav.${item.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                  sx={{ pl: 3, '&.active': { bgcolor: 'action.selected', fontWeight: 600 } }}
                >
                  <ListItemText primary={item.label} primaryTypographyProps={{ fontSize: 14 }} />
                </ListItemButton>
              ) : (
                <Tooltip
                  key={item.label}
                  title={`Not built yet${item.task ? ` (${item.task})` : ''}`}
                  placement="right"
                >
                  <span>
                    <ListItemButton disabled sx={{ pl: 3 }}>
                      <ListItemText primary={item.label} primaryTypographyProps={{ fontSize: 14 }} />
                      <Chip label="Soon" size="small" variant="outlined" sx={{ height: 20, fontSize: 11 }} />
                    </ListItemButton>
                  </span>
                </Tooltip>
              ),
            )}
          </List>
        </Box>
      ))}
    </Box>
  );
}
