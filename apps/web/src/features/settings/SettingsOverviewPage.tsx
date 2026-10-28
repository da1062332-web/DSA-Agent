// Settings Hub Overview (owner: Dev 1)
// Central administrative hub providing categorized, RBAC-filtered access to all 16 configuration,
// security, user management, and compliance modules.
import {
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  Container,
  Divider,
  Grid,
  InputBase,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { PLATFORM_TENANT_ID } from '@dsa/contracts';
import { hasPermission, useMe } from '../../api/useMe';
import {
  type SettingsCategory,
  type SettingsItem,
  visibleSettings,
} from '../../shell/access';
import {
  AdminPanelSettingsIcon,
  AssignmentIcon,
  BusinessIcon,
  ChecklistIcon,
  DescriptionIcon,
  DownloadIcon,
  HubIcon,
  KeyIcon,
  LockIcon,
  OpenInNewIcon,
  PeopleIcon,
  SearchIcon,
  SettingsIcon,
  ShieldIcon,
  VerifiedUserIcon,
} from '../../shell/icons';

function getSettingIcon(iconName: string, size = 22): ReactNode {
  const sx = { fontSize: size, color: '#ea580c' };
  switch (iconName) {
    case 'BusinessIcon':
      return <BusinessIcon sx={sx} />;
    case 'PeopleIcon':
      return <PeopleIcon sx={sx} />;
    case 'AssignmentIcon':
      return <AssignmentIcon sx={sx} />;
    case 'AdminPanelSettingsIcon':
      return <AdminPanelSettingsIcon sx={sx} />;
    case 'ChecklistIcon':
      return <ChecklistIcon sx={sx} />;
    case 'HubIcon':
      return <HubIcon sx={sx} />;
    case 'KeyIcon':
      return <KeyIcon sx={sx} />;
    case 'DownloadIcon':
      return <DownloadIcon sx={sx} />;
    case 'DescriptionIcon':
      return <DescriptionIcon sx={sx} />;
    case 'VerifiedUserIcon':
      return <VerifiedUserIcon sx={sx} />;
    case 'ShieldIcon':
      return <ShieldIcon sx={sx} />;
    case 'LockIcon':
      return <LockIcon sx={sx} />;
    default:
      return <SettingsIcon sx={sx} />;
  }
}

export function SettingsOverviewPage() {
  const navigate = useNavigate();
  const me = useMe();
  const [filterQuery, setFilterQuery] = useState('');

  const isAdmin =
    hasPermission(me.data, 'config.manage') || hasPermission(me.data, 'user.manage');
  const can = (code: string) => hasPermission(me.data, code);
  const isPlatformRealm = me.data?.tenantId === PLATFORM_TENANT_ID;

  const categories: SettingsCategory[] = useMemo(
    () => visibleSettings(isAdmin, can, isPlatformRealm),
    [isAdmin, me.data, isPlatformRealm],
  );

  const totalAvailableModules = useMemo(
    () => categories.reduce((sum, c) => sum + c.items.length, 0),
    [categories],
  );

  const query = filterQuery.trim().toLowerCase();

  const filteredCategories = useMemo(() => {
    if (!query) return categories;
    return categories
      .map((cat) => {
        const titleMatch = cat.title.toLowerCase().includes(query);
        const matchingItems = titleMatch
          ? cat.items
          : cat.items.filter(
              (item) =>
                item.label.toLowerCase().includes(query) ||
                item.description.toLowerCase().includes(query) ||
                item.to.toLowerCase().includes(query) ||
                (item.anyOf && item.anyOf.some((p) => p.toLowerCase().includes(query))),
            );
        return {
          ...cat,
          items: matchingItems,
        };
      })
      .filter((cat) => cat.items.length > 0);
  }, [categories, query]);

  return (
    <Container maxWidth="xl" sx={{ py: 3.5, px: { xs: 2, sm: 3 } }}>
      {/* Top Header Banner */}
      <Box
        sx={{
          mb: 4,
          pb: 2.5,
          borderBottom: '1px solid #e2e8f0',
          display: 'flex',
          flexDirection: { xs: 'column', md: 'row' },
          justifyContent: 'space-between',
          alignItems: { xs: 'flex-start', md: 'center' },
          gap: 2,
        }}
      >
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 0.5 }}>
            <Box
              sx={{
                width: 38,
                height: 38,
                borderRadius: 2,
                bgcolor: 'rgba(248, 147, 68, 0.12)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#ea580c',
              }}
            >
              <SettingsIcon sx={{ fontSize: 24 }} />
            </Box>
            <Typography variant="h5" sx={{ fontWeight: 700, color: '#0f172a' }}>
              Settings & Administration
            </Typography>
            <Chip
              label={`${totalAvailableModules} Authorized Modules`}
              size="small"
              sx={{
                height: 22,
                fontSize: 11,
                fontWeight: 600,
                bgcolor: 'rgba(15, 23, 42, 0.06)',
                color: '#475569',
              }}
            />
          </Box>
          <Typography variant="body2" sx={{ color: '#64748b', ml: { md: 6 } }}>
            Configure organization settings, access control, system parameters, compliance audit trails, and personal security.
          </Typography>
        </Box>

        {/* In-page Settings Search Filter */}
        <Paper
          elevation={0}
          sx={{
            display: 'flex',
            alignItems: 'center',
            width: { xs: '100%', sm: 320, md: 360 },
            border: '1px solid #cbd5e1',
            borderRadius: 2,
            px: 1.5,
            py: 0.5,
            bgcolor: '#ffffff',
            transition: 'all 0.15s ease',
            '&:focus-within': {
              borderColor: '#F89344',
              boxShadow: '0 0 0 3px rgba(248, 147, 68, 0.15)',
            },
          }}
        >
          <SearchIcon sx={{ color: '#94a3b8', fontSize: 20, mr: 1, flexShrink: 0 }} />
          <InputBase
            placeholder="Filter settings modules..."
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            fullWidth
            sx={{ fontSize: 13.5 }}
          />
          {filterQuery && (
            <Button
              size="small"
              onClick={() => setFilterQuery('')}
              sx={{ minWidth: 'auto', p: 0.5, fontSize: 11, color: '#94a3b8' }}
            >
              Clear
            </Button>
          )}
        </Paper>
      </Box>

      {/* Categories & Cards */}
      {filteredCategories.length === 0 ? (
        <Box sx={{ py: 8, textAlign: 'center' }}>
          <Typography variant="h6" sx={{ color: '#475569', fontWeight: 600, mb: 1 }}>
            No matching settings modules found
          </Typography>
          <Typography variant="body2" sx={{ color: '#94a3b8', mb: 2 }}>
            No modules match "{filterQuery}". Try a different keyword or check your role permissions.
          </Typography>
          <Button
            variant="outlined"
            size="small"
            onClick={() => setFilterQuery('')}
            sx={{ textTransform: 'none', borderColor: '#cbd5e1', color: '#475569' }}
          >
            Reset Filter
          </Button>
        </Box>
      ) : (
        <Stack spacing={4}>
          {filteredCategories.map((category) => (
            <Box key={category.id}>
              {/* Category Header */}
              <Box sx={{ mb: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700, color: '#1e293b' }}>
                    {category.title}
                  </Typography>
                  <Chip
                    label={`${category.items.length}`}
                    size="small"
                    sx={{
                      height: 18,
                      fontSize: 10,
                      fontWeight: 700,
                      bgcolor: '#f1f5f9',
                      color: '#64748b',
                    }}
                  />
                </Box>
                <Typography variant="caption" sx={{ color: '#64748b', fontSize: 12 }}>
                  {category.description}
                </Typography>
              </Box>

              {/* Module Cards Grid */}
              <Grid container spacing={2.5}>
                {category.items.map((item) => (
                  <Grid item xs={12} sm={6} lg={4} key={item.id}>
                    <Card
                      elevation={0}
                      sx={{
                        height: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        borderRadius: 2.5,
                        border: '1px solid #e2e8f0',
                        bgcolor: '#ffffff',
                        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                        '&:hover': {
                          borderColor: '#F89344',
                          boxShadow: '0 8px 20px -4px rgba(248, 147, 68, 0.12)',
                          transform: 'translateY(-2px)',
                        },
                      }}
                    >
                      <CardActionArea
                        onClick={() => navigate(item.to)}
                        sx={{
                          height: '100%',
                          p: 2,
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'flex-start',
                          justifyContent: 'flex-start',
                        }}
                      >
                        {/* Top row: Icon, Title, and Direct Link Indicator */}
                        <Box
                          sx={{
                            width: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            mb: 1.5,
                          }}
                        >
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                            <Box
                              sx={{
                                width: 36,
                                height: 36,
                                borderRadius: 2,
                                bgcolor: 'rgba(248, 147, 68, 0.1)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              {getSettingIcon(item.iconName)}
                            </Box>
                            <Box>
                              <Typography
                                variant="subtitle2"
                                sx={{ fontWeight: 700, color: '#0f172a', fontSize: 14.5 }}
                              >
                                {item.label}
                              </Typography>
                              <Typography
                                variant="caption"
                                sx={{
                                  fontFamily: 'monospace',
                                  fontSize: 10.5,
                                  color: '#94a3b8',
                                  bgcolor: '#f8fafc',
                                  px: 0.6,
                                  py: 0.2,
                                  borderRadius: 0.75,
                                  border: '1px solid #f1f5f9',
                                }}
                              >
                                {item.to}
                              </Typography>
                            </Box>
                          </Box>

                          <OpenInNewIcon sx={{ fontSize: 16, color: '#cbd5e1' }} />
                        </Box>

                        {/* Description */}
                        <Typography
                          variant="body2"
                          sx={{
                            color: '#64748b',
                            fontSize: 12.5,
                            lineHeight: 1.45,
                            mb: 2,
                            flexGrow: 1,
                          }}
                        >
                          {item.description}
                        </Typography>

                        <Divider sx={{ width: '100%', mb: 1.5, borderColor: '#f1f5f9' }} />

                        {/* Bottom row: Permission tag & Quick action */}
                        <Box
                          sx={{
                            width: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                          }}
                        >
                          {item.anyOf && item.anyOf.length > 0 ? (
                            <Chip
                              label={item.anyOf[0]}
                              size="small"
                              sx={{
                                height: 20,
                                fontSize: 10,
                                fontFamily: 'monospace',
                                fontWeight: 600,
                                bgcolor: 'rgba(33, 89, 136, 0.08)',
                                color: '#215988',
                                borderRadius: 1,
                              }}
                            />
                          ) : (
                            <Chip
                              label="Personal"
                              size="small"
                              sx={{
                                height: 20,
                                fontSize: 10,
                                fontWeight: 600,
                                bgcolor: 'rgba(16, 185, 129, 0.1)',
                                color: '#059669',
                                borderRadius: 1,
                              }}
                            />
                          )}

                          <Typography
                            variant="caption"
                            sx={{
                              fontWeight: 700,
                              color: '#ea580c',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 0.5,
                              fontSize: 11.5,
                            }}
                          >
                            Open module →
                          </Typography>
                        </Box>
                      </CardActionArea>
                    </Card>
                  </Grid>
                ))}
              </Grid>
            </Box>
          ))}
        </Stack>
      )}
    </Container>
  );
}
