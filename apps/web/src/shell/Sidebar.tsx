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
}

export interface NavGroup {
  title: string;
  /** Hidden unless the user can administer the tenant. */
  adminOnly?: boolean;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Overview',
    items: [{ label: 'Home', to: '/' }],
  },
  {
    title: 'Leads and customers (DOM-B)',
    items: [
      { label: 'Leads', to: '/leads' },
      { label: 'Customers', task: 'MOD-CUST' },
    ],
  },
  {
    title: 'Follow-ups and communication (DOM-C)',
    items: [
      { label: 'Tasks', to: '/tasks' },
      { label: 'Activity', to: '/activities' },
      { label: 'Messaging', to: '/messaging' },
      { label: 'Notifications', to: '/notifications' },
      { label: 'Grievances', to: '/complaints' },
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
      { label: 'Applications', to: '/applications' },
      { label: 'Lender cases', to: '/lender-cases' },
      { label: 'Eligibility', task: 'MOD-ELG' },
      { label: 'Sanction and disbursement', to: '/sanctions' },
    ],
  },
  {
    title: 'KYC, documents and verification (DOM-F)',
    items: [
      { label: 'Documents', task: 'MOD-DOC' },
      { label: 'Document sharing', to: '/document-sharing' },
      { label: 'Verification', to: '/verifications' },
    ],
  },
  {
    title: 'Business rules (DOM-G)',
    items: [
      { label: 'Rule sets', to: '/rules' },
      { label: 'Decisions', to: '/decisions' },
    ],
  },
  {
    title: 'Workflow automation (DOM-H)',
    items: [{ label: 'Automation rules', task: 'MOD-WFA' }],
  },
  {
    title: 'Team and performance (DOM-I)',
    items: [
      { label: 'Performance', task: 'MOD-PERF' },
      { label: 'Workforce', task: 'MOD-WRK' },
    ],
  },
  {
    title: 'Connectors (DOM-J)',
    items: [
      { label: 'Connectors', to: '/connectors' },
      { label: 'Connector portal', task: 'MOD-CPT' },
    ],
  },
  {
    title: 'Commission, payouts and reconciliation (DOM-K)',
    items: [
      { label: 'Commission', task: 'MOD-COM' },
      { label: 'Ledger', task: 'MOD-LED' },
      { label: 'Payouts', task: 'MOD-PAY' },
      { label: 'Reconciliation', task: 'MOD-REC' },
      { label: 'Invoices', task: 'MOD-INV' },
    ],
  },
  {
    title: 'Reporting (DOM-L)',
    items: [{ label: 'Reports', task: 'MOD-RPT' }],
  },
  {
    title: 'Integrations and API (DOM-M)',
    items: [
      { label: 'Integrations', to: '/integrations' },
      { label: 'API management', task: 'MOD-API' },
    ],
  },
  {
    title: 'Security and compliance (DOM-N)',
    items: [
      { label: 'Audit', task: 'MOD-AUD' },
      { label: 'Privacy and consent', to: '/privacy' },
      { label: 'Security', to: '/account/security' },
    ],
  },
  {
    title: 'Administration (DOM-O)',
    adminOnly: true,
    items: [
      { label: 'Organisation', to: '/admin/organisation' },
      { label: 'Branches', to: '/admin/branches' },
      { label: 'Teams', to: '/admin/teams' },
      { label: 'Work queues', to: '/admin/queues' },
      { label: 'Users', to: '/users' },
      { label: 'Access control', to: '/roles' },
      { label: 'Configuration', to: '/config' },
      { label: 'Platform Console', to: '/platform-admin' },
      { label: 'Import and export', task: 'MOD-IMP' },
    ],
  },
];

/** Groups and items the current user may see. */
export function visibleGroups(isAdmin: boolean): NavGroup[] {
  return NAV_GROUPS.filter((g) => !g.adminOnly || isAdmin);
}

export function SidebarContent({ isAdmin, onNavigate }: { isAdmin: boolean; onNavigate?: () => void }) {
  return (
    <Box data-testid="shell.sidebar" sx={{ py: 1, pb: 6 }}>
      {visibleGroups(isAdmin).map((group, i) => (
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
