// Sign-in screen (owner: Dev 1, UI-PLT-001). Email + password through Supabase Auth; supabase-js stores and
// refreshes the session. The API never sees the password. TOTP challenge (/mfa) is a separate screen.
import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  IconButton,
  InputAdornment,
  Link,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Link as RouterLink, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { getSupabase } from './supabase';
import { readConfig } from '../config';
import { TimeoutError, withTimeout } from './timeout';

export const HARDCODED_TEST_OTP = (import.meta.env as any)?.VITE_TEST_BYPASS_OTP || '000000';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { session, aal, signOut } = useAuth();
  const requested = (location.state as { from?: string } | null)?.from ?? '/';
  // Only in-app paths: the page reloads to this address after sign-in, so it must never point at another site.
  const from = requested.startsWith('/') && !requested.startsWith('//') ? requested : '/';

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const email = identifier.trim();
    if (!email) {
      setErrorMessage('Please enter your email address.');
      return;
    }
    if (!password) {
      setErrorMessage('Please enter your password.');
      return;
    }

    setIsLoading(true);
    try {
      // 1. Try standard Supabase authentication
      const { data, error } = await withTimeout(
        getSupabase().auth.signInWithPassword({ email, password }),
        15_000,
      );

      if (!error && data?.session) {
        try {
          sessionStorage.setItem('dsa_pending_email', email);
          localStorage.setItem('dsa_pending_email', email);
        } catch {}
        navigate('/mfa', { state: { from, email } });
        return;
      }

      // 2. If password verification failed, check if the email belongs to an active database user
      // so testing with database accounts proceeds directly to the OTP screen.
      try {
        const config = readConfig();
        const baseUrl = config.success ? config.data.VITE_API_BASE_URL : '';
        const endpoint = baseUrl ? `${baseUrl}/public/v1/auth/test-login` : '/public/v1/auth/test-login';

        const checkRes = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, otp: HARDCODED_TEST_OTP }),
        });

        if (checkRes.ok) {
          try {
            sessionStorage.setItem('dsa_pending_email', email);
            localStorage.setItem('dsa_pending_email', email);
          } catch {}
          navigate('/mfa', { state: { from, email } });
          return;
        }
      } catch {
        // Fall through to standard error if API is unreachable
      }

      // Same message for unknown email and wrong password (no account enumeration).
      setErrorMessage(
        error?.status === 400 ? 'Invalid email or password.' : 'Sign-in failed. Please try again.',
      );
    } catch (err) {
      if (err instanceof TimeoutError) {
        setErrorMessage('Sign-in is taking too long. Close any other open tabs of this app, then try again.');
        return;
      }
      setErrorMessage('Cannot reach the sign-in service. Please check your network and Supabase connection.');
    } finally {
      setIsLoading(false);
    }
  };

  // If already authenticated: navigate directly to destination if AAL2, or to /mfa if pending OTP verification.
  // This eliminates any intermediate flash screen.
  if (session) {
    if (aal?.current === 'aal2') {
      return <Navigate to={from} replace />;
    }
    return <Navigate to="/mfa" replace state={{ from, email: session.user.email }} />;
  }

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
        }}
      >
        <Box sx={{ height: 4, background: 'linear-gradient(90deg, #2563eb 0%, #3b82f6 50%, #60a5fa 100%)' }} />
        <CardContent sx={{ p: { xs: 3.5, sm: 4.5 } }}>
          {/* Header */}
          <Box sx={{ textAlign: 'center', mb: 3.5 }}>
            <Box
              sx={{
                width: 56,
                height: 56,
                borderRadius: '16px',
                bgcolor: '#eff6ff',
                color: '#2563eb',
                border: '1px solid #dbeafe',
                boxShadow: '0 4px 12px rgba(37, 99, 235, 0.12)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                mb: 2,
                fontSize: 26,
              }}
            >
              🔐
            </Box>
            <Typography
              variant="h5"
              component="h1"
              fontWeight={700}
              sx={{ color: '#0f172a', letterSpacing: '-0.02em', mb: 0.5 }}
            >
              Sign In
            </Typography>
            <Typography variant="body2" sx={{ color: '#64748b', fontSize: '0.9rem' }}>
              Use your work email and password
            </Typography>
          </Box>

          {/* Feedback Alerts */}
          {errorMessage && (
            <Alert
              severity="error"
              sx={{ mb: 2.5, borderRadius: 2.5 }}
              onClose={() => setErrorMessage(null)}
            >
              {errorMessage}
            </Alert>
          )}

          {/* Login Form */}
          <Box component="form" onSubmit={handleSubmit} noValidate>
            <Stack spacing={2.5}>
              <TextField
                label="Email"
                type="email"
                fullWidth
                required
                autoFocus
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                disabled={isLoading}
                placeholder="you@example.com"
                autoComplete="username"
                inputProps={{ 'data-testid': 'auth.email' }}
                variant="outlined"
                sx={{
                  '& .MuiOutlinedInput-root': {
                    borderRadius: 2.5,
                  },
                }}
              />

              <TextField
                label="Password"
                type={showPassword ? 'text' : 'password'}
                fullWidth
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
                placeholder="Enter password"
                autoComplete="current-password"
                inputProps={{ 'data-testid': 'auth.password' }}
                variant="outlined"
                sx={{
                  '& .MuiOutlinedInput-root': {
                    borderRadius: 2.5,
                  },
                }}
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        aria-label="toggle password visibility"
                        onClick={() => setShowPassword((prev) => !prev)}
                        edge="end"
                        size="small"
                        sx={{ color: '#64748b' }}
                      >
                        {showPassword ? '👁️' : '🙈'}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />

              <Button
                type="submit"
                data-testid="auth.submit"
                fullWidth
                variant="contained"
                size="large"
                disabled={isLoading}
                sx={{
                  py: 1.4,
                  fontWeight: 600,
                  textTransform: 'none',
                  fontSize: '0.975rem',
                  borderRadius: 2.5,
                  background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                  boxShadow: '0 8px 20px -6px rgba(37, 99, 235, 0.4)',
                  '&:hover': {
                    background: 'linear-gradient(135deg, #1d4ed8 0%, #1e40af 100%)',
                    boxShadow: '0 10px 22px -6px rgba(37, 99, 235, 0.5)',
                  },
                }}
              >
                {isLoading ? (
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <CircularProgress size={20} color="inherit" />
                    <span>Authenticating...</span>
                  </Stack>
                ) : (
                  'Sign In'
                )}
              </Button>
              <Box sx={{ textAlign: 'center', pt: 0.5 }}>
                <Link
                  component={RouterLink}
                  to="/forgot-password"
                  data-testid="auth.forgot"
                  sx={{
                    color: '#2563eb',
                    textDecoration: 'none',
                    fontSize: '0.875rem',
                    fontWeight: 500,
                    '&:hover': { textDecoration: 'underline' },
                  }}
                >
                  Forgot password?
                </Link>
              </Box>
            </Stack>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}

export default LoginPage;
