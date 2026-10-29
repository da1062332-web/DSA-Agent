// apps/web/src/auth/LoginPage.tsx — Sign-in screen: white page, one centred card, work email and password.
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CircularProgress,
  IconButton,
  InputAdornment,
  Link,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import type { SxProps, Theme } from '@mui/material';
import { Link as RouterLink, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { getSupabase } from './supabase';
import { readConfig } from '../config';
import { TimeoutError, withTimeout } from './timeout';
import { resolveSafeRedirect } from './redirect';
import { HOME_PATH } from './session-prefs';
import { mfaSkipRequested, testAuthEnabled, testOtp } from './test-auth';
import { secondFactorPlan } from './secondFactor';
import { isMfaDisabledError, setMfaProjectState } from './mfa-project';
import { enrolmentErrorMessage, startTotpEnrolment } from './totp';
import { SecondFactorDialog, type SecondFactorState } from './SecondFactorDialog';

export const HARDCODED_TEST_OTP = testOtp();

// Show / hide toggle for the password field.
function EyeIcon({ off }: { off?: boolean }) {
  return (
    <Box
      component="svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      sx={{ width: 18, height: 18 }}
    >
      {off ? (
        <>
          <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
          <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
          <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
          <line x1="2" x2="22" y1="2" y2="22" />
        </>
      ) : (
        <>
          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </Box>
  );
}

function FieldLabel({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <Typography
      component="label"
      htmlFor={htmlFor}
      sx={{ fontSize: '0.8125rem', fontWeight: 600, color: 'grey.700' }}
    >
      {children}
    </Typography>
  );
}

// Border, radius and the focus ring come from the theme; the sign-in fields are a little taller than the in-app default.
const fieldSx: SxProps<Theme> = {
  '& .MuiOutlinedInput-root': { fontSize: '0.9375rem' },
  '& .MuiOutlinedInput-input': { py: 1.25 },
};

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { session, aal, refreshAal, signOut } = useAuth();
  const requested = (location.state as { from?: string } | null)?.from ?? '/';
  const from = requested.startsWith('/') && !requested.startsWith('//') ? requested : '/';
  const addAuthenticator = Boolean((location.state as { addAuthenticator?: boolean } | null)?.addAuthenticator);

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(() => {
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

  // Second factor modal state
  const [secondFactor, setSecondFactor] = useState<SecondFactorState | null>(null);
  const opening = useRef(false);
  const [pendingEmail, setPendingEmail] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const email = identifier.trim();
    if (!email) {
      setErrorMessage('Please enter your work email address.');
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
        await openSecondFactor(false);
        return;
      }

      // 2. Test builds only: direct database test login, then the MFA step with the fixed code
      if (testAuthEnabled()) {
        try {
          const config = readConfig();
          const baseUrl = config.success ? config.data.VITE_API_BASE_URL : '';
          const endpoint = baseUrl ? `${baseUrl}/public/v1/auth/test-login` : '/public/v1/auth/test-login';

          const checkRes = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, otp: testOtp() }),
          });

          if (checkRes.ok) {
            try {
              sessionStorage.setItem('dsa_pending_email', email);
              localStorage.setItem('dsa_pending_email', email);
            } catch {
              // storage unavailable (private mode or blocked); safe to ignore
            }
            setPendingEmail(email);
            setSecondFactor({ mode: 'test' });
            return;
          }
        } catch {
          // Fall through
        }
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

  const clearPendingEmail = () => {
    try {
      sessionStorage.removeItem('dsa_pending_email');
      localStorage.removeItem('dsa_pending_email');
    } catch {
      // storage unavailable (private mode or blocked); safe to ignore
    }
  };

  // The project has authenticator sign-in off: record it and let the sign-in continue without a code.
  const continueWithoutSecondFactor = () => {
    setMfaProjectState('disabled');
    setSecondFactor(null);
    clearPendingEmail();
    finishSignIn();
  };

  // A normal sign-in always starts on the person's own home, whatever page sent them to the login. Only adding an authenticator from the
  // security page returns to where it was asked.
  const finishSignIn = () => {
    navigate(addAuthenticator ? resolveSafeRedirect(from, session) : HOME_PATH, { replace: true });
  };

  const openSecondFactor = async (resetExisting: boolean) => {
    if (opening.current) return;
    opening.current = true;
    try {
      const { data: factorList, error: factorError } = await getSupabase().auth.mfa.listFactors();
      if (factorError) {
        setErrorMessage('Could not check your authenticator app. Try again.');
        return;
      }
      const plan = secondFactorPlan(factorList?.totp, resetExisting);
      if (plan.mode === 'challenge') {
        const { error: challengeError } = await getSupabase().auth.mfa.challenge({ factorId: plan.factorId });
        if (challengeError && isMfaDisabledError(challengeError)) {
          continueWithoutSecondFactor();
          return;
        }
        if (challengeError) {
          setErrorMessage('Could not start the code check. Try again.');
          return;
        }
        setMfaProjectState('enabled');
        setSecondFactor({ mode: 'challenge', factorId: plan.factorId });
        return;
      }
      try {
        const enrolment = await startTotpEnrolment(`Authenticator ${new Date().toISOString().slice(0, 10)}`, false);
        setMfaProjectState('enabled');
        setSecondFactor({ mode: 'enrol', resetExisting, enrolment });
      } catch (err) {
        if (isMfaDisabledError(err)) {
          continueWithoutSecondFactor();
          return;
        }
        setErrorMessage(enrolmentErrorMessage(err));
      }
    } finally {
      opening.current = false;
    }
  };

  const onSecondFactorVerified = async () => {
    clearPendingEmail();
    await refreshAal();
    finishSignIn();
  };

  const cancelSecondFactor = () => {
    setSecondFactor(null);
    clearPendingEmail();
    if (addAuthenticator) {
      navigate(resolveSafeRedirect(from, session), { replace: true });
      return;
    }
    if (session) void signOut();
  };

  const aalLevel = aal?.current;
  useEffect(() => {
    if (!session || secondFactor) return;
    if (addAuthenticator) {
      void openSecondFactor(true);
      return;
    }
    if (aalLevel === 'aal2' || mfaSkipRequested()) return;
    void openSecondFactor(false);
  }, [session, aalLevel, addAuthenticator, secondFactor]);

  if (session && (aal?.current === 'aal2' || mfaSkipRequested()) && !addAuthenticator) {
    return <Navigate to={HOME_PATH} replace />;
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        width: '100%',
        bgcolor: '#ffffff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        px: 2,
        py: 5,
      }}
    >
      <Box sx={{ width: '100%', maxWidth: 420 }}>
        {/* Brand */}
        <Stack alignItems="center" spacing={1} sx={{ mb: 3.5 }}>
          <Box component="img" src="/logo.png" alt="DSA Platform" sx={{ height: 64, width: 'auto' }} />
          <Box sx={{ textAlign: 'center' }}>
            <Typography sx={{ fontWeight: 600, fontSize: '1.25rem', color: 'primary.main', letterSpacing: '-0.01em' }}>
              DSA CRM
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              Loan Origination &amp; Distribution Platform
            </Typography>
          </Box>
        </Stack>

        <Card sx={{ p: { xs: 3, sm: 4 } }}>
          <Typography variant="h5" component="h1" sx={{ color: 'text.primary', mb: 0.5 }}>
            Sign In
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
            Use your work email and password to continue
          </Typography>

          {errorMessage && (
            <Alert severity="error" sx={{ mb: 2.5 }} onClose={() => setErrorMessage(null)}>
              {errorMessage}
            </Alert>
          )}

          <Box component="form" onSubmit={handleSubmit} noValidate>
            <Stack spacing={2.5}>
              <Stack spacing={0.75}>
                <FieldLabel htmlFor="auth-email-input">Work email</FieldLabel>
                <TextField
                  id="auth-email-input"
                  name="email"
                  type="email"
                  fullWidth
                  required
                  autoFocus
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  disabled={isLoading}
                  placeholder="name@company.com"
                  autoComplete="username"
                  inputProps={{ 'data-testid': 'auth.email' }}
                  sx={fieldSx}
                />
              </Stack>

              <Stack spacing={0.75}>
                <Stack direction="row" alignItems="baseline" justifyContent="space-between">
                  <FieldLabel htmlFor="auth-password-input">Password</FieldLabel>
                  <Link
                    component={RouterLink}
                    to="/forgot-password"
                    data-testid="auth.forgot"
                    sx={{ fontSize: '0.8125rem', fontWeight: 600 }}
                  >
                    Forgot password?
                  </Link>
                </Stack>
                <TextField
                  id="auth-password-input"
                  name="password"
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
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                          onClick={() => setShowPassword((prev) => !prev)}
                          edge="end"
                          size="small"
                          sx={{ color: 'grey.500' }}
                        >
                          <EyeIcon off={showPassword} />
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                  sx={fieldSx}
                />
              </Stack>

              <Button type="submit" data-testid="auth.submit" fullWidth variant="contained" size="large" disabled={isLoading}>
                {isLoading ? (
                  <Stack direction="row" alignItems="center" spacing={1.25}>
                    <CircularProgress size={18} color="inherit" />
                    <span>Signing in…</span>
                  </Stack>
                ) : (
                  'Sign In'
                )}
              </Button>
            </Stack>
          </Box>
        </Card>

        <Typography variant="caption" sx={{ display: 'block', textAlign: 'center', color: 'text.secondary', mt: 3 }}>
          Need access? Contact your administrator.
        </Typography>
      </Box>

      {/* Second factor (authenticator code) dialog */}
      <SecondFactorDialog
        state={secondFactor}
        email={pendingEmail || identifier.trim() || session?.user?.email || ''}
        from={from}
        onVerified={onSecondFactorVerified}
        onCancel={cancelSecondFactor}
      />
    </Box>
  );
}

export function MfaRedirect() {
  const location = useLocation();
  return <Navigate to="/login" replace state={location.state} />;
}

export default LoginPage;
