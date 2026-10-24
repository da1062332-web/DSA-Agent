// Sidebar navigation (owner: Dev 1). Refactored into 7 Operational Workspaces.
// In expanded mode: clean workspace navigation matching original design (no sub-item icons).
// In collapsed mode: compact rail displaying main orange workspace category icons in line with the top toggle.
// Clicking an orange category icon opens the sidebar and expands that section's dropdown.
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
import { type ReactNode, useEffect, useState } from 'react';
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

function getMainCategoryIcon(title: string, size: number = 24): ReactNode {
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
  onOpenSection,
}: {
  isAdmin: boolean;
  can?: (code: string) => boolean;
  platformRealm?: boolean;
  onNavigate?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onOpenSection?: (title: string) => void;
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

  const [scrollTarget, setScrollTarget] = useState<string | null>(null);

  useEffect(() => {
    if (!collapsed && scrollTarget) {
      const timer = setTimeout(() => {
        const id = `nav-group-${scrollTarget.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
        const el = document.getElementById(id);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        setScrollTarget(null);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [collapsed, scrollTarget]);

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

  const handleCategoryClick = (title: string) => {
    // 1. Ensure this section is open when sidebar expands
    setExpanded((prev) => {
      const next = { ...prev, [title]: true };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // storage unavailable (private mode or blocked); safe to ignore
      }
      return next;
    });

    // 2. Queue smooth scroll to this section once the drawer opens
    setScrollTarget(title);

    // 3. Expand sidebar
    if (onOpenSection) {
      onOpenSection(title);
    } else if (onToggleCollapse) {
      onToggleCollapse();
    }
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
          // Collapsed rail mode: Perfectly centered orange icons aligned with the top hamburger menu
          <Box sx={{ py: 0.5, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            {groups.map((group, i) => {
              const isGroupActive = group.items.some(
                (item) =>
                  item.to &&
                  (location.pathname === item.to ||
                    (item.to !== '/' && location.pathname.startsWith(item.to))),
              );

              return (
                <Box
                  key={group.title}
                  sx={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}
                >
                  {i > 0 && <Divider sx={{ width: 44, my: 1, borderColor: '#e2e8f0' }} />}
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
                      onClick={() => handleCategoryClick(group.title)}
                      data-testid={`shell.nav.category.${group.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                      sx={{
                        width: 52,
                        height: 52,
                        minHeight: 52,
                        maxWidth: 52,
                        p: 0,
                        justifyContent: 'center',
                        alignItems: 'center',
                        borderRadius: '16px',
                        bgcolor: isGroupActive ? 'rgba(248, 147, 68, 0.12)' : 'transparent',
                        position: 'relative',
                        transition: 'all 0.15s ease',
                        '&:hover': {
                          bgcolor: isGroupActive ? 'rgba(248, 147, 68, 0.18)' : 'rgba(248, 147, 68, 0.08)',
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
                        {getMainCategoryIcon(group.title, 24)}
                      </ListItemIcon>
                    </ListItemButton>
                  </Tooltip>
                </Box>
              );
            })}
          </Box>
        ) : (
          // Expanded mode: Clean, professional workspace navigation with orange category icons and no outline glitches
          groups.map((group, i) => {
            const isOpen = expanded[group.title] !== false;
            return (
              <Box
                key={group.title}
                id={`nav-group-${group.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                sx={{ scrollMarginTop: '8px' }}
              >
                {i > 0 && <Divider sx={{ my: 0.75, mx: 1.5, borderColor: '#f1f5f9' }} />}
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
                        position: 'relative',
                        bgcolor: 'transparent',
                        lineHeight: '34px',
                        fontSize: 11.5,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        color: '#334155',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        cursor: 'pointer',
                        userSelect: 'none',
                        px: 1.5,
                        mx: 1,
                        my: 0.2,
                        borderRadius: 1.5,
                        outline: 'none !important',
                        border: 'none !important',
                        boxShadow: 'none !important',
                        '&:hover': {
                          bgcolor: 'rgba(0, 0, 0, 0.04)',
                        },
                        '&:focus-visible': {
                          bgcolor: 'rgba(248, 147, 68, 0.08)',
                        },
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center' }}>
                        <Box sx={{ display: 'inline-flex', mr: 1, alignItems: 'center' }}>
                          {getMainCategoryIcon(group.title, 18)}
                        </Box>
                        <Typography
                          variant="caption"
                          sx={{ fontWeight: 700, fontSize: 11.5, color: 'inherit' }}
                        >
                          {group.title}
                        </Typography>
                      </Box>
                      <Box sx={{ display: 'flex', alignItems: 'center' }}>
                        {isOpen ? (
                          <ExpandLessIcon sx={{ fontSize: 18, color: '#64748b' }} />
                        ) : (
                          <ExpandMoreIcon sx={{ fontSize: 18, color: '#64748b' }} />
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
                            pl: 3.5,
                            pr: 2,
                            py: 0.55,
                            borderRadius: 1.5,
                            mx: 1,
                            my: 0.2,
                            color: '#475569',
                            transition: 'all 0.15s ease',
                            '&:hover': {
                              bgcolor: 'rgba(33, 89, 136, 0.05)',
                              color: '#0f172a',
                            },
                            '&.active': {
                              bgcolor: 'rgba(248, 147, 68, 0.1)',
                              fontWeight: 600,
                              color: '#215988',
                              position: 'relative',
                              '&::before': {
                                content: '""',
                                position: 'absolute',
                                left: 6,
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
                            <ListItemButton disabled sx={{ pl: 3.5, pr: 2, py: 0.5, mx: 1, my: 0.2 }}>
                              <ListItemText
                                primary={item.label}
                                primaryTypographyProps={{ fontSize: 13, color: '#94a3b8' }}
                              />
                              <Chip
                                label="Soon"
                                size="small"
                                variant="outlined"
                                sx={{
                                  height: 18,
                                  fontSize: 10,
                                  borderColor: '#cbd5e1',
                                  color: '#64748b',
                                  fontWeight: 500,
                                }}
                              />
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
          <Tooltip
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            placement={collapsed ? 'right' : 'top'}
            arrow
          >
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
