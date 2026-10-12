import { Box, Button, Card, CardContent, Container, Grid, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

export function HomePage() {
  const rawUser = sessionStorage.getItem('dsa_auth_user') || localStorage.getItem('dsa_auth_user');
  let user: { email?: string; displayName?: string } = { displayName: 'Team Member' };
  if (rawUser) {
    try {
      user = JSON.parse(rawUser);
    } catch {
      // ignore
    }
  }

  const cards = [
    { title: 'Leads & CRM', desc: 'Capture, qualify and assign loan borrower leads.', to: '/leads', badge: 'Leads' },
    { title: 'Tasks Management', desc: 'Track underwriting checklist items and follow-ups.', to: '/tasks', badge: 'Tasks' },
    { title: 'Loan Applications', desc: 'Originate, review and submit NBFC loan files.', to: '/applications', badge: 'Origination' },
    { title: 'Decision Rules', desc: 'Simulate and manage business eligibility rules.', to: '/rules', badge: 'BRE Engine' },
    { title: 'User Management', desc: 'Manage staff accounts, branch assignments, and roles.', to: '/users', badge: 'Users' },
  ];

  return (
    <Container maxWidth="lg" sx={{ py: 5 }}>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" fontWeight={700} gutterBottom>
          Welcome, {user.displayName || user.email}! 👋
        </Typography>
        <Typography variant="body1" color="text.secondary">
          DSA Loan Distribution & CRM Platform &bull; Branch: Mumbai Central (MUM01)
        </Typography>
      </Box>

      <Grid container spacing={3}>
        {cards.map((c) => (
          <Grid item xs={12} sm={6} md={3} key={c.title}>
            <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column', borderRadius: 2, boxShadow: 1 }}>
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
