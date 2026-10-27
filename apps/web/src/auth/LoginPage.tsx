// Sign-in screen (owner: Dev 1, UI-PLT-001).
// Clean light theme on pure white background with split-card layout
// and in-page frosted glass MFA modal with background blur effect.
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  Grid,
  IconButton,
  InputAdornment,
  Link,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Link as RouterLink, Navigate, useLocation, useNavigate } from 'react-router-dom';
import {
  AccountBalanceIcon,
  DescriptionIcon,
  PeopleIcon,
  ShieldIcon,
} from '../shell/icons';
import { useAuth } from './AuthProvider';
import { getSupabase } from './supabase';
import { readConfig } from '../config';
import { TimeoutError, withTimeout } from './timeout';
import { mfaSkipRequested, testAuthEnabled, testOtp } from './test-auth';
import { secondFactorPlan } from './secondFactor';
import { isMfaDisabledError, setMfaProjectState } from './mfa-project';
import { enrolmentErrorMessage, startTotpEnrolment } from './totp';
import { SecondFactorDialog, type SecondFactorState } from './SecondFactorDialog';
import { InteractiveDotGrid } from './InteractiveDotGrid';

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
  // The one second-factor screen. Null when it is closed.
  const [secondFactor, setSecondFactor] = useState<SecondFactorState | null>(null);
  // Guards the second-factor decision against two starts at once, such as the sign-in and the session effect.
  const opening = useRef(false);
  const showMfaModal = secondFactor !== null;
  const [pendingEmail, setPendingEmail] = useState('');

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
    navigate(from, { replace: true });
  };

  // Decides the second-factor step. A verified authenticator gets the code prompt. Otherwise the set-up starts, and that is how the
  // project is asked whether it takes authenticator sign-in at all: when it is off, the auth service refuses the set-up and the
  // sign-in continues without a code. The set-up's QR code and key are passed to the dialog, so nothing is started twice.
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
        // Starting a code check is the question for an existing authenticator: the service refuses it when code checks are off.
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
    navigate(from, { replace: true });
  };

  const cancelSecondFactor = () => {
    setSecondFactor(null);
    clearPendingEmail();
    if (addAuthenticator) {
      navigate(from, { replace: true });
      return;
    }
    // A sign-in that has not finished its second factor is signed out, so the form comes back clean.
    if (session) void signOut();
  };

  // Opens the second factor for a signed-in session that still needs it: after a reload, a redirect from a protected page, or "add authenticator".
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

  // If already authenticated at AAL2, go to the destination. Add-authenticator stays on this screen.
  if (session && (aal?.current === 'aal2' || mfaSkipRequested()) && !addAuthenticator) {
    return <Navigate to={from} replace />;
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
        p: { xs: 1.5, sm: 2, md: 3 },
      }}
    >
      {/* Main Centerpiece Card Frame — Blurs dynamically when MFA Modal opens */}
      <Card
        sx={{
          position: 'relative',
          zIndex: 1,
          width: '100%',
          maxWidth: 1160,
          minHeight: { xs: 'auto', md: 620 },
          borderRadius: { xs: 4, md: 5.5 },
          overflow: 'hidden',
          bgcolor: '#ffffff',
          border: '1.5px solid #cbd5e1',
          boxShadow: '0 25px 70px -15px rgba(15, 23, 42, 0.1), 0 0 0 1px rgba(226, 232, 240, 0.7)',
          display: 'flex',
          flexDirection: { xs: 'column', md: 'row' },
          p: { xs: 1.5, sm: 1.75, md: 2.25 },
          gap: { xs: 1.75, md: 2.25 },
          filter: showMfaModal ? 'blur(10px)' : 'none',
          opacity: showMfaModal ? 0.6 : 1,
          transform: showMfaModal ? 'scale(0.985)' : 'scale(1)',
          pointerEvents: showMfaModal ? 'none' : 'auto',
          transition: 'filter 0.35s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.35s ease, transform 0.35s ease',
        }}
      >
        {/* Left Hero Showcase Box matching user reference design */}
        <Box
          sx={{
            flex: { xs: 'none', md: '1 1 50%' },
            borderRadius: { xs: 3, md: 4.5 },
            border: '1px solid #dbeafe',
            background: 'linear-gradient(180deg, #f8fbff 0%, #f0f7ff 45%, #e6f1fe 100%)',
            position: 'relative',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            p: { xs: 2.75, sm: 3.5, md: 4 },
          }}
        >
          {/* Subtle Architectural Blueprint Grid Lines */}
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              backgroundImage:
                'linear-gradient(to right, rgba(219, 234, 254, 0.35) 1px, transparent 1px), linear-gradient(to bottom, rgba(219, 234, 254, 0.35) 1px, transparent 1px)',
              backgroundSize: '72px 72px, 72px 72px',
              pointerEvents: 'none',
              zIndex: 0,
            }}
          />

          {/* Interactive Magnetic Canvas Dot Grid with Hover Glow & Constellation Waves */}
          <InteractiveDotGrid dotSpacing={24} baseRadius={1.2} hoverRadius={140} maxRepulsion={9} />

          {/* Subtle Organic Background Accents */}
          <Box
            sx={{
              position: 'absolute',
              top: '35%',
              left: -50,
              width: 140,
              height: 180,
              borderRadius: '50%',
              bgcolor: 'rgba(191, 219, 254, 0.45)',
              filter: 'blur(35px)',
              pointerEvents: 'none',
            }}
          />
          <Box
            sx={{
              position: 'absolute',
              top: -30,
              right: -30,
              width: 180,
              height: 180,
              borderRadius: '50%',
              bgcolor: 'rgba(224, 238, 255, 0.6)',
              filter: 'blur(40px)',
              pointerEvents: 'none',
            }}
          />

          {/* Top Content Area */}
          <Box sx={{ position: 'relative', zIndex: 2 }}>
            {/* Logo & Brand Header */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 2.25 }}>
              {/* Official App Logo */}
              <Box
                component="img"
                src="/logo.png"
                alt="DSA Platform Logo"
                sx={{
                  width: 36,
                  height: 36,
                  borderRadius: 2,
                  bgcolor: '#ffffff',
                  boxShadow: '0 3px 10px rgba(37, 99, 235, 0.12)',
                  p: 0.5,
                  objectFit: 'contain',
                  flexShrink: 0,
                }}
              />

              <Box>
                <Typography
                  sx={{
                    fontWeight: 800,
                    fontSize: '1.28rem',
                    color: '#0f172a',
                    letterSpacing: '-0.025em',
                    lineHeight: 1.15,
                  }}
                >
                  DSA CRM
                </Typography>
                <Typography
                  sx={{
                    fontSize: '0.72rem',
                    fontWeight: 500,
                    color: '#64748b',
                    letterSpacing: '0.04em',
                    mt: 0.1,
                  }}
                >
                  Empower • Manage • Grow
                </Typography>
              </Box>
            </Box>

            {/* Tag / Pill */}
            <Box
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                bgcolor: '#e0edff',
                color: '#1d4ed8',
                px: 1.6,
                py: 0.5,
                borderRadius: '100px',
                fontSize: '0.76rem',
                fontWeight: 650,
                letterSpacing: '0.01em',
                border: '1px solid rgba(191, 219, 254, 0.9)',
                boxShadow: '0 1px 3px rgba(37, 99, 235, 0.06)',
                mb: 1.75,
              }}
            >
              All-in-one platform for Loan Distributors
            </Box>

            {/* Headline */}
            <Typography
              sx={{
                fontSize: { xs: '1.65rem', sm: '1.95rem', lg: '2.15rem' },
                fontWeight: 800,
                lineHeight: 1.18,
                color: '#0f172a',
                letterSpacing: '-0.03em',
                mb: 1.35,
              }}
            >
              Grow Your
              <br />
              Loan Business
              <br />
              <Box component="span" sx={{ color: '#2563eb' }}>
                with Confidence
              </Box>
            </Typography>

            {/* Subtitle Description */}
            <Typography
              sx={{
                fontSize: '0.85rem',
                lineHeight: 1.5,
                color: '#475569',
                maxWidth: 440,
                fontWeight: 450,
                mb: 2.5,
              }}
            >
              Manage leads, track applications, collaborate with lenders, and ensure compliant lending operations — all in one platform.
            </Typography>

            {/* 4 Feature Cards (2x2 Grid) with Rich Tactile Textures & Micro-depth */}
            <Grid container spacing={1.35} sx={{ maxWidth: 460 }}>
              {/* 1. Lead Management */}
              <Grid item xs={6}>
                <Box
                  sx={{
                    background: 'linear-gradient(145deg, #eff6ff 0%, #ffffff 100%)',
                    border: '1px solid rgba(191, 219, 254, 0.95)',
                    borderRadius: 2.25,
                    p: 1.25,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.15,
                    boxShadow: '0 4px 14px -2px rgba(37, 99, 235, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.9)',
                    transition: 'all 0.18s ease',
                    position: 'relative',
                    overflow: 'hidden',
                    '&:hover': {
                      transform: 'translateY(-1.5px)',
                      borderColor: '#60a5fa',
                      boxShadow: '0 8px 20px -3px rgba(37, 99, 235, 0.12)',
                    },
                  }}
                >
                  <Box
                    sx={{
                      width: 36,
                      height: 36,
                      borderRadius: 2,
                      background: 'linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%)',
                      color: '#1d4ed8',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      border: '1px solid rgba(255, 255, 255, 0.9)',
                      boxShadow: '0 2px 6px rgba(37, 99, 235, 0.15)',
                    }}
                  >
                    <PeopleIcon sx={{ fontSize: 19 }} />
                  </Box>
                  <Box>
                    <Typography sx={{ fontWeight: 800, fontSize: '0.8rem', color: '#0f172a', lineHeight: 1.15 }}>
                      Lead
                    </Typography>
                    <Typography sx={{ fontWeight: 600, fontSize: '0.74rem', color: '#475569', lineHeight: 1.15 }}>
                      Management
                    </Typography>
                  </Box>
                </Box>
              </Grid>

              {/* 2. Loan Origination */}
              <Grid item xs={6}>
                <Box
                  sx={{
                    background: 'linear-gradient(145deg, #ecfdf5 0%, #ffffff 100%)',
                    border: '1px solid rgba(167, 243, 208, 0.95)',
                    borderRadius: 2.25,
                    p: 1.25,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.15,
                    boxShadow: '0 4px 14px -2px rgba(5, 150, 105, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.9)',
                    transition: 'all 0.18s ease',
                    position: 'relative',
                    overflow: 'hidden',
                    '&:hover': {
                      transform: 'translateY(-1.5px)',
                      borderColor: '#34d399',
                      boxShadow: '0 8px 20px -3px rgba(5, 150, 105, 0.12)',
                    },
                  }}
                >
                  <Box
                    sx={{
                      width: 36,
                      height: 36,
                      borderRadius: 2,
                      background: 'linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%)',
                      color: '#047857',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      border: '1px solid rgba(255, 255, 255, 0.9)',
                      boxShadow: '0 2px 6px rgba(5, 150, 105, 0.15)',
                    }}
                  >
                    <DescriptionIcon sx={{ fontSize: 19 }} />
                  </Box>
                  <Box>
                    <Typography sx={{ fontWeight: 800, fontSize: '0.8rem', color: '#0f172a', lineHeight: 1.15 }}>
                      Loan
                    </Typography>
                    <Typography sx={{ fontWeight: 600, fontSize: '0.74rem', color: '#475569', lineHeight: 1.15 }}>
                      Origination
                    </Typography>
                  </Box>
                </Box>
              </Grid>

              {/* 3. Lender Management */}
              <Grid item xs={6}>
                <Box
                  sx={{
                    background: 'linear-gradient(145deg, #f5f3ff 0%, #ffffff 100%)',
                    border: '1px solid rgba(221, 214, 254, 0.95)',
                    borderRadius: 2.25,
                    p: 1.25,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.15,
                    boxShadow: '0 4px 14px -2px rgba(124, 58, 237, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.9)',
                    transition: 'all 0.18s ease',
                    position: 'relative',
                    overflow: 'hidden',
                    '&:hover': {
                      transform: 'translateY(-1.5px)',
                      borderColor: '#a78bfa',
                      boxShadow: '0 8px 20px -3px rgba(124, 58, 237, 0.12)',
                    },
                  }}
                >
                  <Box
                    sx={{
                      width: 36,
                      height: 36,
                      borderRadius: 2,
                      background: 'linear-gradient(135deg, #ede9fe 0%, #ddd6fe 100%)',
                      color: '#6d28d9',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      border: '1px solid rgba(255, 255, 255, 0.9)',
                      boxShadow: '0 2px 6px rgba(124, 58, 237, 0.15)',
                    }}
                  >
                    <AccountBalanceIcon sx={{ fontSize: 19 }} />
                  </Box>
                  <Box>
                    <Typography sx={{ fontWeight: 800, fontSize: '0.8rem', color: '#0f172a', lineHeight: 1.15 }}>
                      Lender
                    </Typography>
                    <Typography sx={{ fontWeight: 600, fontSize: '0.74rem', color: '#475569', lineHeight: 1.15 }}>
                      Management
                    </Typography>
                  </Box>
                </Box>
              </Grid>

              {/* 4. Compliant & Secure */}
              <Grid item xs={6}>
                <Box
                  sx={{
                    background: 'linear-gradient(145deg, #fffbeb 0%, #ffffff 100%)',
                    border: '1px solid rgba(254, 243, 199, 0.95)',
                    borderRadius: 2.25,
                    p: 1.25,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.15,
                    boxShadow: '0 4px 14px -2px rgba(217, 119, 6, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.9)',
                    transition: 'all 0.18s ease',
                    position: 'relative',
                    overflow: 'hidden',
                    '&:hover': {
                      transform: 'translateY(-1.5px)',
                      borderColor: '#fbbf24',
                      boxShadow: '0 8px 20px -3px rgba(217, 119, 6, 0.12)',
                    },
                  }}
                >
                  <Box
                    sx={{
                      width: 36,
                      height: 36,
                      borderRadius: 2,
                      background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)',
                      color: '#b45309',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      border: '1px solid rgba(255, 255, 255, 0.9)',
                      boxShadow: '0 2px 6px rgba(217, 119, 6, 0.15)',
                    }}
                  >
                    <ShieldIcon sx={{ fontSize: 19 }} />
                  </Box>
                  <Box>
                    <Typography sx={{ fontWeight: 800, fontSize: '0.8rem', color: '#0f172a', lineHeight: 1.15 }}>
                      Compliant
                    </Typography>
                    <Typography sx={{ fontWeight: 600, fontSize: '0.74rem', color: '#475569', lineHeight: 1.15 }}>
                      & Secure
                    </Typography>
                  </Box>
                </Box>
              </Grid>
            </Grid>
          </Box>

          {/* Bottom City Skyline / Buildings Illustration */}
          <Box
            sx={{
              position: 'relative',
              width: '100%',
              mt: { xs: 2, md: 'auto' },
              pt: 1.5,
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'center',
              overflow: 'hidden',
              pointerEvents: 'none',
              zIndex: 1,
            }}
          >
            {/* SVG City Skyline Architecture Illustration matching reference image with rich realistic textures & graphics */}
            <svg
              width="100%"
              height="125"
              viewBox="0 0 560 150"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              style={{ width: '100%', height: 'auto', maxHeight: 130, display: 'block' }}
            >
              <defs>
                {/* Facade linear gradients for realistic architectural lighting */}
                <linearGradient id="skyGradFar" x1="0" y1="20" x2="0" y2="150" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#bfdbfe" stopOpacity="0.45" />
                  <stop offset="100%" stopColor="#93c5fd" stopOpacity="0.25" />
                </linearGradient>
                <linearGradient id="skyGradMid" x1="0" y1="35" x2="0" y2="150" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#dbeafe" stopOpacity="0.75" />
                  <stop offset="100%" stopColor="#bfdbfe" stopOpacity="0.35" />
                </linearGradient>

                <linearGradient id="cloudGrad" x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox">
                  <stop offset="0%" stopColor="#ffffff" stopOpacity="0.85" />
                  <stop offset="100%" stopColor="#e0f2fe" stopOpacity="0.55" />
                </linearGradient>

                <linearGradient id="facadeWhite" x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox">
                  <stop offset="0%" stopColor="#ffffff" />
                  <stop offset="60%" stopColor="#f8fbff" />
                  <stop offset="100%" stopColor="#edf5ff" />
                </linearGradient>

                <linearGradient id="facadeShade" x1="0" y1="0" x2="1" y2="0" gradientUnits="objectBoundingBox">
                  <stop offset="0%" stopColor="#ffffff" />
                  <stop offset="85%" stopColor="#f4f8fe" />
                  <stop offset="100%" stopColor="#e2eefe" />
                </linearGradient>

                <linearGradient id="facadeSideBevel" x1="0" y1="0" x2="1" y2="0" gradientUnits="objectBoundingBox">
                  <stop offset="0%" stopColor="#dbeafe" />
                  <stop offset="100%" stopColor="#bfdbfe" />
                </linearGradient>

                {/* Glass window reflections */}
                <linearGradient id="glassSheenGrad" x1="0" y1="0" x2="1" y2="1" gradientUnits="objectBoundingBox">
                  <stop offset="0%" stopColor="#eff6ff" stopOpacity="0.95" />
                  <stop offset="45%" stopColor="#dbeafe" stopOpacity="0.9" />
                  <stop offset="55%" stopColor="#bfdbfe" stopOpacity="0.8" />
                  <stop offset="100%" stopColor="#93c5fd" stopOpacity="0.85" />
                </linearGradient>

                <linearGradient id="glassSheenWarm" x1="0" y1="0" x2="1" y2="1" gradientUnits="objectBoundingBox">
                  <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
                  <stop offset="50%" stopColor="#fef3c7" stopOpacity="0.95" />
                  <stop offset="100%" stopColor="#fde68a" stopOpacity="0.9" />
                </linearGradient>

                <linearGradient id="glassSheenCyan" x1="0" y1="0" x2="1" y2="1" gradientUnits="objectBoundingBox">
                  <stop offset="0%" stopColor="#f0fdfa" stopOpacity="0.95" />
                  <stop offset="50%" stopColor="#ccfbf1" stopOpacity="0.9" />
                  <stop offset="100%" stopColor="#99f6e4" stopOpacity="0.85" />
                </linearGradient>

                <linearGradient id="glassSheenLight" x1="0" y1="0" x2="1" y2="1" gradientUnits="objectBoundingBox">
                  <stop offset="0%" stopColor="#ffffff" stopOpacity="0.75" />
                  <stop offset="50%" stopColor="#e0f2fe" stopOpacity="0.45" />
                  <stop offset="100%" stopColor="#bfdbfe" stopOpacity="0.1" />
                </linearGradient>

                <linearGradient id="crownGrad" x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox">
                  <stop offset="0%" stopColor="#f0f7ff" />
                  <stop offset="100%" stopColor="#dbeafe" />
                </linearGradient>

                {/* Tree greenery textures */}
                <linearGradient id="treeGradBack" x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox">
                  <stop offset="0%" stopColor="#34d399" stopOpacity="0.8" />
                  <stop offset="100%" stopColor="#059669" stopOpacity="0.95" />
                </linearGradient>
                <linearGradient id="treeGradFront" x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox">
                  <stop offset="0%" stopColor="#6ee7b7" stopOpacity="0.95" />
                  <stop offset="100%" stopColor="#10b981" stopOpacity="0.98" />
                </linearGradient>

                {/* Red beacon glow */}
                <filter id="beaconGlow" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="2.5" result="glow" />
                  <feMerge>
                    <feMergeNode in="glow" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {/* === 1. ATMOSPHERIC SKY GRAPHICS (Clouds & Soaring Birds) === */}
              {/* Cumulus Cloud 1 */}
              <path
                d="M95 24 Q108 12 124 16 Q138 8 152 18 Q164 14 170 24 Q178 28 174 36 H98 Q90 32 95 24 Z"
                fill="url(#cloudGrad)"
                stroke="rgba(147, 197, 253, 0.6)"
                strokeWidth="0.8"
              />
              {/* Cumulus Cloud 2 */}
              <path
                d="M335 22 Q346 14 360 17 Q372 10 384 18 Q394 15 399 23 H340 Q332 28 335 22 Z"
                fill="url(#cloudGrad)"
                stroke="rgba(147, 197, 253, 0.5)"
                strokeWidth="0.75"
              />
              {/* Aviary flock of birds soaring in flight */}
              <path d="M52 28 Q55 24 58 28 Q61 24 64 28" stroke="#3B82F6" strokeWidth="1.2" fill="none" strokeLinecap="round" />
              <path d="M68 22 Q71 18 74 22 Q77 18 80 22" stroke="#60A5FA" strokeWidth="1.1" fill="none" strokeLinecap="round" />
              <path d="M84 27 Q86.5 24 89 27 Q91.5 24 94 27" stroke="#93C5FD" strokeWidth="0.9" fill="none" strokeLinecap="round" />
              <path d="M465 24 Q468 20 471 24 Q474 20 477 24" stroke="#60A5FA" strokeWidth="1" fill="none" strokeLinecap="round" />

              {/* === 2. DISTANT BACKGROUND SKYLINE (Layer 1 - Atmospheric depth) === */}
              <path
                d="M5 150 V92 H22 V78 H42 V68 H62 V82 H85 V58 H108 V72 H130 V48 H152 V64 H170 V32 H192 V46 H214 V58 H242 V38 H268 V66 H298 V42 H324 V28 H352 V54 H378 V66 H408 V40 H434 V60 H462 V48 H490 V68 H515 V52 H538 V70 H555 V150 Z"
                fill="url(#skyGradFar)"
              />
              {/* Faint distant window illumination clusters */}
              <g opacity="0.45" fill="#ffffff">
                <rect x="28" y="86" width="3" height="3" rx="0.5" />
                <rect x="34" y="86" width="3" height="3" rx="0.5" />
                <rect x="90" y="66" width="3" height="4" rx="0.5" />
                <rect x="96" y="66" width="3" height="4" rx="0.5" />
                <rect x="136" y="56" width="3" height="4" rx="0.5" />
                <rect x="142" y="56" width="3" height="4" rx="0.5" />
                <rect x="220" y="68" width="3" height="4" rx="0.5" />
                <rect x="226" y="68" width="3" height="4" rx="0.5" />
                <rect x="304" y="52" width="3" height="4" rx="0.5" />
                <rect x="310" y="52" width="3" height="4" rx="0.5" />
                <rect x="384" y="74" width="3" height="4" rx="0.5" />
                <rect x="390" y="74" width="3" height="4" rx="0.5" />
                <rect x="440" y="68" width="3" height="4" rx="0.5" />
                <rect x="446" y="68" width="3" height="4" rx="0.5" />
                <rect x="498" y="74" width="3" height="4" rx="0.5" />
                <rect x="504" y="74" width="3" height="4" rx="0.5" />
              </g>

              {/* Mid-distance silhouette layer */}
              <path
                d="M15 150 V82 H36 V72 H58 V86 H88 V54 H120 V76 H158 V42 H180 V50 H204 V62 H238 V44 H272 V72 H306 V48 H328 V34 H358 V58 H386 V72 H420 V46 H450 V66 H484 V54 H516 V76 H545 V150 Z"
                fill="url(#skyGradMid)"
                stroke="rgba(147, 197, 253, 0.4)"
                strokeWidth="0.8"
              />

              {/* === 3. FOREGROUND ARCHITECTURAL TOWERS (TEXTURED & REALISTIC) === */}

              {/* ----------------- BUILDING 1: Left Tower with Antenna (x: 25..63) ----------------- */}
              <g id="tower1">
                {/* 3D side shadow */}
                <rect x="25" y="70" width="38" height="80" rx="1.5" fill="url(#facadeShade)" stroke="#3B82F6" strokeWidth="1.2" />
                <rect x="59" y="70" width="4" height="80" fill="url(#facadeSideBevel)" />
                {/* Roof coping trim */}
                <rect x="24" y="68" width="40" height="3" rx="0.8" fill="#dbeafe" stroke="#3B82F6" strokeWidth="1" />
                {/* Antenna mast with rigging */}
                <line x1="44" y1="48" x2="44" y2="68" stroke="#1D4ED8" strokeWidth="1.6" />
                <line x1="39" y1="56" x2="49" y2="56" stroke="#60A5FA" strokeWidth="1" />
                <line x1="41" y1="62" x2="47" y2="62" stroke="#60A5FA" strokeWidth="1" />
                <circle cx="44" cy="48" r="2.2" fill="#2563EB" />
                <circle cx="44" cy="48" r="4.5" fill="#3B82F6" opacity="0.3" />
                {/* Detailed vertical structural mullions & window slots */}
                <line x1="33" y1="74" x2="33" y2="150" stroke="#93C5FD" strokeWidth="1.2" />
                <line x1="44" y1="74" x2="44" y2="150" stroke="#93C5FD" strokeWidth="1.2" />
                <line x1="55" y1="74" x2="55" y2="150" stroke="#93C5FD" strokeWidth="1.2" />
                {/* Micro vertical fluting lines for masonry texture */}
                <line x1="29" y1="74" x2="29" y2="150" stroke="#e0f2fe" strokeWidth="0.6" strokeDasharray="3 3" />
                <line x1="38" y1="74" x2="38" y2="150" stroke="#e0f2fe" strokeWidth="0.6" strokeDasharray="3 3" />
                <line x1="50" y1="74" x2="50" y2="150" stroke="#e0f2fe" strokeWidth="0.6" strokeDasharray="3 3" />
                {/* Textured horizontal floor joints / spandrels */}
                <g stroke="#60A5FA" strokeWidth="0.9" opacity="0.85">
                  <line x1="29" y1="84" x2="37" y2="84" />
                  <line x1="40" y1="84" x2="48" y2="84" />
                  <line x1="51" y1="84" x2="59" y2="84" />
                  <line x1="29" y1="96" x2="37" y2="96" />
                  <line x1="40" y1="96" x2="48" y2="96" />
                  <line x1="51" y1="96" x2="59" y2="96" />
                  <line x1="29" y1="108" x2="37" y2="108" />
                  <line x1="40" y1="108" x2="48" y2="108" />
                  <line x1="51" y1="108" x2="59" y2="108" />
                  <line x1="29" y1="120" x2="37" y2="120" />
                  <line x1="40" y1="120" x2="48" y2="120" />
                  <line x1="51" y1="120" x2="59" y2="120" />
                  <line x1="29" y1="132" x2="37" y2="132" />
                  <line x1="40" y1="132" x2="48" y2="132" />
                  <line x1="51" y1="132" x2="59" y2="132" />
                </g>
                {/* Subtle glass reflection sheen */}
                <polygon points="26,71 42,71 30,120 26,120" fill="url(#glassSheenLight)" />
              </g>

              {/* ----------------- BUILDING 2: Grid Commercial Block with Exoskeleton & Water Tank (x: 75..123) ----------------- */}
              <g id="tower2">
                {/* Rooftop Water Tower */}
                <g id="waterTank">
                  <line x1="106" y1="45" x2="108" y2="53" stroke="#3B82F6" strokeWidth="1" />
                  <line x1="114" y1="45" x2="112" y2="53" stroke="#3B82F6" strokeWidth="1" />
                  <rect x="105" y="42" width="10" height="7" rx="1" fill="#eff6ff" stroke="#2563EB" strokeWidth="1" />
                  <polygon points="104,42 110,38 116,42" fill="#dbeafe" stroke="#2563EB" strokeWidth="1" />
                  {/* Chiller unit */}
                  <rect x="80" y="48" width="12" height="5" fill="#e0f2fe" stroke="#3B82F6" strokeWidth="0.8" />
                </g>

                <rect x="75" y="55" width="48" height="95" rx="1.5" fill="url(#facadeShade)" stroke="#2563EB" strokeWidth="1.3" />
                <rect x="119" y="55" width="4" height="95" fill="url(#facadeSideBevel)" />
                {/* Roof cornice */}
                <rect x="73" y="53" width="52" height="3.5" rx="0.8" fill="#dbeafe" stroke="#2563EB" strokeWidth="1" />

                {/* Exoskeleton Diagonal Steel Diamond Bracing Texture */}
                <g stroke="#93C5FD" strokeWidth="0.85" opacity="0.65" strokeDasharray="4 2">
                  <line x1="75" y1="55" x2="119" y2="95" />
                  <line x1="119" y1="55" x2="75" y2="95" />
                  <line x1="75" y1="95" x2="119" y2="135" />
                  <line x1="119" y1="95" x2="75" y2="135" />
                </g>

                {/* Textured 3x5 Window Matrix with Glass Gradients and Light Variations */}
                {(
                  [
                    [83, 65], [95, 65], [107, 65],
                    [83, 77], [95, 77], [107, 77],
                    [83, 89], [95, 89], [107, 89],
                    [83, 101], [95, 101], [107, 101],
                    [83, 113], [95, 113], [107, 113],
                  ] as const
                ).map(([wx, wy], idx) => {
                  const isWarm = idx === 4 || idx === 10;
                  const isCyan = idx === 1 || idx === 8;
                  const fillGrad = isWarm ? 'url(#glassSheenWarm)' : isCyan ? 'url(#glassSheenCyan)' : 'url(#glassSheenGrad)';
                  return (
                    <g key={`w2-${idx}`}>
                      <rect x={wx} y={wy} width="8.5" height="6.5" rx="1" fill={fillGrad} stroke="#3B82F6" strokeWidth="0.85" />
                      {/* Inner highlight glass reflection */}
                      <line x1={wx + 1.5} y1={wy + 1.2} x2={wx + 6.5} y2={wy + 1.2} stroke="#ffffff" strokeWidth="0.7" opacity="0.9" />
                    </g>
                  );
                })}
                {/* Structural dividing floor bands */}
                <line x1="75" y1="73" x2="119" y2="73" stroke="#bfdbfe" strokeWidth="0.8" />
                <line x1="75" y1="85" x2="119" y2="85" stroke="#bfdbfe" strokeWidth="0.8" />
                <line x1="75" y1="97" x2="119" y2="97" stroke="#bfdbfe" strokeWidth="0.8" />
                <line x1="75" y1="109" x2="119" y2="109" stroke="#bfdbfe" strokeWidth="0.8" />
                {/* Diagonal facade reflection */}
                <polygon points="76,56 100,56 82,130 76,130" fill="url(#glassSheenLight)" />
              </g>

              {/* ----------------- BUILDING 3: Slanted Roof Highrise with Solar Panels (x: 135..170) ----------------- */}
              <g id="tower3">
                <polygon points="135,150 135,65 170,45 170,150" fill="url(#facadeShade)" stroke="#2563EB" strokeWidth="1.3" />
                {/* 3D Slanted Roof Edge & Solar Panel Grid Texture */}
                <line x1="135" y1="65" x2="170" y2="45" stroke="#1D4ED8" strokeWidth="2.4" strokeLinecap="round" />
                {/* Solar panel specular cells on top edge */}
                <polygon points="140,63 166,48 167,49 141,64" fill="#1e3a8a" stroke="#60a5fa" strokeWidth="0.6" />
                {/* Angled textured window ribbons with depth */}
                {[75, 88, 101, 114, 127].map((ly, idx) => (
                  <g key={`sl-${idx}`}>
                    <polygon
                      points={`143,${ly} 164,${ly - 10} 164,${ly - 7} 143,${ly + 3}`}
                      fill={idx % 2 === 0 ? 'url(#glassSheenCyan)' : 'url(#glassSheenGrad)'}
                      stroke="#3B82F6"
                      strokeWidth="0.8"
                    />
                    <line x1="143" y1={ly} x2="164" y2={ly - 10} stroke="#60A5FA" strokeWidth="1" />
                  </g>
                ))}
                {/* Vertical structural mullion */}
                <line x1="153" y1="56" x2="153" y2="150" stroke="#bfdbfe" strokeWidth="1" strokeDasharray="3 2" />
                {/* Diagonal glass glare */}
                <polygon points="136,66 150,57 142,145 136,145" fill="url(#glassSheenLight)" />
              </g>

              {/* ----------------- BUILDING 4: Central Signature Skyscraper with Spire & Helipad (x: 180..238) ----------------- */}
              <g id="tower4">
                {/* Main tower body with shaded gradient */}
                <rect x="180" y="38" width="58" height="112" rx="1.5" fill="url(#facadeWhite)" stroke="#1D4ED8" strokeWidth="1.5" />
                {/* Lateral 3D depth panel */}
                <rect x="234" y="38" width="4" height="112" fill="url(#facadeSideBevel)" />

                {/* Architectural Crown / Pyramid top */}
                <polygon points="180,38 209,16 238,38" fill="url(#crownGrad)" stroke="#1D4ED8" strokeWidth="1.4" />
                <line x1="180" y1="38" x2="238" y2="38" stroke="#1D4ED8" strokeWidth="1.5" />
                {/* Crown inner glass chevron */}
                <polygon points="188,36 209,21 230,36" fill="url(#glassSheenGrad)" stroke="#3B82F6" strokeWidth="0.9" opacity="0.85" />

                {/* Spire with beacon and glowing light */}
                <line x1="209" y1="3" x2="209" y2="16" stroke="#1E40AF" strokeWidth="2.2" strokeLinecap="round" />
                <circle cx="209" cy="3" r="3" fill="#EF4444" filter="url(#beaconGlow)" />
                <circle cx="209" cy="3" r="1.5" fill="#FEE2E2" />

                {/* Rooftop Helipad Graphic */}
                <ellipse cx="209" cy="42" rx="9" ry="3.5" fill="#1E40AF" stroke="#93C5FD" strokeWidth="0.8" />
                <line x1="207" y1="40" x2="207" y2="44" stroke="#ffffff" strokeWidth="0.8" />
                <line x1="211" y1="40" x2="211" y2="44" stroke="#ffffff" strokeWidth="0.8" />
                <line x1="207" y1="42" x2="211" y2="42" stroke="#ffffff" strokeWidth="0.8" />

                {/* Vertical mullions / curtain wall fins */}
                <line x1="192" y1="46" x2="192" y2="150" stroke="#60A5FA" strokeWidth="1.3" />
                <line x1="203" y1="46" x2="203" y2="150" stroke="#60A5FA" strokeWidth="1.3" />
                <line x1="215" y1="46" x2="215" y2="150" stroke="#60A5FA" strokeWidth="1.3" />
                <line x1="226" y1="46" x2="226" y2="150" stroke="#60A5FA" strokeWidth="1.3" />

                {/* Horizontal structural floor slabs with rich textured detail */}
                {[54, 68, 82, 96, 110, 124, 138].map((fy, idx) => (
                  <g key={`fl-${idx}`}>
                    <line x1="180" y1={fy} x2="234" y2={fy} stroke="#3B82F6" strokeWidth="0.9" />
                    {/* Intermediate window glass accents with light variance */}
                    <rect x="183" y={fy - 8} width="6" height="6.5" rx="0.5" fill={idx === 2 ? 'url(#glassSheenWarm)' : 'url(#glassSheenGrad)'} opacity="0.85" />
                    <rect x="195" y={fy - 8} width="5" height="6.5" rx="0.5" fill="url(#glassSheenGrad)" opacity="0.85" />
                    <rect x="206" y={fy - 8} width="6" height="6.5" rx="0.5" fill={idx === 4 ? 'url(#glassSheenCyan)' : 'url(#glassSheenGrad)'} opacity="0.85" />
                    <rect x="218" y={fy - 8} width="5" height="6.5" rx="0.5" fill="url(#glassSheenGrad)" opacity="0.85" />
                  </g>
                ))}

                {/* Full skyscraper diagonal glass reflection band */}
                <polygon points="181,46 215,46 188,145 181,145" fill="url(#glassSheenLight)" />
              </g>

              {/* ----------------- BUILDING 5: Modern Stepped Tower (x: 250..296) ----------------- */}
              <g id="tower5">
                {/* Main lower block */}
                <rect x="250" y="58" width="46" height="92" rx="1.5" fill="url(#facadeShade)" stroke="#2563EB" strokeWidth="1.3" />
                <rect x="292" y="58" width="4" height="92" fill="url(#facadeSideBevel)" />
                {/* Upper stepped tier */}
                <rect x="258" y="44" width="30" height="14" rx="1" fill="url(#facadeWhite)" stroke="#2563EB" strokeWidth="1.2" />
                <line x1="250" y1="58" x2="296" y2="58" stroke="#1D4ED8" strokeWidth="1.4" />
                {/* Roof transmitter */}
                <line x1="273" y1="32" x2="273" y2="44" stroke="#1D4ED8" strokeWidth="1.5" />
                <circle cx="273" cy="32" r="2" fill="#2563EB" />

                {/* Vertical glass ribbons with micro mullions */}
                {[258, 270, 282].map((gx, idx) => (
                  <g key={`rib-${idx}`}>
                    <rect x={gx} y="68" width="8.5" height="60" rx="1" fill={idx === 1 ? 'url(#glassSheenCyan)' : 'url(#glassSheenGrad)'} stroke="#3B82F6" strokeWidth="0.85" />
                    {/* Window cross dividers for realism */}
                    <line x1={gx} y1="80" x2={gx + 8.5} y2="80" stroke="#60A5FA" strokeWidth="0.7" />
                    <line x1={gx} y1="95" x2={gx + 8.5} y2="95" stroke="#60A5FA" strokeWidth="0.7" />
                    <line x1={gx} y1="110" x2={gx + 8.5} y2="110" stroke="#60A5FA" strokeWidth="0.7" />
                    <line x1={gx + 1.2} y1="69" x2={gx + 1.2} y2="127" stroke="#ffffff" strokeWidth="0.7" opacity="0.8" />
                  </g>
                ))}
              </g>

              {/* ----------------- BUILDING 6: Corporate HQ with Satellite Dish (x: 306..360) ----------------- */}
              <g id="tower6">
                {/* Rooftop Satellite Dish */}
                <path d="M344 48 Q349 44 353 39" stroke="#2563EB" strokeWidth="1.6" fill="none" strokeLinecap="round" />
                <line x1="348" y1="43" x2="352" y2="41" stroke="#1D4ED8" strokeWidth="1.2" />
                <circle cx="352" cy="41" r="1.2" fill="#3B82F6" />

                <rect x="306" y="68" width="54" height="82" rx="1.5" fill="url(#facadeShade)" stroke="#2563EB" strokeWidth="1.3" />
                <rect x="356" y="68" width="4" height="82" fill="url(#facadeSideBevel)" />
                {/* Pediment Gabled Roof with Texture */}
                <polygon points="306,68 333,50 360,68" fill="url(#crownGrad)" stroke="#1D4ED8" strokeWidth="1.3" />
                <polygon points="314,66 333,53 352,66" fill="url(#glassSheenGrad)" stroke="#3B82F6" strokeWidth="0.8" />
                <line x1="306" y1="68" x2="360" y2="68" stroke="#1D4ED8" strokeWidth="1.3" />

                {/* Architectural vertical mullions & textured window strips */}
                <line x1="318" y1="72" x2="318" y2="150" stroke="#60A5FA" strokeWidth="1.2" />
                <line x1="333" y1="72" x2="333" y2="150" stroke="#60A5FA" strokeWidth="1.2" />
                <line x1="348" y1="72" x2="348" y2="150" stroke="#60A5FA" strokeWidth="1.2" />

                {/* Grid window panes */}
                {[78, 92, 106, 120, 134].map((gy, idx) => (
                  <g key={`hqw-${idx}`}>
                    <line x1="306" y1={gy} x2="356" y2={gy} stroke="#bfdbfe" strokeWidth="0.8" />
                    <rect x="310" y={gy - 8} width="5" height="6" rx="0.5" fill="url(#glassSheenGrad)" opacity="0.8" />
                    <rect x="322" y={gy - 8} width="7" height="6" rx="0.5" fill={idx === 1 ? 'url(#glassSheenWarm)' : 'url(#glassSheenGrad)'} opacity="0.85" />
                    <rect x="337" y={gy - 8} width="7" height="6" rx="0.5" fill="url(#glassSheenGrad)" opacity="0.8" />
                    <rect x="350" y={gy - 8} width="4" height="6" rx="0.5" fill="url(#glassSheenGrad)" opacity="0.8" />
                  </g>
                ))}
                {/* Glass reflection */}
                <polygon points="307,69 328,69 315,140 307,140" fill="url(#glassSheenLight)" />
              </g>

              {/* ----------------- BUILDING 7: Highrise with Slanted Top (x: 370..412) ----------------- */}
              <g id="tower7">
                <polygon points="370,150 370,50 412,30 412,150" fill="url(#facadeShade)" stroke="#1D4ED8" strokeWidth="1.4" />
                <line x1="370" y1="50" x2="412" y2="30" stroke="#1E40AF" strokeWidth="2.2" strokeLinecap="round" />
                {/* Rooftop communication spire */}
                <line x1="391" y1="16" x2="391" y2="40" stroke="#1D4ED8" strokeWidth="1.6" />
                <circle cx="391" cy="16" r="2.2" fill="#2563EB" />

                {/* Textured diagonal louvers / glass fins */}
                {[58, 72, 86, 100, 114, 128].map((sy, idx) => (
                  <g key={`sl7-${idx}`}>
                    <polygon
                      points={`378,${sy} 404,${sy - 8} 404,${sy - 5} 378,${sy + 3}`}
                      fill={idx % 2 === 0 ? 'url(#glassSheenCyan)' : 'url(#glassSheenGrad)'}
                      stroke="#3B82F6"
                      strokeWidth="0.8"
                    />
                    <line x1="378" y1={sy} x2="404" y2={sy - 8} stroke="#60A5FA" strokeWidth="1" />
                  </g>
                ))}
                <line x1="391" y1="40" x2="391" y2="150" stroke="#bfdbfe" strokeWidth="1" strokeDasharray="3 2" />
                <polygon points="371,51 386,44 376,145 371,145" fill="url(#glassSheenLight)" />
              </g>

              {/* ----------------- BUILDING 8: Classical Bank & Office Block (x: 424..476) ----------------- */}
              <g id="tower8">
                {/* Rooftop Chiller Unit */}
                <rect x="428" y="58" width="16" height="6" fill="#e0f2fe" stroke="#3B82F6" strokeWidth="0.9" rx="0.5" />
                <line x1="432" y1="58" x2="432" y2="64" stroke="#60A5FA" strokeWidth="0.7" />
                <line x1="436" y1="58" x2="436" y2="64" stroke="#60A5FA" strokeWidth="0.7" />
                <line x1="440" y1="58" x2="440" y2="64" stroke="#60A5FA" strokeWidth="0.7" />

                <rect x="424" y="66" width="52" height="84" rx="1.5" fill="url(#facadeShade)" stroke="#2563EB" strokeWidth="1.3" />
                <rect x="472" y="66" width="4" height="84" fill="url(#facadeSideBevel)" />
                {/* Parapet top trim */}
                <rect x="422" y="64" width="56" height="3.5" rx="0.8" fill="#dbeafe" stroke="#2563EB" strokeWidth="1" />

                {/* 3x4 detailed window grid with realistic glass and frames */}
                {(
                  [
                    [432, 74], [444, 74], [456, 74],
                    [432, 88], [444, 88], [456, 88],
                    [432, 102], [444, 102], [456, 102],
                    [432, 116], [444, 116], [456, 116],
                  ] as const
                ).map(([bx, by], idx) => {
                  const isWarm = idx === 1 || idx === 8;
                  const fillGrad = isWarm ? 'url(#glassSheenWarm)' : 'url(#glassSheenGrad)';
                  return (
                    <g key={`b8-${idx}`}>
                      <rect x={bx} y={by} width="8" height="9" rx="1" fill={fillGrad} stroke="#3B82F6" strokeWidth="0.85" />
                      {/* Window sill shadow */}
                      <line x1={bx} y1={by + 9} x2={bx + 8} y2={by + 9} stroke="#1E40AF" strokeWidth="0.8" />
                      <line x1={bx + 1} y1={by + 1.5} x2={bx + 7} y2={by + 1.5} stroke="#ffffff" strokeWidth="0.7" opacity="0.85" />
                    </g>
                  );
                })}
                <line x1="424" y1="84" x2="472" y2="84" stroke="#bfdbfe" strokeWidth="0.8" />
                <line x1="424" y1="98" x2="472" y2="98" stroke="#bfdbfe" strokeWidth="0.8" />
                <line x1="424" y1="112" x2="472" y2="112" stroke="#bfdbfe" strokeWidth="0.8" />
                <polygon points="425,67 448,67 435,140 425,140" fill="url(#glassSheenLight)" />
              </g>

              {/* ----------------- BUILDING 9: Right Corner Modern Block (x: 486..531) ----------------- */}
              <g id="tower9">
                <rect x="486" y="60" width="45" height="90" rx="1.5" fill="url(#facadeShade)" stroke="#3B82F6" strokeWidth="1.2" />
                <rect x="527" y="60" width="4" height="90" fill="url(#facadeSideBevel)" />
                <rect x="484" y="58" width="48" height="3.5" rx="0.8" fill="#dbeafe" stroke="#3B82F6" strokeWidth="1" />

                {/* Vertical structural mullions */}
                <line x1="496" y1="64" x2="496" y2="150" stroke="#93C5FD" strokeWidth="1.2" />
                <line x1="508" y1="64" x2="508" y2="150" stroke="#93C5FD" strokeWidth="1.2" />
                <line x1="520" y1="64" x2="520" y2="150" stroke="#93C5FD" strokeWidth="1.2" />

                {/* Micro window louvers */}
                {[72, 84, 96, 108, 120, 132].map((ly, idx) => (
                  <g key={`t9-${idx}`} stroke="#60A5FA" strokeWidth="0.9">
                    <line x1="489" y1={ly} x2="493" y2={ly} />
                    <line x1="499" y1={ly} x2="505" y2={ly} />
                    <line x1="511" y1={ly} x2="517" y2={ly} />
                    <line x1="523" y1={ly} x2="527" y2={ly} />
                  </g>
                ))}
                <polygon points="487,61 506,61 494,140 487,140" fill="url(#glassSheenLight)" />
              </g>

              {/* === 4. FOREGROUND PARK, TREES & BOULEVARD TEXTURES === */}
              {/* Layer 1: Ambient soft ground glow */}
              <rect x="0" y="138" width="560" height="12" fill="url(#facadeSideBevel)" opacity="0.35" />

              {/* Layer 2: Tree trunks supporting canopy */}
              <g stroke="#047857" strokeWidth="1.5" strokeLinecap="round">
                <line x1="25" y1="138" x2="25" y2="149" />
                <line x1="80" y1="136" x2="80" y2="149" />
                <line x1="144" y1="136" x2="144" y2="149" />
                <line x1="222" y1="134" x2="222" y2="149" />
                <line x1="302" y1="135" x2="302" y2="149" />
                <line x1="382" y1="134" x2="382" y2="149" />
                <line x1="464" y1="136" x2="464" y2="149" />
                <line x1="524" y1="136" x2="524" y2="149" />
              </g>

              {/* Layer 3: Deep Emerald Background Foliage Clusters */}
              <path
                d="M0 150 Q12 128 25 150 Q38 124 52 150 Q66 128 80 150 Q96 124 112 150 Q128 130 144 150 Q162 122 182 150 Q202 126 222 150 Q242 124 262 150 Q282 128 302 150 Q322 122 342 150 Q362 126 382 150 Q402 120 424 150 Q444 128 464 150 Q484 122 504 150 Q524 126 544 150 Q554 132 560 150 Z"
                fill="url(#treeGradBack)"
                stroke="#059669"
                strokeWidth="1.2"
              />

              {/* Layer 4: Vibrant Mint Mid-Layer with Textured Curves */}
              <path
                d="M8 150 Q22 132 36 150 Q50 128 65 150 Q80 134 95 150 Q112 128 130 150 Q150 132 170 150 Q192 126 215 150 Q238 130 260 150 Q285 126 310 150 Q335 130 360 150 Q388 126 415 150 Q440 130 465 150 Q490 128 515 150 Q535 132 555 150 Z"
                fill="url(#treeGradFront)"
                stroke="#10b981"
                strokeWidth="1.1"
              />

              {/* Layer 5: Canopy Highlight Stipples & Leaves */}
              <g stroke="#ffffff" strokeWidth="1" strokeLinecap="round" opacity="0.65">
                <path d="M48 134 Q53 130 58 134" fill="none" />
                <path d="M106 132 Q112 127 118 132" fill="none" />
                <path d="M176 130 Q182 125 188 130" fill="none" />
                <path d="M232 132 Q238 127 244 132" fill="none" />
                <path d="M304 130 Q310 125 316 130" fill="none" />
                <path d="M352 132 Q358 127 364 132" fill="none" />
                <path d="M408 128 Q415 123 422 128" fill="none" />
                <path d="M482 132 Q488 127 494 132" fill="none" />
              </g>

              {/* Layer 6: Boulevard Streetlamps along the Avenue */}
              <g id="streetlamps">
                {[68, 172, 290, 416, 532].map((lx) => (
                  <g key={`lamp-${lx}`}>
                    <line x1={lx} y1="135" x2={lx} y2="149" stroke="#3B82F6" strokeWidth="1.2" />
                    <line x1={lx - 1.5} y1="135" x2={lx + 1.5} y2="135" stroke="#1D4ED8" strokeWidth="1" />
                    <circle cx={lx} cy="134" r="1.8" fill="#FEF3C7" />
                    <circle cx={lx} cy="134" r="3.5" fill="#FDE68A" opacity="0.4" />
                  </g>
                ))}
              </g>

              {/* Layer 7: Modern Street Pavement & Road Divider Line */}
              <line x1="0" y1="149" x2="560" y2="149" stroke="#3B82F6" strokeWidth="1.8" />
              <line x1="0" y1="147.5" x2="560" y2="147.5" stroke="#93C5FD" strokeWidth="0.8" strokeDasharray="8 4" />
            </svg>
          </Box>
        </Box>

        {/* Right Form Box: Framed card with same background color and crisp white input fields */}
        <Box
          sx={{
            flex: { xs: 'none', md: '1 1 50%' },
            borderRadius: { xs: 3, md: 4.5 },
            border: '1px solid #dbeafe',
            background: 'linear-gradient(180deg, #f8fbff 0%, #f0f7ff 45%, #e6f1fe 100%)',
            boxShadow: '0 4px 20px -5px rgba(37, 99, 235, 0.05)',
            position: 'relative',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            p: { xs: 2.75, sm: 3.75, md: 4.25 },
          }}
        >
          {/* Subtle Accent Glow */}
          <Box
            sx={{
              position: 'absolute',
              top: -40,
              right: -40,
              width: 160,
              height: 160,
              borderRadius: '50%',
              bgcolor: 'rgba(224, 238, 255, 0.5)',
              filter: 'blur(35px)',
              pointerEvents: 'none',
            }}
          />

          {/* Heading and Subtitle */}
          <Box sx={{ textAlign: 'center', mb: 2.75, position: 'relative', zIndex: 1 }}>
            <Typography
              variant="h4"
              component="h1"
              sx={{
                fontFamily: '"Playfair Display", Georgia, "Times New Roman", serif',
                fontWeight: 700,
                color: '#0f172a',
                letterSpacing: '-0.02em',
                mb: 0.5,
                fontSize: { xs: '1.75rem', sm: '2.05rem' },
              }}
            >
              Welcome Back
            </Typography>
            <Typography variant="body2" sx={{ color: '#475569', fontSize: '0.84rem' }}>
              Sign In &mdash; Use your work email and password to access your account
            </Typography>
          </Box>

          {/* Feedback Alerts */}
          {errorMessage && (
            <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }} onClose={() => setErrorMessage(null)}>
              {errorMessage}
            </Alert>
          )}

          {/* Login Form */}
          <Box component="form" onSubmit={handleSubmit} noValidate sx={{ position: 'relative', zIndex: 1 }}>
            <Stack spacing={1.9}>
              <Box>
                <Typography
                  component="label"
                  htmlFor="auth-email-input"
                  sx={{
                    display: 'block',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    color: '#334155',
                    mb: 0.5,
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
                      fontSize: '0.9rem',
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
                      py: 1,
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
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    color: '#334155',
                    mb: 0.5,
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
                      fontSize: '0.9rem',
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
                      py: 1,
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
                  pt: 0.2,
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
                        p: 0.4,
                        '&.Mui-checked': { color: '#0f172a' },
                      }}
                    />
                  }
                  label={
                    <Typography
                      variant="body2"
                      sx={{ color: '#475569', fontSize: '0.8rem', userSelect: 'none' }}
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
                    fontSize: '0.8rem',
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
                  py: 1.15,
                  mt: 0.5,
                  fontWeight: 700,
                  textTransform: 'none',
                  fontSize: '0.95rem',
                  borderRadius: 2,
                  bgcolor: '#000000',
                  color: '#ffffff',
                  boxShadow: '0 4px 14px rgba(0, 0, 0, 0.2)',
                  '&:hover': {
                    bgcolor: '#1e293b',
                    boxShadow: '0 6px 20px rgba(0, 0, 0, 0.3)',
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

      {/* The one second-factor screen: the authenticator set-up with its QR code, or the code prompt. */}
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

// The old second-factor page. Its links now open the sign-in screen, where the same step runs.
export function MfaRedirect() {
  const location = useLocation();
  return <Navigate to="/login" replace state={location.state} />;
}

export default LoginPage;
