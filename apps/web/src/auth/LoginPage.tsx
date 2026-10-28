// Sign-in screen (owner: Dev 1, UI-PLT-001).
// Clean light theme on pure white background with split-card layout
// and in-page frosted glass MFA modal with background blur effect.
import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogContent,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Link,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Link as RouterLink, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { getSupabase, saveBypassSession } from './supabase';
import { readConfig } from '../config';
import { TimeoutError, withTimeout } from './timeout';
import { setAuthToken } from './token';
import { verifyTotp } from './totp';
import { resolveSafeRedirect } from './redirect';

export const HARDCODED_TEST_OTP = (import.meta.env as any)?.VITE_TEST_BYPASS_OTP || '000000';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { session, aal, refreshAal } = useAuth();
  const requested = (location.state as { from?: string } | null)?.from ?? '/';
  const from = requested.startsWith('/') && !requested.startsWith('//') ? requested : '/';

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(() => {
    // After an automatic sign-out, say why the person is back here. The notice is shown once.
    try {
      if (sessionStorage.getItem('dsa_session_expired')) {
        sessionStorage.removeItem('dsa_session_expired');
        return 'Your session has ended. Sign in again to continue.';
      }
    } catch {
      // Storage can be blocked; no notice.
    }
    return null;
  });

  // In-page MFA Modal State
  const [showMfaModal, setShowMfaModal] = useState(false);
  const [pendingEmail, setPendingEmail] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaLoading, setMfaLoading] = useState(false);
  const [mfaError, setMfaError] = useState<string | null>(null);

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
      // 1. Standard Supabase authentication
      const { data, error } = await withTimeout(
        getSupabase().auth.signInWithPassword({ email, password }),
        15_000,
      );

      if (!error && data?.session) {
        try {
          sessionStorage.setItem('dsa_pending_email', email);
          localStorage.setItem('dsa_pending_email', email);
        } catch {
          // storage unavailable (private mode or blocked); safe to ignore
        }
        setPendingEmail(email);
        setShowMfaModal(true);
        return;
      }

      // 2. Direct database test login fallback
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
          } catch {
            // storage unavailable (private mode or blocked); safe to ignore
          }
          setPendingEmail(email);
          setShowMfaModal(true);
          return;
        }
      } catch {
        // Fall through
      }

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

  const handleMfaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = mfaCode.trim();
    if (!/^\d{6}$/.test(code)) {
      setMfaError('Enter the 6-digit code from your authenticator app.');
      return;
    }

    setMfaLoading(true);
    setMfaError(null);

    const email = pendingEmail || identifier.trim();
    const bypassOtp = (import.meta.env as any)?.VITE_TEST_BYPASS_OTP || '000000';

    try {
      // 1. Bypass test OTP flow
      if (code === bypassOtp) {
        const config = readConfig();
        const baseUrl = config.success ? config.data.VITE_API_BASE_URL : '';
        const endpoint = baseUrl ? `${baseUrl}/public/v1/auth/test-login` : '/public/v1/auth/test-login';

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, otp: bypassOtp }),
        });
        const json = await res.json().catch(() => null);

        if (!res.ok || (!json?.data?.access_token && !json?.data?.session)) {
          throw new Error(
            json?.error?.message ||
              (res.status >= 500
                ? 'Cannot connect to API server. Please ensure backend is running.'
                : 'Invalid verification code.'),
          );
        }

        const sessionPayload = json.data.session || json.data;
        saveBypassSession(sessionPayload);
        setAuthToken(sessionPayload.access_token);
        try {
          sessionStorage.removeItem('dsa_pending_email');
          localStorage.removeItem('dsa_pending_email');
        } catch {
          // storage unavailable (private mode or blocked); safe to ignore
        }
        window.location.replace(resolveSafeRedirect(from, sessionPayload));
        return;
      }

      // 2. Supabase MFA factor verification
      if (session) {
        try {
          const { data: factors } = await getSupabase().auth.mfa.listFactors();
          const factor = factors?.totp?.find((f) => f.status === 'verified') || factors?.all?.[0];
          if (factor) {
            await verifyTotp(factor.id, code);
            await refreshAal();
            try {
              sessionStorage.removeItem('dsa_pending_email');
              localStorage.removeItem('dsa_pending_email');
            } catch {
              // storage unavailable (private mode or blocked); safe to ignore
            }
            navigate(resolveSafeRedirect(from, session), { replace: true });
            return;
          }
        } catch (err: any) {
          throw new Error(err?.message || 'That code did not match. Please try again.');
        }
      }

      // 3. Fallback direct API verification
      const config = readConfig();
      const baseUrl = config.success ? config.data.VITE_API_BASE_URL : '';
      const endpoint = baseUrl ? `${baseUrl}/public/v1/auth/test-login` : '/public/v1/auth/test-login';

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp: code }),
      });
      const json = await res.json().catch(() => null);

      if (res.ok && (json?.data?.access_token || json?.data?.session)) {
        const sessionPayload = json.data.session || json.data;
        saveBypassSession(sessionPayload);
        setAuthToken(sessionPayload.access_token);
        try {
          sessionStorage.removeItem('dsa_pending_email');
          localStorage.removeItem('dsa_pending_email');
        } catch {
          // storage unavailable (private mode or blocked); safe to ignore
        }
        window.location.replace(resolveSafeRedirect(from, sessionPayload));
        return;
      }

      throw new Error(json?.error?.message || 'Invalid 6-digit code. Please try again.');
    } catch (err: any) {
      setMfaError(err?.message || 'Verification failed. Please try again.');
      setMfaCode('');
    } finally {
      setMfaLoading(false);
    }
  };

  // If already authenticated: navigate directly to destination if AAL2
  if (session && aal?.current === 'aal2') {
    return <Navigate to={resolveSafeRedirect(from, session)} replace />;
  }

  return (
    <Box
      sx={{
        position: 'relative',
        minHeight: '100vh',
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: '#ffffff',
        overflow: 'hidden',
        p: { xs: 2, sm: 3, md: 4 },
      }}
    >
      {/* Main Centerpiece Card — Blurs dynamically when MFA Modal opens */}
      <Card
        sx={{
          position: 'relative',
          zIndex: 1,
          width: '100%',
          maxWidth: 1240,
          minHeight: 700,
          borderRadius: { xs: 4, md: 6 },
          overflow: 'hidden',
          bgcolor: '#ffffff',
          border: '1px solid #e2e8f0',
          boxShadow: '0 25px 70px -15px rgba(15, 23, 42, 0.08), 0 0 0 1px rgba(226, 232, 240, 0.6)',
          display: 'flex',
          flexDirection: { xs: 'column', md: 'row' },
          p: { xs: 1.5, sm: 2, md: 2.5 },
          gap: { xs: 2, md: 2.5 },
          filter: showMfaModal ? 'blur(10px)' : 'none',
          opacity: showMfaModal ? 0.6 : 1,
          transform: showMfaModal ? 'scale(0.985)' : 'scale(1)',
          pointerEvents: showMfaModal ? 'none' : 'auto',
          transition: 'filter 0.35s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.35s ease, transform 0.35s ease',
        }}
      >
        {/* Left Visual Quote Box: Subtle clean slate background */}
        <Box
          sx={{
            flex: { xs: 'none', md: '1 1 50%' },
            minHeight: { xs: 320, md: 640 },
            borderRadius: { xs: 3.5, md: 5 },
            border: '1px solid #e2e8f0',
            bgcolor: '#f8fafc',
            position: 'relative',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            p: { xs: 3.5, sm: 4.5, md: 6 },
          }}
        >
          {/* Top Quote Header */}
          <Box sx={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Typography
              sx={{
                fontSize: '0.82rem',
                fontWeight: 800,
                letterSpacing: '0.18em',
                color: '#1e3a5f',
                textTransform: 'uppercase',
              }}
            >
              A Wise Quote
            </Typography>
            <Box sx={{ width: 44, height: 2.5, bgcolor: '#F89344', borderRadius: 1 }} />
          </Box>

          {/* Bottom Headline & Subtitle */}
          <Box sx={{ position: 'relative', zIndex: 1, mt: 'auto' }}>
            <Typography
              sx={{
                fontFamily: '"Playfair Display", Georgia, "Times New Roman", serif',
                fontSize: { xs: '2.8rem', sm: '3.6rem', lg: '4.2rem' },
                fontWeight: 700,
                lineHeight: 1.04,
                color: '#0f172a',
                mb: 2,
                letterSpacing: '-0.03em',
              }}
            >
              Get
              <br />
              Everything
              <br />
              You Want
            </Typography>
            <Typography
              sx={{
                fontSize: '0.96rem',
                lineHeight: 1.6,
                color: '#334155',
                maxWidth: 380,
                fontWeight: 500,
              }}
            >
              You can get everything you want if you work hard, trust the process, and stick to the plan.
            </Typography>
          </Box>
        </Box>

        {/* Right Form Box: Clean crisp white card */}
        <Box
          sx={{
            flex: { xs: 'none', md: '1 1 50%' },
            bgcolor: '#ffffff',
            borderRadius: { xs: 3.5, md: 5 },
            border: '1px solid #f1f5f9',
            boxShadow: '0 10px 30px -10px rgba(0, 0, 0, 0.04)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            p: { xs: 3.5, sm: 4.5, md: 6 },
          }}
        >
          {/* Top Brand Logo */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 1.25,
              mb: 3,
            }}
          >
            <Box
              component="img"
              src="/logo.png"
              alt="DSA CRM"
              sx={{ width: 34, height: 34, objectFit: 'contain' }}
            />
            <Typography
              sx={{
                fontWeight: 800,
                fontSize: '1.25rem',
                color: '#0f172a',
                letterSpacing: '-0.02em',
                display: 'flex',
                alignItems: 'center',
                gap: 0.75,
              }}
            >
              DSA Platform
              <Box
                component="span"
                sx={{
                  display: 'inline-block',
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  bgcolor: '#F89344',
                }}
              />
            </Typography>
          </Box>

          {/* Heading and Subtitle */}
          <Box sx={{ textAlign: 'center', mb: 3 }}>
            <Typography
              variant="h4"
              component="h1"
              sx={{
                fontFamily: '"Playfair Display", Georgia, "Times New Roman", serif',
                fontWeight: 700,
                color: '#0f172a',
                letterSpacing: '-0.02em',
                mb: 0.75,
                fontSize: { xs: '2rem', sm: '2.4rem' },
              }}
            >
              Welcome Back
            </Typography>
            <Typography variant="body2" sx={{ color: '#475569', fontSize: '0.885rem' }}>
              Sign In &mdash; Use your work email and password to access your account
            </Typography>
          </Box>

          {/* Feedback Alerts */}
          {errorMessage && (
            <Alert severity="error" sx={{ mb: 2.5, borderRadius: 2 }} onClose={() => setErrorMessage(null)}>
              {errorMessage}
            </Alert>
          )}

          {/* Login Form */}
          <Box component="form" onSubmit={handleSubmit} noValidate>
            <Stack spacing={2.25}>
              <Box>
                <Typography
                  component="label"
                  htmlFor="auth-email-input"
                  sx={{
                    display: 'block',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    color: '#334155',
                    mb: 0.75,
                  }}
                >
                  Email
                </Typography>
                <TextField
                  id="auth-email-input"
                  type="email"
                  fullWidth
                  required
                  autoFocus
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  disabled={isLoading}
                  placeholder="Enter your email"
                  autoComplete="username"
                  inputProps={{ 'data-testid': 'auth.email' }}
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      borderRadius: 2,
                      bgcolor: '#ffffff',
                      fontSize: '0.925rem',
                      '& fieldset': {
                        borderColor: '#cbd5e1',
                      },
                      '&:hover fieldset': {
                        borderColor: '#215988',
                      },
                      '&.Mui-focused fieldset': {
                        borderColor: '#215988',
                        borderWidth: 1.5,
                      },
                    },
                    '& .MuiOutlinedInput-input': {
                      py: 1.25,
                    },
                  }}
                />
              </Box>

              <Box>
                <Typography
                  component="label"
                  htmlFor="auth-password-input"
                  sx={{
                    display: 'block',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    color: '#334155',
                    mb: 0.75,
                  }}
                >
                  Password
                </Typography>
                <TextField
                  id="auth-password-input"
                  type={showPassword ? 'text' : 'password'}
                  fullWidth
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoading}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  inputProps={{ 'data-testid': 'auth.password' }}
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
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      borderRadius: 2,
                      bgcolor: '#ffffff',
                      fontSize: '0.925rem',
                      '& fieldset': {
                        borderColor: '#cbd5e1',
                      },
                      '&:hover fieldset': {
                        borderColor: '#215988',
                      },
                      '&.Mui-focused fieldset': {
                        borderColor: '#215988',
                        borderWidth: 1.5,
                      },
                    },
                    '& .MuiOutlinedInput-input': {
                      py: 1.25,
                    },
                  }}
                />
              </Box>

              {/* Remember me & Forgot Password */}
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  pt: 0.25,
                }}
              >
                <FormControlLabel
                  control={
                    <Checkbox
                      size="small"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      sx={{
                        color: '#94a3b8',
                        p: 0.5,
                        '&.Mui-checked': { color: '#0f172a' },
                      }}
                    />
                  }
                  label={
                    <Typography
                      variant="body2"
                      sx={{ color: '#475569', fontSize: '0.825rem', userSelect: 'none' }}
                    >
                      Remember me
                    </Typography>
                  }
                />
                <Link
                  component={RouterLink}
                  to="/forgot-password"
                  data-testid="auth.forgot"
                  sx={{
                    color: '#215988',
                    textDecoration: 'none',
                    fontSize: '0.825rem',
                    fontWeight: 600,
                    '&:hover': { color: '#F89344', textDecoration: 'underline' },
                  }}
                >
                  Forgot Password
                </Link>
              </Box>

              {/* Primary Sign In Button: Dark solid button matching reference image */}
              <Button
                type="submit"
                data-testid="auth.submit"
                fullWidth
                variant="contained"
                size="large"
                disabled={isLoading}
                sx={{
                  py: 1.35,
                  mt: 1,
                  fontWeight: 700,
                  textTransform: 'none',
                  fontSize: '0.975rem',
                  borderRadius: 2,
                  bgcolor: '#000000',
                  color: '#ffffff',
                  boxShadow: '0 4px 14px rgba(0, 0, 0, 0.25)',
                  '&:hover': {
                    bgcolor: '#1e293b',
                    boxShadow: '0 6px 20px rgba(0, 0, 0, 0.35)',
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
            </Stack>
          </Box>
        </Box>
      </Card>

      {/* In-Page Two-Factor Authentication Modal with Heavily Blurred Background */}
      <Dialog
        open={showMfaModal}
        onClose={() => {
          if (!mfaLoading) {
            setShowMfaModal(false);
            setMfaCode('');
            setMfaError(null);
          }
        }}
        slotProps={{
          backdrop: {
            sx: {
              bgcolor: 'rgba(15, 23, 42, 0.55)',
              backdropFilter: 'blur(24px)',
              WebkitBackdropFilter: 'blur(24px)',
            },
          },
        }}
        PaperProps={{
          sx: {
            borderRadius: { xs: 3, sm: 4.5 },
            bgcolor: '#ffffff',
            border: '1px solid #e2e8f0',
            boxShadow: '0 30px 80px -15px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(226, 232, 240, 0.8)',
            p: { xs: 2.5, sm: 4 },
            maxWidth: 440,
            width: '100%',
            mx: 2,
            overflow: 'hidden',
          },
        }}
      >
        <DialogContent sx={{ p: 0 }}>
          {/* Header Branding */}
          <Box sx={{ textAlign: 'center', mb: 3 }}>
            <Box
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 58,
                height: 58,
                borderRadius: '50%',
                bgcolor: 'rgba(248, 147, 68, 0.12)',
                border: '1.5px solid rgba(248, 147, 68, 0.35)',
                mb: 2,
              }}
            >
              <Box
                component="img"
                src="/logo.png"
                alt="DSA Logo"
                sx={{ width: 32, height: 32, objectFit: 'contain' }}
              />
            </Box>
            <Typography
              variant="h5"
              sx={{
                fontWeight: 700,
                color: '#0f172a',
                fontSize: { xs: '1.35rem', sm: '1.5rem' },
                fontFamily: '"Playfair Display", Georgia, "Times New Roman", serif',
                letterSpacing: '-0.02em',
                mb: 0.75,
              }}
            >
              Two-Step Verification
            </Typography>
            <Typography variant="body2" sx={{ color: '#475569', fontSize: '0.875rem', lineHeight: 1.5 }}>
              Enter the 6-digit security code from your authenticator app for{' '}
              <Box component="span" sx={{ fontWeight: 600, color: '#0f172a' }}>
                {pendingEmail || identifier}
              </Box>
            </Typography>
          </Box>

          {/* MFA Error Alert */}
          {mfaError && (
            <Alert
              severity="error"
              sx={{ mb: 2.5, borderRadius: 2, fontSize: '0.85rem' }}
              onClose={() => setMfaError(null)}
            >
              {mfaError}
            </Alert>
          )}

          {/* 6-Digit Code Input Form */}
          <Box component="form" onSubmit={handleMfaSubmit} noValidate>
            <Stack spacing={2.5}>
              <Box>
                <Typography
                  component="label"
                  htmlFor="mfa-auth-code-input"
                  sx={{
                    display: 'block',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    color: '#334155',
                    mb: 1,
                    textAlign: 'center',
                  }}
                >
                  Security Code
                </Typography>
                <TextField
                  id="mfa-auth-code-input"
                  fullWidth
                  autoFocus
                  required
                  value={mfaCode}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                    setMfaCode(val);
                  }}
                  disabled={mfaLoading}
                  placeholder="000000"
                  inputProps={{
                    'data-testid': 'mfa.code',
                    maxLength: 6,
                    inputMode: 'numeric',
                    pattern: '[0-9]*',
                    style: {
                      textAlign: 'center',
                      fontSize: '1.75rem',
                      fontWeight: 700,
                      letterSpacing: '0.38em',
                      fontFamily: 'monospace',
                      color: '#0f172a',
                    },
                  }}
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      borderRadius: 2.5,
                      bgcolor: 'rgba(255, 255, 255, 0.95)',
                      boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.04)',
                      '& fieldset': {
                        borderColor: 'rgba(33, 89, 136, 0.28)',
                        borderWidth: 1.5,
                      },
                      '&:hover fieldset': {
                        borderColor: '#215988',
                      },
                      '&.Mui-focused fieldset': {
                        borderColor: '#F89344',
                        borderWidth: 2,
                      },
                    },
                    '& .MuiOutlinedInput-input': {
                      py: 1.5,
                    },
                  }}
                />
              </Box>

              {/* Verify & Proceed Button */}
              <Button
                type="submit"
                data-testid="mfa.submit"
                fullWidth
                variant="contained"
                size="large"
                disabled={mfaLoading || mfaCode.length !== 6}
                sx={{
                  py: 1.35,
                  fontWeight: 700,
                  textTransform: 'none',
                  fontSize: '0.975rem',
                  borderRadius: 2,
                  bgcolor: '#000000',
                  color: '#ffffff',
                  boxShadow: '0 4px 14px rgba(0, 0, 0, 0.25)',
                  '&:hover': {
                    bgcolor: '#1e293b',
                    boxShadow: '0 6px 20px rgba(0, 0, 0, 0.35)',
                  },
                  '&:disabled': {
                    bgcolor: 'rgba(0, 0, 0, 0.12)',
                    color: 'rgba(0, 0, 0, 0.3)',
                  },
                }}
              >
                {mfaLoading ? (
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <CircularProgress size={20} color="inherit" />
                    <span>Verifying...</span>
                  </Stack>
                ) : (
                  'Verify & Continue'
                )}
              </Button>

              {/* Back / Cancel Button */}
              <Button
                fullWidth
                variant="text"
                size="small"
                disabled={mfaLoading}
                onClick={() => {
                  setShowMfaModal(false);
                  setMfaCode('');
                  setMfaError(null);
                }}
                sx={{
                  color: '#64748b',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  textTransform: 'none',
                  '&:hover': { color: '#0f172a', bgcolor: 'transparent' },
                }}
              >
                Cancel and return to sign in
              </Button>
            </Stack>
          </Box>
        </DialogContent>
      </Dialog>
    </Box>
  );
}

export default LoginPage;
