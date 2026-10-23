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
        background: 'linear-gradient(145deg, #f8fafc 0%, #edf2f7 50%, #e2e8f0 100%)',
        p: { xs: 2, sm: 3 },
      }}
    >
      <Card
        sx={{
          width: '100%',
          maxWidth: 440,
          boxShadow: '0 20px 45px -12px rgba(15, 23, 42, 0.08), 0 0 0 1px rgba(15, 23, 42, 0.05)',
          borderRadius: 4,
          overflow: 'hidden',
          bgcolor: '#ffffff',
          position: 'relative',
        }}
      >
        <Box
          sx={{
            height: 4,
            background: 'linear-gradient(90deg, #215988 0%, #3876BE 50%, #F89344 100%)',
          }}
        />
        <CardContent sx={{ p: { xs: 3.5, sm: 4.5 } }}>
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
              <Box
                sx={{
                  width: 56,
                  height: 56,
                  borderRadius: '16px',
                  bgcolor: '#ffffff',
                  border: '1px solid rgba(33, 89, 136, 0.12)',
                  boxShadow: '0 4px 14px rgba(33, 89, 136, 0.1)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  p: 0.8,
                }}
              >
                <Box
                  component="img"
                  src="/logo.png"
                  alt="DSA Platform"
                  sx={{ width: '100%', height: '100%', objectFit: 'contain' }}
                />
              </Box>
            )}
          </Box>
          <Typography
            variant="h5"
            component="h1"
            fontWeight={700}
            textAlign="center"
            sx={{ color: '#0f172a', letterSpacing: '-0.02em' }}
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
