// Sign-in screen (owner: Dev 1, UI-PLT-001). Email + password through Supabase Auth; supabase-js stores and
// refreshes the session. The API never sees the password. TOTP challenge (/mfa) is a separate screen.
// Testing/QA mode: Hardcoded test OTP (000000) bypasses credentials for any database user.
import React, { useEffect, useState } from 'react';
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
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { getSupabase, saveBypassSession } from './supabase';
import { setAuthToken } from './token';
import { readConfig } from '../config';
import { TimeoutError, withTimeout } from './timeout';

export interface TestUserItem {
  id: string;
  email: string;
  display_name: string;
  tenant_id: string;
  role_code: string | null;
  role_name: string | null;
  branch_name: string | null;
}

export const HARDCODED_TEST_OTP = (import.meta.env as any)?.VITE_TEST_BYPASS_OTP || '000000';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { session, signOut } = useAuth();
  const requested = (location.state as { from?: string } | null)?.from ?? '/';
  // Only in-app paths: the page reloads to this address after sign-in, so it must never point at another site.
  const from = requested.startsWith('/') && !requested.startsWith('//') ? requested : '/';

  const [authTab, setAuthTab] = useState<'password' | 'testOtp'>('password');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [testOtp, setTestOtp] = useState(HARDCODED_TEST_OTP);
  const [testUsers, setTestUsers] = useState<TestUserItem[]>([]);
  const [selectedUserEmail, setSelectedUserEmail] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Load available active users from database for quick testing
  useEffect(() => {
    const config = readConfig();
    if (!config.success) return;
    fetch(`${config.data.VITE_API_BASE_URL}/public/v1/auth/test-users`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json?.data && Array.isArray(json.data)) {
          setTestUsers(json.data);
        }
      })
      .catch(() => {});
  }, []);

  const executeBypassLogin = async (targetEmail: string, otpCode: string) => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const config = readConfig();
      if (!config.success) throw new Error('Web configuration is invalid.');
      const res = await fetch(`${config.data.VITE_API_BASE_URL}/public/v1/auth/test-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: targetEmail, otp: otpCode }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setErrorMessage(data?.error?.message || 'Test OTP authentication failed.');
        return;
      }
      saveBypassSession(data.data);
      setAuthToken(data.data.access_token);
      window.location.replace(from);
    } catch (err) {
      setErrorMessage((err as Error).message || 'Cannot reach API authentication service.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    // 1. Test OTP tab flow
    if (authTab === 'testOtp') {
      const targetEmail = (selectedUserEmail || identifier).trim();
      if (!targetEmail) {
        setErrorMessage('Please select or enter an email address.');
        return;
      }
      if (!testOtp) {
        setErrorMessage('Please enter the test OTP.');
        return;
      }
      await executeBypassLogin(targetEmail, testOtp.trim());
      return;
    }

    // 2. Standard Password tab flow
    const email = identifier.trim();
    if (!email) {
      setErrorMessage('Please enter your email address.');
      return;
    }
    if (!password) {
      setErrorMessage('Please enter your password.');
      return;
    }

    // Auto-detect hardcoded test OTP in password field
    if (password === HARDCODED_TEST_OTP) {
      await executeBypassLogin(email, password);
      return;
    }

    setIsLoading(true);
    try {
      // Standard Supabase password authentication
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
      setErrorMessage('Cannot reach the sign-in service. Please check your network and Supabase connection.');
    } finally {
      setIsLoading(false);
    }
  };

  // Already signed in: say who it is and let the user choose.
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
          maxWidth: 440,
          boxShadow: '0 8px 30px rgba(0,0,0,0.08)',
          borderRadius: 3,
        }}
      >
        <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
          {/* Header */}
          <Box sx={{ textAlign: 'center', mb: 2.5 }}>
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
              DSA CRM Authentication Portal
            </Typography>
          </Box>

          {/* Authentication Mode Tabs */}
          <Tabs
            value={authTab}
            onChange={(_, val) => {
              setAuthTab(val);
              setErrorMessage(null);
            }}
            variant="fullWidth"
            sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}
          >
            <Tab label="Password" value="password" data-testid="auth.tab.password" />
            <Tab label="Test OTP Bypass" value="testOtp" data-testid="auth.tab.testOtp" />
          </Tabs>

          {/* Feedback Alerts */}
          {errorMessage && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setErrorMessage(null)}>
              {errorMessage}
            </Alert>
          )}

          {/* Login Form */}
          <Box component="form" onSubmit={handleSubmit} noValidate>
            <Stack spacing={2.5}>
              {authTab === 'testOtp' ? (
                <>
                  {testUsers.length > 0 && (
                    <TextField
                      select
                      label="Select Database User (Quick QA)"
                      fullWidth
                      value={selectedUserEmail}
                      onChange={(e) => {
                        setSelectedUserEmail(e.target.value);
                        setIdentifier(e.target.value);
                      }}
                      disabled={isLoading}
                      helperText="Pick any seeded user found in database"
                      SelectProps={{ native: true }}
                    >
                      <option value="">-- Choose a user or type below --</option>
                      {testUsers.map((u) => (
                        <option key={u.id} value={u.email}>
                          {u.display_name} ({u.email}) — {u.role_code || 'User'}
                        </option>
                      ))}
                    </TextField>
                  )}

                  <TextField
                    label="Email"
                    type="email"
                    fullWidth
                    required
                    value={identifier}
                    onChange={(e) => {
                      setIdentifier(e.target.value);
                      setSelectedUserEmail('');
                    }}
                    disabled={isLoading}
                    placeholder="e.g. rm1@alpha.com"
                    autoComplete="username"
                    inputProps={{ 'data-testid': 'auth.email' }}
                    variant="outlined"
                  />

                  <TextField
                    label="Hardcoded Test OTP"
                    type="text"
                    fullWidth
                    required
                    value={testOtp}
                    onChange={(e) => setTestOtp(e.target.value)}
                    disabled={isLoading}
                    placeholder="000000"
                    helperText="Hardcoded bypass code: 000000 (pre-authenticates with MFA)"
                    inputProps={{ 'data-testid': 'auth.otpInput', maxLength: 6 }}
                    variant="outlined"
                  />

                  <Button
                    type="submit"
                    data-testid="auth.submit"
                    fullWidth
                    variant="contained"
                    color="primary"
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
                        <span>Bypassing Authentication...</span>
                      </Stack>
                    ) : (
                      'Sign In with Test OTP (000000)'
                    )}
                  </Button>
                </>
              ) : (
                <>
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
                    placeholder="Enter password or 000000"
                    helperText="Tip: Typing 000000 also logs in via test OTP bypass"
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
                </>
              )}
            </Stack>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}

export default LoginPage;
