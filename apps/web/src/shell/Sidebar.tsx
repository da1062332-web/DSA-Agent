// Sidebar navigation (owner: Dev 1). Groups follow the 15 DSA domains in the spec (DSA Notion, section 2). Items with a
// screen link to it. Items whose module is not built yet are shown greyed out with "Soon", so the whole product is
// visible without linking to empty pages. Admin-only groups appear only for users with config.manage or user.manage.
// The menu data and who may see what live in ./access, shared with the Home cards and the route guard.
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
import { NAV_GROUPS, visibleGroups } from './access';

export { NAV_GROUPS, visibleGroups };
export type { NavGroup, NavItem } from './access';

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
  return (
    <Box data-testid="shell.sidebar" sx={{ py: 1, pb: 6 }}>
      {visibleGroups(isAdmin, can, platformRealm).map((group, i) => (
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
