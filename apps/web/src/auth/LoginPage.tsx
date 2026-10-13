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
import { readConfig } from '../config';
import { useAuth } from './AuthProvider';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { session, setSession } = useAuth();
  const from = (location.state as { from?: string } | null)?.from ?? '/';

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
      const config = readConfig();
      const apiUrl = config.success ? config.data.VITE_API_BASE_URL : 'http://localhost:3000';
      const res = await fetch(`${apiUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const body = await res.json().catch(() => null);

      if (!res.ok) {
        setErrorMessage(
          body?.error?.message ?? (res.status === 401 ? 'Invalid email or password.' : 'Sign-in failed. Please try again.'),
        );
        return;
      }

      if (body?.access_token) {
        setSession(body);
        navigate(from, { replace: true });
        return;
      }

      setErrorMessage('Sign-in failed. Please try again.');
    } catch {
      setErrorMessage(
        'Cannot reach the sign-in service. Is the API server running (http://localhost:3000)?',
      );
    } finally {
      setIsLoading(false);
    }
  };

  if (session) return <Navigate to={from} replace />;

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
