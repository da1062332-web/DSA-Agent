// Sidebar navigation (owner: Dev 1). Refactored into 7 Operational Workspaces.
// In expanded mode: clean workspace navigation matching original design (no sub-item icons).
// In collapsed mode: compact rail displaying main orange workspace category icons in line with the top toggle.
// Clicking an orange category icon opens the sidebar and expands that section's dropdown.
import {
  Box,
  Chip,
  ClickAwayListener,
  Collapse,
  Divider,
  IconButton,
  InputBase,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Paper,
  Popper,
  Tooltip,
  Typography,
} from '@mui/material';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  getSearchableItems,
  NAV_GROUPS,
  searchSuggestions,
  type SearchableItem,
  visibleGroups,
} from './access';
import {
  AccountBalanceIcon,
  AdminPanelSettingsIcon,
  AssessmentIcon,
  AssignmentIcon,
  CloseIcon,
  DashboardIcon,
  ExpandLessIcon,
  ExpandMoreIcon,
  HubIcon,
  MenuIcon,
  PeopleIcon,
  SearchIcon,
  SettingsIcon,
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
    case 'Rules':
    case 'Policy & Rules':
    case 'Governance & Administration':
      return <AdminPanelSettingsIcon sx={sx} />;
    case 'Settings':
      return <SettingsIcon sx={sx} />;
    default:
      return <DashboardIcon sx={sx} />;
  }
}

