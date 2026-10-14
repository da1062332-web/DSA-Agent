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
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { getSupabase } from './supabase';
import { TimeoutError, withTimeout } from './timeout';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { session, signOut } = useAuth();
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
      // A request stuck behind another open tab would otherwise leave the form on "Authenticating..." forever.
      const { error } = await withTimeout(getSupabase().auth.signInWithPassword({ email, password }), 15_000);
      if (error) {
        // Same message for unknown email and wrong password (no account enumeration).
        setErrorMessage(
          error.status === 400 ? 'Invalid email or password.' : 'Sign-in failed. Please try again.',
        );
        return;
      }
      // A full load, not an in-app navigation: the new user must not see anything kept in memory for the previous one.
      window.location.replace(from);
    } catch (err) {
      if (err instanceof TimeoutError) {
        setErrorMessage('Sign-in is taking too long. Close any other open tabs of this app, then try again.');
        return;
      }
      setErrorMessage(
        'Cannot reach the sign-in service. Please check your network and Supabase connection.',
      );
    } finally {
      setIsLoading(false);
    }
  };

  // Already signed in: say who it is and let the user choose. Silent redirects hid the sign-in form, so signing in
  // as another person looked like it had not worked.
  if (session) {
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
        <Card sx={{ width: '100%', maxWidth: 420, borderRadius: 3 }}>
          <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
            <Typography variant="h5" component="h1" fontWeight={700} gutterBottom>
              Already signed in
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }} data-testid="login.signedInAs">
              You are signed in as {session.user.email}. To sign in as someone else, sign out first.
            </Typography>
            <Stack spacing={1.5}>
              <Button variant="contained" onClick={() => navigate(from, { replace: true })}>
                Continue as {session.user.email}
              </Button>
              <Button variant="outlined" onClick={() => void signOut()} data-testid="login.signOutFirst">
                Sign out and use another account
              </Button>
            </Stack>
          </CardContent>
        </Card>
      </Box>
    );
  }

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
      <Card
        sx={{
          width: '100%',
          maxWidth: 420,
          boxShadow: '0 8px 30px rgba(0,0,0,0.08)',
          borderRadius: 3,
        }}
      >
        <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
          {/* Header */}
          <Box sx={{ textAlign: 'center', mb: 3.5 }}>
            <Box
              sx={{
                width: 52,
                height: 52,
                borderRadius: '50%',
                bgcolor: 'primary.main',
                color: 'white',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                mb: 1.5,
                fontSize: 24,
              }}
            >
              🔐
            </Box>
            <Typography variant="h5" component="h1" fontWeight={700}>
              Sign In
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Use your work email and password
            </Typography>
          </Box>

          {/* Feedback Alerts */}
          {errorMessage && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErrorMessage(null)}>
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
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        aria-label="toggle password visibility"
                        onClick={() => setShowPassword((prev) => !prev)}
                        edge="end"
                        size="small"
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
                  py: 1.3,
                  fontWeight: 600,
                  textTransform: 'none',
                  fontSize: '1rem',
                  borderRadius: 2,
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
              <Box sx={{ textAlign: 'center' }}>
                <Link component={RouterLink} to="/forgot-password" data-testid="auth.forgot">
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
