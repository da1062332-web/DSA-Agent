// Sidebar navigation (owner: Dev 1). Refactored into 7 Operational Workspaces.
// Items with a screen link to it. Items whose module is not built yet are shown greyed out with "Soon".
// The menu data and who may see what live in ./access, shared with the Home cards and the route guard.
import {
  Box,
  Chip,
  Collapse,
  Divider,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Tooltip,
  Typography,
} from '@mui/material';
import { type ReactNode, useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { NAV_GROUPS, visibleGroups } from './access';
import {
  AccountBalanceIcon,
  AdminPanelSettingsIcon,
  AssessmentIcon,
  AssignmentIcon,
  DashboardIcon,
  ExpandLessIcon,
  ExpandMoreIcon,
  HubIcon,
  PeopleIcon,
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

export function SidebarContent({
  isAdmin,
  can,
  platformRealm,
  onNavigate,
}: {
  isAdmin: boolean;
  can?: (code: string) => boolean;
  platformRealm?: boolean;
  onNavigate?: () => void;
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
      // Fallback silently if localStorage is restricted (private browsing / disabled)
    }
    return {};
  });

  const toggleGroup = (title: string) => {
    setExpanded((prev) => {
      // If not yet set in state, it was open by default (true), so toggle to false
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
    <Box data-testid="shell.sidebar" sx={{ py: 1, pb: 6 }}>
      {groups.map((group, i) => {
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
      })}
    </Box>
  );
}