function HighlightMatch({ text, query }: { text: string; query: string }) {
  const trimmed = query.trim();
  if (!trimmed) {
    return <>{text}</>;
  }

  const words = trimmed
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

  if (words.length === 0) return <>{text}</>;

  const pattern = `(${words.join('|')})`;
  const parts = text.split(new RegExp(pattern, 'gi'));
  const testRegex = new RegExp(`^(${words.join('|')})$`, 'i');

  return (
    <>
      {parts.map((part, i) =>
        testRegex.test(part) ? (
          <Box
            key={i}
            component="span"
            sx={{
              color: '#000000',
              fontWeight: 800,
              bgcolor: 'rgba(15, 23, 42, 0.1)',
              px: '3px',
              py: '0.5px',
              borderRadius: '3px',
            }}
          >
            {part}
          </Box>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

export function SidebarContent({
  isAdmin,
  can,
  platformRealm,
  onNavigate,
  collapsed = false,
  onToggleCollapse,
  onOpenSection,
  currentWidth = 290,
  minWidth = 240,
  maxWidth = 420,
  onIncreaseWidth,
  onDecreaseWidth,
  onResetWidth,
}: {
  isAdmin: boolean;
  can?: (code: string) => boolean;
  platformRealm?: boolean;
  onNavigate?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onOpenSection?: (title: string) => void;
  currentWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  onIncreaseWidth?: () => void;
  onDecreaseWidth?: () => void;
  onResetWidth?: () => void;
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
  const [searchQuery, setSearchQuery] = useState('');

  const navigate = useNavigate();
  const searchContainerRef = useRef<HTMLDivElement | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  // All modules and submodules filtered strictly by user permissions and realm (RBAC)
  const accessibleItems = useMemo(
    () => getSearchableItems(isAdmin, can, platformRealm),
    [isAdmin, can, platformRealm],
  );

  // Suggestions ranked by search relevance
  const suggestions = useMemo(
    () => searchSuggestions(accessibleItems, searchQuery),
    [accessibleItems, searchQuery],
  );

  useEffect(() => {
    setHighlightedIndex(0);
  }, [searchQuery]);

  const handleSelectSuggestion = (item: SearchableItem) => {
    navigate(item.to);
    setSearchQuery('');
    setIsFocused(false);
    if (onNavigate) {
      onNavigate();
    }
  };

  useEffect(() => {
    if (collapsed) {
      setSearchQuery('');
      setIsFocused(false);
    }
  }, [collapsed]);

  // Operational workspaces vs Settings Hub:
  // For tenant realm, Governance & Administration is streamlined into "Rules"
  // (Rule sets, Decisions, Automation rules), while all administrative modules are centralized in Settings Hub.
  const displayGroups = useMemo(() => {
    if (platformRealm) return groups;
    return groups
      .map((g) => {
        if (g.title === 'Governance & Administration') {
          const operationalRules = g.items.filter((item) =>
            ['/rules', '/decisions', '/automations'].includes(item.to ?? ''),
          );
          return {
            ...g,
            title: 'Rules',
            items: operationalRules,
          };
        }
        return g;
      })
      .filter((g) => g.items.length > 0);
  }, [groups, platformRealm]);

  const isSettingsActive =
    location.pathname === '/settings' ||
    location.pathname.startsWith('/settings/') ||
    location.pathname.startsWith('/admin') ||
    location.pathname.startsWith('/users') ||
    location.pathname.startsWith('/roles') ||
    location.pathname.startsWith('/permissions') ||
    location.pathname.startsWith('/config') ||
    location.pathname.startsWith('/integrations') ||
    location.pathname.startsWith('/api-management') ||
    location.pathname.startsWith('/audit') ||
    location.pathname.startsWith('/privacy') ||
    location.pathname.startsWith('/security') ||
    location.pathname.startsWith('/account/security') ||
    location.pathname.startsWith('/platform-admin');

  const query = searchQuery.trim().toLowerCase();
  const filteredGroups = query
    ? displayGroups
        .map((group) => {
          const groupTitleMatches = group.title.toLowerCase().includes(query);
          const matchingItems = groupTitleMatches
            ? group.items
            : group.items.filter((item) => item.label.toLowerCase().includes(query));
          return {
            ...group,
            items: matchingItems,
          };
        })
        .filter((group) => group.items.length > 0)
    : displayGroups;

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
      }}
    >
      {/* Top Header: Sidebar Open/Close Button & Search Bar */}
      {collapsed ? (
        <Box
          sx={{
            height: 52,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderBottom: '1px solid',
            borderColor: 'divider',
            px: 1,
            flexShrink: 0,
          }}
        >
          {onToggleCollapse && (
            <Tooltip title="Expand sidebar" placement="right" arrow>
              <IconButton
                onClick={onToggleCollapse}
                aria-label="Expand sidebar"
                size="small"
                sx={{
                  color: '#475569',
                  p: 1,
                  '&:hover': { bgcolor: 'rgba(15, 23, 42, 0.06)', color: '#0f172a' },
                }}
              >
                <MenuIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      ) : (
        <Box
          sx={{
            height: 52,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 1.25,
            borderBottom: '1px solid',
            borderColor: 'divider',
            flexShrink: 0,
          }}
        >
          {onToggleCollapse && (
            <Tooltip title="Collapse sidebar" placement="bottom" arrow>
              <IconButton
                onClick={onToggleCollapse}
                aria-label="Collapse sidebar"
                size="small"
                sx={{
                  color: '#475569',
                  p: 1,
                  flexShrink: 0,
                  '&:hover': { bgcolor: 'rgba(15, 23, 42, 0.06)', color: '#0f172a' },
                }}
              >
                <MenuIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}

          {/* Search bar in front of the open/close button */}
          <Box
            ref={searchContainerRef}
            sx={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              alignItems: 'center',
              bgcolor: 'rgba(15, 23, 42, 0.03)',
              borderRadius: 2,
              px: 1,
              py: 0.35,
              border: '1px solid #e2e8f0',
              transition: 'all 0.15s ease',
              '&:focus-within': {
                borderColor: '#F89344',
                bgcolor: '#ffffff',
                boxShadow: '0 0 0 2px rgba(248, 147, 68, 0.15)',
              },
            }}
          >
            <SearchIcon sx={{ color: '#94a3b8', fontSize: 18, mr: 0.75, flexShrink: 0 }} />
            <InputBase
              placeholder="Search modules & submodules..."
              value={searchQuery}
              onClick={() => setIsFocused(true)}
              onFocus={() => setIsFocused(true)}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setIsFocused(true);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setIsFocused(true);
                  setHighlightedIndex((prev) => (prev + 1) % Math.max(1, suggestions.length));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setIsFocused(true);
                  setHighlightedIndex((prev) => (prev - 1 + suggestions.length) % Math.max(1, suggestions.length));
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  if (suggestions[highlightedIndex]) {
                    handleSelectSuggestion(suggestions[highlightedIndex]);
                  }
                } else if (e.key === 'Escape') {
                  setIsFocused(false);
                }
              }}
              sx={{
                fontSize: '0.8125rem',
                flex: 1,
                color: '#0f172a',
                '& input': {
                  p: 0,
                  '::placeholder': { color: '#94a3b8', opacity: 1 },
                },
              }}
              inputProps={{ 'aria-label': 'Search navigation' }}
            />
            {searchQuery && (
              <IconButton
                size="small"
                onClick={() => {
                  setSearchQuery('');
                  setIsFocused(true);
                }}
                aria-label="Clear search"
                sx={{ p: 0.25, color: '#94a3b8', '&:hover': { color: '#0f172a' } }}
              >
                <CloseIcon sx={{ fontSize: 16 }} />
              </IconButton>
            )}
          </Box>

          {/* RBAC-Compliant Suggestions Popper */}
          <Popper
            open={!collapsed && isFocused}
            anchorEl={searchContainerRef.current}
            placement="bottom-start"
            style={{
              zIndex: 1400,
              width: Math.min(420, Math.max(300, currentWidth - 16)),
            }}
          >
            <ClickAwayListener
              onClickAway={(event) => {
                if (
                  searchContainerRef.current &&
                  searchContainerRef.current.contains(event.target as Node)
                ) {
                  return;
                }
                setIsFocused(false);
              }}
            >
              <Paper
                elevation={6}
                sx={{
                  mt: 0.75,
                  maxHeight: 400,
                  overflowY: 'auto',
                  borderRadius: 2,
                  border: '1px solid #e2e8f0',
                  boxShadow: '0 12px 30px -4px rgba(15, 23, 42, 0.12), 0 4px 12px -2px rgba(15, 23, 42, 0.08)',
                  p: 0.75,
                  bgcolor: '#ffffff',
                }}
              >
                <Box
                  sx={{
                    px: 1.25,
                    py: 0.75,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    borderBottom: '1px solid #f1f5f9',
                    mb: 0.5,
                  }}
                >
                  <Typography
                    variant="caption"
                    sx={{
                      fontWeight: 700,
                      color: '#64748b',
                      fontSize: 11,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}
                  >
                    {searchQuery.trim()
                      ? `Matching Suggestions (${suggestions.length})`
                      : 'Quick Access Suggestions'}
                  </Typography>
                  <Typography variant="caption" sx={{ color: '#94a3b8', fontSize: 10 }}>
                    ↑↓ navigate • ↵ select
                  </Typography>
                </Box>

                {suggestions.length === 0 ? (
                  <Box sx={{ py: 3, px: 2, textAlign: 'center' }}>
                    <Typography
                      variant="body2"
                      sx={{ color: '#64748b', fontWeight: 600, fontSize: 12.5, mb: 0.5 }}
                    >
                      No authorized modules or submodules found
                    </Typography>
                    <Typography variant="caption" sx={{ color: '#94a3b8', fontSize: 11 }}>
                      Check spelling or verify your role permissions
                    </Typography>
                  </Box>
                ) : (
                  <List dense disablePadding>
                    {suggestions.map((item, idx) => {
                      const isHighlighted = idx === highlightedIndex;
                      return (
                        <ListItemButton
                          key={item.id}
                          onClick={() => handleSelectSuggestion(item)}
                          onMouseEnter={() => setHighlightedIndex(idx)}
                          sx={{
                            borderRadius: 1.5,
                            py: 0.75,
                            px: 1,
                            my: 0.2,
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 1.25,
                            bgcolor: isHighlighted ? 'rgba(248, 147, 68, 0.08)' : 'transparent',
                            transition: 'all 0.1s ease',
                            '&:hover': {
                              bgcolor: 'rgba(248, 147, 68, 0.12)',
                            },
                          }}
                        >
                          <ListItemIcon sx={{ minWidth: 26, mt: 0.3, color: '#F89344' }}>
                            {getMainCategoryIcon(item.category, 18)}
                          </ListItemIcon>
                          <ListItemText
                            primary={
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                                <Typography
                                  variant="body2"
                                  sx={{ fontWeight: 600, fontSize: 13, color: '#334155' }}
                                >
                                  <HighlightMatch text={item.label} query={searchQuery} />
                                </Typography>
                                {item.submodule ? (
                                  <Chip
                                    label={item.submodule}
                                    size="small"
                                    sx={{
                                      height: 18,
                                      fontSize: 10,
                                      fontWeight: 600,
                                      bgcolor: 'rgba(33, 89, 136, 0.08)',
                                      color: '#215988',
                                      borderRadius: 1,
                                    }}
                                  />
                                ) : (
                                  <Chip
                                    label="Module"
                                    size="small"
                                    sx={{
                                      height: 18,
                                      fontSize: 10,
                                      fontWeight: 600,
                                      bgcolor: 'rgba(248, 147, 68, 0.1)',
                                      color: '#ea580c',
                                      borderRadius: 1,
                                    }}
                                  />
                                )}
                              </Box>
                            }
                            secondary={
                              <Box
                                component="span"
                                sx={{ display: 'flex', flexDirection: 'column', gap: 0.2, mt: 0.25 }}
                              >
                                {item.description && (
                                  <Typography
                                    component="span"
                                    variant="caption"
                                    sx={{ color: '#64748b', fontSize: 11, lineHeight: 1.3, display: 'block' }}
                                  >
                                    <HighlightMatch text={item.description} query={searchQuery} />
                                  </Typography>
                                )}
                                <Typography
                                  component="span"
                                  variant="caption"
                                  sx={{
                                    color: '#94a3b8',
                                    fontSize: 10,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 0.5,
                                  }}
                                >
                                  <span>{item.category}</span>
                                  <span>•</span>
                                  <Box
                                    component="code"
                                    sx={{
                                      bgcolor: '#f1f5f9',
                                      px: 0.5,
                                      py: 0.1,
                                      borderRadius: 0.5,
                                      fontSize: 9.5,
                                    }}
                                  >
                                    {item.to}
                                  </Box>
                                </Typography>
                              </Box>
                            }
                          />
                        </ListItemButton>
                      );
                    })}
                  </List>
                )}
              </Paper>
            </ClickAwayListener>
          </Popper>
        </Box>
      )}

      <Box
        sx={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          py: 1,
          scrollbarWidth: 'thin',
          scrollbarColor: '#cbd5e1 transparent',
          '&::-webkit-scrollbar': {
            width: '6px',
          },
          '&::-webkit-scrollbar-track': {
            background: 'transparent',
          },
          '&::-webkit-scrollbar-thumb': {
            background: '#cbd5e1',
            borderRadius: '3px',
          },
          '&::-webkit-scrollbar-thumb:hover': {
            background: '#94a3b8',
          },
        }}
      >
        {collapsed ? (
          // Collapsed rail mode: Perfectly centered orange icons aligned with the top hamburger menu
          <Box sx={{ py: 0.5, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            {displayGroups.map((group, i) => {
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
        ) : filteredGroups.length === 0 ? (
          <Box sx={{ py: 4, px: 2, textAlign: 'center' }}>
            <Typography variant="body2" sx={{ color: '#64748b', fontWeight: 600, fontSize: 13, mb: 0.5 }}>
              No navigation items found
            </Typography>
            <Typography variant="caption" sx={{ color: '#94a3b8' }}>
              No matches for "{searchQuery}"
            </Typography>
          </Box>
        ) : (
          // Expanded mode: Clean, professional workspace navigation with orange category icons and no outline glitches
          filteredGroups.map((group, i) => {
            const isOpen = query ? true : expanded[group.title] !== false;
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
                        lineHeight: '32px',
                        color: '#334155',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        cursor: 'pointer',
                        userSelect: 'none',
                        px: 1.25,
                        mx: 0.75,
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
                      <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0, flex: 1, mr: 0.5 }}>
                        <Box sx={{ display: 'inline-flex', mr: 1, alignItems: 'center', flexShrink: 0 }}>
                          {getMainCategoryIcon(group.title, 18)}
                        </Box>
                        <Typography
                          variant="caption"
                          sx={{ fontWeight: 700, fontSize: 11.5, color: 'inherit' }}
                        >
                          {group.title}
                        </Typography>
                      </Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
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
                            pl: 3.25,
                            pr: 1.25,
                            py: 0.55,
                            borderRadius: 1.5,
                            mx: 0.75,
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
                            primary={<HighlightMatch text={item.label} query={searchQuery} />}
                            primaryTypographyProps={{
                              sx: {
                                fontSize: 13,
                                fontWeight: 'inherit',
                                whiteSpace: 'normal',
                                lineHeight: 1.35,
                                wordBreak: 'break-word',
                              },
                            }}
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
                                primary={<HighlightMatch text={item.label} query={searchQuery} />}
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

      {/* Fixed Settings Row at bottom (Always fixed, both in expanded and collapsed modes) */}
      <Box
        sx={{
          borderTop: '1px solid',
          borderColor: 'divider',
          bgcolor: '#ffffff',
          px: collapsed ? 0.5 : 1.25,
          py: collapsed ? 0.75 : 0.85,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          flexShrink: 0,
        }}
      >
        {collapsed ? (
          <Tooltip
            title={
              <Box sx={{ p: 0.5, maxWidth: 220 }}>
                <Typography
                  variant="caption"
                  sx={{ fontWeight: 700, color: '#F89344', display: 'block', mb: 0.25 }}
                >
                  Settings Hub
                </Typography>
                <Typography
                  variant="caption"
                  sx={{ display: 'block', color: 'text.secondary', fontSize: 11, lineHeight: 1.4 }}
                >
                  Organization, users, access control, system config & security
                </Typography>
              </Box>
            }
            placement="right"
            arrow
          >
            <ListItemButton
              component={NavLink}
              to="/settings"
              data-testid="shell.nav.category.settings"
              onClick={() => onNavigate?.()}
              sx={{
                width: 52,
                height: 52,
                minHeight: 52,
                maxWidth: 52,
                p: 0,
                justifyContent: 'center',
                alignItems: 'center',
                borderRadius: '16px',
                bgcolor: isSettingsActive ? 'rgba(248, 147, 68, 0.12)' : 'transparent',
                position: 'relative',
                transition: 'all 0.15s ease',
                '&:hover': {
                  bgcolor: isSettingsActive ? 'rgba(248, 147, 68, 0.18)' : 'rgba(248, 147, 68, 0.08)',
                },
                ...(isSettingsActive && {
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
                  color: isSettingsActive ? '#F89344' : '#64748b',
                }}
              >
                <SettingsIcon sx={{ fontSize: 24 }} />
              </ListItemIcon>
            </ListItemButton>
          </Tooltip>
        ) : (
          <ListItemButton
            component={NavLink}
            to="/settings"
            data-testid="shell.nav.settings"
            onClick={() => onNavigate?.()}
            sx={{
              width: '100%',
              borderRadius: 2,
              py: 0.75,
              px: 1.25,
              bgcolor: isSettingsActive ? 'rgba(248, 147, 68, 0.12)' : 'rgba(15, 23, 42, 0.02)',
              border: isSettingsActive ? '1px solid rgba(248, 147, 68, 0.35)' : '1px solid #e2e8f0',
              transition: 'all 0.15s ease',
              display: 'flex',
              alignItems: 'center',
              gap: 1.25,
              position: 'relative',
              '&:hover': {
                bgcolor: isSettingsActive ? 'rgba(248, 147, 68, 0.18)' : 'rgba(248, 147, 68, 0.06)',
                borderColor: '#F89344',
              },
              ...(isSettingsActive && {
                '&::before': {
                  content: '""',
                  position: 'absolute',
                  left: 0,
                  top: '18%',
                  bottom: '18%',
                  width: 3.5,
                  borderRadius: 2,
                  bgcolor: '#F89344',
                },
              }),
            }}
          >
            <ListItemIcon sx={{ minWidth: 26, color: isSettingsActive ? '#F89344' : '#64748b' }}>
              <SettingsIcon sx={{ fontSize: 20 }} />
            </ListItemIcon>
            <ListItemText
              primary="Settings"
              secondary="Admin, RBAC & Configuration"
              primaryTypographyProps={{
                fontWeight: isSettingsActive ? 700 : 600,
                fontSize: 13,
                color: isSettingsActive ? '#ea580c' : '#1e293b',
              }}
              secondaryTypographyProps={{
                fontSize: 10.5,
                color: '#64748b',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            />
          </ListItemButton>
        )}
      </Box>
    </Box>
  );
}
