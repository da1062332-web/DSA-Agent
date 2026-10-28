// Centered card used by the sign-in, MFA and password screens (owner: Dev 1).
import { Box, Card, CardContent, Typography } from '@mui/material';
import type { ReactNode } from 'react';

export function AuthCard({
  title,
  subtitle,
  icon,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: '#ffffff',
        p: { xs: 2, sm: 3 },
      }}
    >
      <Card
        sx={{
          width: '100%',
          maxWidth: 440,
          overflow: 'hidden',
          bgcolor: '#ffffff',
          position: 'relative',
        }}
      >
        <CardContent sx={{ p: { xs: 3, sm: 4 }, '&:last-child': { pb: { xs: 3, sm: 4 } } }}>
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'center',
              mb: 2,
            }}
          >
            {icon ? (
              icon
            ) : (
              <Box component="img" src="/logo.png" alt="DSA Platform" sx={{ height: 56, width: 'auto' }} />
            )}
          </Box>
          <Typography
            variant="h5"
            component="h1"
            fontWeight={600}
            textAlign="center"
            sx={{ color: '#0f172a', letterSpacing: '-0.015em' }}
          >
            {title}
          </Typography>
          {subtitle && (
            <Typography
              variant="body2"
              color="text.secondary"
              textAlign="center"
              sx={{ mt: 0.75, mb: 3.5, color: '#64748b', fontSize: '0.9rem' }}
            >
              {subtitle}
            </Typography>
          )}
          {children}
        </CardContent>
      </Card>
    </Box>
  );
}
