// Centered card used by the sign-in, MFA and password screens (owner: Dev 1).
import { Box, Card, CardContent, Typography } from '@mui/material';
import type { ReactNode } from 'react';

export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: '#f4f6f8',
        p: 2,
      }}
    >
      <Card sx={{ width: '100%', maxWidth: 440, boxShadow: '0 8px 30px rgba(0,0,0,0.08)', borderRadius: 3 }}>
        <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
          <Typography variant="h5" component="h1" fontWeight={700} textAlign="center">
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="body2" color="text.secondary" textAlign="center" sx={{ mt: 0.5, mb: 3 }}>
              {subtitle}
            </Typography>
          )}
          {children}
        </CardContent>
      </Card>
    </Box>
  );
}
