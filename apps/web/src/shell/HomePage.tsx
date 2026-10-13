import { Box, Button, Card, CardContent, Container, Grid, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useMe } from '../api/useMe';

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
  ];

  return (
    <Container maxWidth="lg" sx={{ py: 5 }}>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" fontWeight={700} gutterBottom>
          Welcome{me.data ? `, ${me.data.displayName}` : ''}! 👋
        </Typography>
        <Typography variant="body1" color="text.secondary">
          DSA Loan Distribution & CRM Platform
          {me.isError && ' · Could not load your profile from the API.'}
        </Typography>
      </Box>

      <Grid container spacing={3}>
        {cards.map((c) => (
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
