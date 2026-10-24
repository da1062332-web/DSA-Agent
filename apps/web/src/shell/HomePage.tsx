import { Box, Button, Card, CardContent, Container, Grid, Typography } from '@mui/material';
import { PLATFORM_TENANT_ID } from '@dsa/contracts';
import { Link as RouterLink } from 'react-router-dom';
import { hasPermission, useMe } from '../api/useMe';
import { routeAllowed } from './access';
import { PageHeader } from '../ui';

export function HomePage() {
  const me = useMe();
  const cards = [
    {
      title: 'Leads & CRM',
      desc: 'Capture, qualify and assign loan borrower leads.',
      to: '/leads',
      badge: 'Leads',
    },
    {
      title: 'Tasks Management',
      desc: 'Track underwriting checklist items and follow-ups.',
      to: '/tasks',
      badge: 'Tasks',
    },
    {
      title: 'Loan Applications',
      desc: 'Originate, review and submit NBFC loan files.',
      to: '/applications',
      badge: 'Origination',
    },
    {
      title: 'Decision Rules',
      desc: 'Simulate and manage business eligibility rules.',
      to: '/rules',
      badge: 'BRE Engine',
    },
    {
      title: 'Omnichannel Messaging',
      desc: 'Templates, dispatch, send-eligibility guard, and delivery tracking.',
      to: '/messaging',
      badge: 'Messaging',
    },
    {
      title: 'User Management',
      desc: 'Manage staff accounts, branch assignments, and roles.',
      to: '/users',
      badge: 'Users',
    },
    {
      title: 'Access Control',
      desc: 'Configure tenant roles, permission policies, and RBAC matrix.',
      to: '/roles',
      badge: 'Access Control',
    },
    {
      title: 'Document Sharing',
      desc: 'Customer upload links, OTP verification portal, and lender share packages.',
      to: '/document-sharing',
      badge: 'Sharing',
    },
    {
      title: 'Verification Workbench',
      desc: 'PAN, GST, ITR, bank statement, bureau, and manual document verification.',
      to: '/verifications',
      badge: 'Verification',
    },
    {
      title: 'Connector Management',
      desc: 'Onboarding, bank dual-control SOD, agreements, reattribution, and disputes.',
      to: '/connectors',
      badge: 'Connectors',
    },
    {
      title: 'Commissions',
      desc: 'Commission rule tiers, rate slabs, partner splits, and earnings calculation.',
      to: '/commission',
      badge: 'Commissions',
    },
    {
      title: 'Payouts & Invoices',
      desc: 'Partner payout runs, approvals, bank disbursement batches, and reconciliation.',
      to: '/payouts',
      badge: 'Payouts',
    },
    {
      title: 'Sanctions & Disbursals',
      desc: 'Lender sanction letter parsing, condition tracking, and multi-tranche disbursals.',
      to: '/sanctions',
      badge: 'Sanctions',
    },
    {
      title: 'Reporting & Analytics',
      desc: 'Standard report catalogue, operational KPIs, export jobs, and pipeline projections.',
      to: '/reports',
      badge: 'Reports',
    },
    {
      title: 'Performance & Targets',
      desc: 'Agent quota targets, pipeline velocity, team leaderboards, and achievement badges.',
      to: '/performance',
      badge: 'Performance',
    },
    {
      title: 'Privacy & Governance',
      desc: 'Customer DPDP consent records, data retention policies, and compliance audit trail.',
      to: '/privacy',
      badge: 'Governance',
    },
    {
      title: 'Platform Console',
      desc: 'Multi-tenant settings, audit streaming, telemetry, and platform operational console.',
      to: '/platform-admin',
      badge: 'Platform',
    },
    {
      title: 'Tenant Configuration',
      desc: 'Manage organization details, operational SLAs, and branch network.',
      to: '/config',
      badge: 'Configuration',
    },
  ];
  // Same rules as the sidebar and the route guard (shell/access.ts): a card is offered only where the page would open for this user.
  // A platform operator is offered only the Platform Console, and customer-tenant users are never offered it (audit F-07).
  const platformRealm = me.data?.tenantId === PLATFORM_TENANT_ID;
  const shownCards = cards.filter((c) =>
    routeAllowed(c.to, (code) => hasPermission(me.data, code), platformRealm),
  );

  return (
    <Container maxWidth={false} disableGutters>
      <PageHeader
        title={`Welcome${me.data ? `, ${me.data.displayName}` : ''}`}
        subtitle={`DSA Loan Distribution & CRM Platform${me.isError ? ' · Could not load your profile from the API.' : ''}`}
      />

      <Grid container spacing={3}>
        {shownCards.map((c) => (
          <Grid item xs={12} sm={6} md={3} key={c.title}>
            <Card
              sx={{ height: '100%', display: 'flex', flexDirection: 'column', borderRadius: 2, boxShadow: 1 }}
            >
              <CardContent sx={{ flexGrow: 1 }}>
                <Typography variant="overline" color="primary" fontWeight={700}>
                  {c.badge}
                </Typography>
                <Typography variant="h6" fontWeight={600} gutterBottom>
                  {c.title}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  {c.desc}
                </Typography>
                <Button variant="outlined" size="small" component={RouterLink} to={c.to} sx={{ mt: 'auto' }}>
                  Open {c.badge}
                </Button>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Container>
  );
}
