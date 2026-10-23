// Sidebar navigation (owner: Dev 1). Refactored into 7 Operational Workspaces.
// Supports both full expanded navigation and compact collapsible rail navigation.
import {
  Box,
  Chip,
  Collapse,
  Divider,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Tooltip,
  Typography,
} from '@mui/material';
import { type ReactNode, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { NAV_GROUPS, visibleGroups } from './access';
import {
  AccountBalanceIcon,
  AdminPanelSettingsIcon,
  AssessmentIcon,
  AssignmentIcon,
  BusinessIcon,
  ChecklistIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DashboardIcon,
  DescriptionIcon,
  ExpandLessIcon,
  ExpandMoreIcon,
  HubIcon,
  InboxIcon,
  LockIcon,
  NotificationsIcon,
  PeopleIcon,
  SettingsIcon,
  ShieldIcon,
  TrendingUpIcon,
  VerifiedUserIcon,
} from './icons';

export { NAV_GROUPS, visibleGroups };
export type { NavGroup, NavItem } from './access';

const STORAGE_KEY = 'qloax_sidebar_sections_v2';

function getCategoryIcon(title: string): ReactNode {
  switch (title) {
    case 'Workspace':
      return <DashboardIcon fontSize="small" sx={{ color: 'primary.main', mr: 1 }} />;
    case 'Sales & CRM':
      return <PeopleIcon fontSize="small" sx={{ color: 'primary.main', mr: 1 }} />;
    case 'Loan Origination':
      return <AssignmentIcon fontSize="small" sx={{ color: 'primary.main', mr: 1 }} />;
    case 'Finance & Settlement':
      return <AccountBalanceIcon fontSize="small" sx={{ color: 'primary.main', mr: 1 }} />;
    case 'Partners & Operations':
      return <HubIcon fontSize="small" sx={{ color: 'primary.main', mr: 1 }} />;
    case 'Analytics & Performance':
      return <AssessmentIcon fontSize="small" sx={{ color: 'primary.main', mr: 1 }} />;
    case 'Governance & Administration':
      return <AdminPanelSettingsIcon fontSize="small" sx={{ color: 'primary.main', mr: 1 }} />;
    default:
      return null;
  }
}

function getItemIcon(label: string, categoryTitle?: string): ReactNode {
  switch (label) {
    case 'Home':
      return <DashboardIcon fontSize="small" />;
    case 'Tasks':
    case 'Verification workbench':
      return <ChecklistIcon fontSize="small" />;
    case 'Approvals':
      return <VerifiedUserIcon fontSize="small" />;
    case 'Activity':
      return <TrendingUpIcon fontSize="small" />;
    case 'Notifications':
      return <NotificationsIcon fontSize="small" />;
    case 'Leads':
    case 'Customers':
    case 'Workforce':
    case 'Users':
      return <PeopleIcon fontSize="small" />;
    case 'Messaging':
      return <InboxIcon fontSize="small" />;
    case 'Grievances':
      return <ShieldIcon fontSize="small" />;
    case 'Applications':
    case 'Lender cases':
    case 'Sanction and disbursement':
      return <AssignmentIcon fontSize="small" />;
    case 'Documents':
    case 'Document sharing':
      return <DescriptionIcon fontSize="small" />;
    case 'Verification':
      return <VerifiedUserIcon fontSize="small" />;
    case 'Lenders':
    case 'Organisation':
    case 'Branches':
      return <BusinessIcon fontSize="small" />;
    case 'Products':
      return <HubIcon fontSize="small" />;
    case 'Commission':
    case 'Payouts':
    case 'Ledger':
    case 'Invoices':
    case 'Reconciliation':
      return <AccountBalanceIcon fontSize="small" />;
    case 'Connectors':
    case 'Connector portal':
    case 'Integrations':
    case 'API management':
      return <HubIcon fontSize="small" />;
    case 'Performance Dashboard':
    case 'Targets':
    case 'Leaderboard':
    case 'Reports & Catalogue':
      return <AssessmentIcon fontSize="small" />;
    case 'Rule sets':
    case 'Decisions':
    case 'Automation rules':
    case 'Audit':
    case 'Privacy and consent':
      return <AdminPanelSettingsIcon fontSize="small" />;
    case 'Security events and incidents':
    case 'Security':
      return <LockIcon fontSize="small" />;
    case 'Configuration':
    case 'Work queues':
    case 'Access control':
    case 'Import and export':
    case 'Platform Console':
      return <SettingsIcon fontSize="small" />;
    default:
      return categoryTitle ? getCategoryIcon(categoryTitle) : <DashboardIcon fontSize="small" />;
  }
}

export function SidebarContent({
  isAdmin,
  can,
  platformRealm,
  onNavigate,
  collapsed = false,
  onToggleCollapse,
}: {
  isAdmin: boolean;
  can?: (code: string) => boolean;
  platformRealm?: boolean;
  onNavigate?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const groups = visibleGroups(isAdmin, can, platformRealm);

  // Initialize all visible groups to expanded (true) by default
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        return JSON.parse(saved) as Record<string, boolean>;
      }
    } catch {
      // Fallback silently if localStorage is restricted
    }
    return {};
  });

  const toggleGroup = (title: string) => {
    setExpanded((prev) => {
      const currentlyOpen = prev[title] !== false;
      const next = { ...prev, [title]: !currentlyOpen };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore storage write errors
      }
      return next;
    });
  };

  return (
    <Box
      data-testid="shell.sidebar"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: '100%',
        py: 1,
      }}
    >
      <Box sx={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        {groups.map((group, i) => {
          const isOpen = expanded[group.title] !== false;

          // Collapsed rail mode: Show compact icon list with tooltips
          if (collapsed) {
            return (
              <Box key={group.title} sx={{ px: 0.75 }}>
                {i > 0 && <Divider sx={{ my: 1, mx: 1, borderColor: 'divider' }} />}
                <List dense disablePadding>
                  {group.items.map((item) =>
                    item.to ? (
                      <Tooltip key={item.label} title={item.label} placement="right" arrow>
                        <ListItemButton
                          component={NavLink}
                          to={item.to}
                          end={item.to === '/'}
                          onClick={onNavigate}
                          data-testid={`shell.nav.${item.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                          sx={{
                            minHeight: 44,
                            justifyContent: 'center',
                            px: 1,
                            my: 0.4,
                            borderRadius: 2,
                            color: 'text.secondary',
                            transition: 'all 0.15s ease',
                            '&:hover': {
                              bgcolor: 'action.hover',
                              color: 'text.primary',
                            },
                            '&.active': {
                              bgcolor: 'rgba(56, 118, 190, 0.12)',
                              color: '#215988',
                              position: 'relative',
                              '&::before': {
                                content: '""',
                                position: 'absolute',
                                left: 2,
                                top: '20%',
                                bottom: '20%',
                                width: 3.5,
                                borderRadius: 2,
                                bgcolor: '#F89344',
                              },
                            },
                          }}
                        >
                          <ListItemIcon sx={{ minWidth: 0, justifyContent: 'center', color: 'inherit' }}>
                            {getItemIcon(item.label, group.title)}
                          </ListItemIcon>
                        </ListItemButton>
                      </Tooltip>
                    ) : (
                      <Tooltip
                        key={item.label}
                        title={`${item.label} (Coming soon)`}
                        placement="right"
                        arrow
                      >
                        <span>
                          <ListItemButton
                            disabled
                            sx={{
                              minHeight: 44,
                              justifyContent: 'center',
                              px: 1,
                              my: 0.4,
                              borderRadius: 2,
                              opacity: 0.45,
                            }}
                          >
                            <ListItemIcon sx={{ minWidth: 0, justifyContent: 'center', color: 'text.disabled' }}>
                              {getItemIcon(item.label, group.title)}
                            </ListItemIcon>
                          </ListItemButton>
                        </span>
                      </Tooltip>
                    ),
                  )}
                </List>
              </Box>
            );
          }

          // Expanded mode: Full operational workspaces with expandable sections
          return (
            <Box key={group.title}>
              {i > 0 && <Divider sx={{ my: 1 }} />}
              <List
                dense
                disablePadding
                subheader={
                  <ListSubheader
                    component="div"
                    onClick={() => toggleGroup(group.title)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggleGroup(group.title);
                      }
                    }}
                    tabIndex={0}
                    role="button"
                    aria-expanded={isOpen}
                    sx={{
                      lineHeight: '32px',
                      fontSize: 12,
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      color: 'text.secondary',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: 'pointer',
                      userSelect: 'none',
                      px: 2,
                      '&:hover': {
                        bgcolor: 'action.hover',
                      },
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                      {getCategoryIcon(group.title)}
                      <Typography variant="caption" sx={{ fontWeight: 700, fontSize: 11 }}>
                        {group.title}
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                      {isOpen ? (
                        <ExpandLessIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
                      ) : (
                        <ExpandMoreIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
                      )}
                    </Box>
                  </ListSubheader>
                }
              >
                <Collapse in={isOpen} timeout="auto" unmountOnExit={false}>
                  {group.items.map((item) =>
                    item.to ? (
                      <ListItemButton
                        key={item.label}
                        component={NavLink}
                        to={item.to}
                        end={item.to === '/'}
                        onClick={onNavigate}
                        data-testid={`shell.nav.${item.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                        sx={{
                          pl: 2.5,
                          py: 0.6,
                          borderRadius: 1.5,
                          mx: 1,
                          my: 0.2,
                          color: 'text.secondary',
                          transition: 'all 0.15s ease',
                          '&:hover': {
                            bgcolor: 'action.hover',
                            color: 'text.primary',
                          },
                          '&.active': {
                            bgcolor: 'rgba(56, 118, 190, 0.08)',
                            fontWeight: 700,
                            color: '#215988',
                            position: 'relative',
                            '&::before': {
                              content: '""',
                              position: 'absolute',
                              left: 4,
                              top: '20%',
                              bottom: '20%',
                              width: 3.5,
                              borderRadius: 2,
                              bgcolor: '#F89344',
                            },
                          },
                        }}
                      >
                        <ListItemIcon sx={{ minWidth: 26, color: 'inherit' }}>
                          {getItemIcon(item.label, group.title)}
                        </ListItemIcon>
                        <ListItemText
                          primary={item.label}
                          primaryTypographyProps={{ fontSize: 13, fontWeight: 'inherit' }}
                        />
                      </ListItemButton>
                    ) : (
                      <Tooltip
                        key={item.label}
                        title={`Not built yet${item.task ? ` (${item.task})` : ''}`}
                        placement="right"
                      >
                        <span>
                          <ListItemButton disabled sx={{ pl: 2.5, py: 0.5, mx: 1, my: 0.25 }}>
                            <ListItemIcon sx={{ minWidth: 26, color: 'inherit', opacity: 0.5 }}>
                              {getItemIcon(item.label, group.title)}
                            </ListItemIcon>
                            <ListItemText primary={item.label} primaryTypographyProps={{ fontSize: 13 }} />
                            <Chip label="Soon" size="small" variant="outlined" sx={{ height: 18, fontSize: 10 }} />
                          </ListItemButton>
                        </span>
                      </Tooltip>
                    ),
                  )}
                </Collapse>
              </List>
            </Box>
          );
        })}
      </Box>

      {/* Collapse / Expand Toggle Control at bottom */}
      {onToggleCollapse && (
        <Box
          sx={{
            pt: 1,
            px: collapsed ? 0.5 : 1.5,
            borderTop: '1px solid',
            borderColor: 'divider',
            display: 'flex',
            justifyContent: collapsed ? 'center' : 'flex-end',
            alignItems: 'center',
          }}
        >
          <Tooltip title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} placement={collapsed ? 'right' : 'top'} arrow>
            <IconButton
              size="small"
              onClick={onToggleCollapse}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              sx={{
                color: 'text.secondary',
                bgcolor: 'action.hover',
                borderRadius: 1.5,
                '&:hover': { bgcolor: 'action.selected', color: 'primary.main' },
              }}
            >
              {collapsed ? <ChevronRightIcon fontSize="small" /> : <ChevronLeftIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        </Box>
      )}
    </Box>
  );
}
