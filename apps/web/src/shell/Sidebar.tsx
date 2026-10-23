// Sidebar navigation (owner: Dev 1). Refactored into 7 Operational Workspaces.
// In expanded mode: clean workspace navigation matching original design (no sub-item icons).
// In collapsed mode: compact rail displaying main orange workspace category icons with tooltips.
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
import { NavLink, useLocation } from 'react-router-dom';
import { NAV_GROUPS, visibleGroups } from './access';
import {
  AccountBalanceIcon,
  AdminPanelSettingsIcon,
  AssessmentIcon,
  AssignmentIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DashboardIcon,
  ExpandLessIcon,
  ExpandMoreIcon,
  HubIcon,
  PeopleIcon,
} from './icons';

export { NAV_GROUPS, visibleGroups };
export type { NavGroup, NavItem } from './access';

const STORAGE_KEY = 'qloax_sidebar_sections_v2';

function getMainCategoryIcon(title: string, size: number = 22): ReactNode {
  const sx = { color: '#F89344', fontSize: size };
  switch (title) {
    case 'Workspace':
      return <DashboardIcon sx={sx} />;
    case 'Sales & CRM':
      return <PeopleIcon sx={sx} />;
    case 'Loan Origination':
      return <AssignmentIcon sx={sx} />;
    case 'Finance & Settlement':
      return <AccountBalanceIcon sx={sx} />;
    case 'Partners & Operations':
      return <HubIcon sx={sx} />;
    case 'Analytics & Performance':
      return <AssessmentIcon sx={sx} />;
    case 'Governance & Administration':
      return <AdminPanelSettingsIcon sx={sx} />;
    default:
      return <DashboardIcon sx={sx} />;
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
  const location = useLocation();
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
        {collapsed ? (
          // Collapsed mode: Only show the main orange category icons with rich tooltips
          <List dense disablePadding sx={{ px: 0.75 }}>
            {groups.map((group, i) => {
              const primaryItem = group.items.find((item) => item.to);
              const isGroupActive = group.items.some(
                (item) =>
                  item.to &&
                  (location.pathname === item.to ||
                    (item.to !== '/' && location.pathname.startsWith(item.to))),
              );

              return (
                <Box key={group.title}>
                  {i > 0 && <Divider sx={{ my: 0.75, mx: 1, borderColor: 'divider' }} />}
                  <Tooltip
                    title={
                      <Box sx={{ p: 0.5, maxWidth: 220 }}>
                        <Typography
                          variant="caption"
                          sx={{ fontWeight: 700, color: '#F89344', display: 'block', mb: 0.5 }}
                        >
                          {group.title}
                        </Typography>
                        {group.items.slice(0, 5).map((item) => (
                          <Typography
                            key={item.label}
                            variant="caption"
                            sx={{
                              display: 'block',
                              color: 'text.secondary',
                              fontSize: 11,
                              lineHeight: 1.4,
                            }}
                          >
                            • {item.label}
                          </Typography>
                        ))}
                        {group.items.length > 5 && (
                          <Typography
                            variant="caption"
                            sx={{ color: 'text.disabled', fontSize: 10, display: 'block', mt: 0.25 }}
                          >
                            +{group.items.length - 5} more items
                          </Typography>
                        )}
                      </Box>
                    }
                    placement="right"
                    arrow
                  >
                    <ListItemButton
                      component={primaryItem ? NavLink : 'div'}
                      to={primaryItem?.to}
                      end={primaryItem?.to === '/'}
                      onClick={onNavigate}
                      data-testid={`shell.nav.category.${group.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                      sx={{
                        minHeight: 48,
                        justifyContent: 'center',
                        alignItems: 'center',
                        px: 1,
                        my: 0.4,
                        borderRadius: 2,
                        bgcolor: isGroupActive ? 'rgba(248, 147, 68, 0.12)' : 'transparent',
                        position: 'relative',
                        transition: 'all 0.15s ease',
                        '&:hover': {
                          bgcolor: 'rgba(248, 147, 68, 0.18)',
                        },
                        ...(isGroupActive && {
                          '&::before': {
                            content: '""',
                            position: 'absolute',
                            left: 3,
                            top: '20%',
                            bottom: '20%',
                            width: 3.5,
                            borderRadius: 2,
                            bgcolor: '#F89344',
                          },
                        }),
                      }}
                    >
                      <ListItemIcon
                        sx={{
                          minWidth: 0,
                          justifyContent: 'center',
                          color: '#F89344',
                        }}
                      >
                        {getMainCategoryIcon(group.title, 22)}
                      </ListItemIcon>
                    </ListItemButton>
                  </Tooltip>
                </Box>
              );
            })}
          </List>
        ) : (
          // Expanded mode: Keep same like old with main orange category icon on subheaders and clean text items
          groups.map((group, i) => {
            const isOpen = expanded[group.title] !== false;
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
                        <Box sx={{ display: 'inline-flex', mr: 1, alignItems: 'center' }}>
                          {getMainCategoryIcon(group.title, 18)}
                        </Box>
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
                            pl: 3,
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
                            <ListItemButton disabled sx={{ pl: 3.5, py: 0.5, mx: 1, my: 0.25 }}>
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
          })
        )}
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
