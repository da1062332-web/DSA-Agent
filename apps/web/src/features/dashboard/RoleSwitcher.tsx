import { Box, Chip, FormControl, InputLabel, MenuItem, Select, type SelectChangeEvent, Typography } from '@mui/material';
import { type DashboardRole, ROLE_LABELS } from './role-routing';

interface RoleSwitcherProps {
  availableRoles: DashboardRole[];
  activeRole: DashboardRole;
  onRoleChange: (role: DashboardRole) => void;
}

export function RoleSwitcher({ availableRoles, activeRole, onRoleChange }: RoleSwitcherProps) {
  if (availableRoles.length <= 1) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="body2" color="text.secondary">Active Persona:</Typography>
        <Chip
          label={ROLE_LABELS[activeRole] || activeRole}
          color="primary"
          size="small"
          variant="outlined"
          sx={{ fontWeight: 600 }}
        />
      </Box>
    );
  }

  const handleChange = (e: SelectChangeEvent<string>) => {
    onRoleChange(e.target.value as DashboardRole);
  };

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, my: 1 }}>
      <FormControl size="small" sx={{ minWidth: 200 }}>
        <InputLabel id="role-switcher-label">Active Dashboard View</InputLabel>
        <Select
          labelId="role-switcher-label"
          id="role-switcher-select"
          value={activeRole}
          label="Active Dashboard View"
          onChange={handleChange}
          data-testid="role-switcher-select"
        >
          {availableRoles.map((role) => (
            <MenuItem key={role} value={role}>
              {ROLE_LABELS[role] || role}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <Typography variant="caption" color="text.secondary">
        (Multi-role Persona)
      </Typography>
    </Box>
  );
}
