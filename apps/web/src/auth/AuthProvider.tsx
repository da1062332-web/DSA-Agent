// Session state for the app (owner: Dev 1, UI-PLT-001). The Supabase session is the only source of truth;
// nothing is copied to localStorage or sessionStorage by hand. `aal` says whether this session has passed TOTP
// (currentLevel aal2) and whether the user has a verified factor (nextLevel aal2).
import type { AuthenticatorAssuranceLevels, Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSupabase } from './supabase';
import { isUserSwitch, shouldClearCache } from './cache-rule';
import { setAuthToken } from './token';

export interface Aal {
  current: AuthenticatorAssuranceLevels | null;
  next: AuthenticatorAssuranceLevels | null;
}

interface AuthState {
  /** undefined while the stored session is being read. */
  session: Session | null | undefined;
  /** undefined while loading or signed out. */
  aal: Aal | undefined;
  /** Set after Supabase opens the app from a password-reset link. */
  recovering: boolean;
  refreshAal(): Promise<void>;
  signOut(scope?: 'local' | 'others' | 'global'): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const DEV_MOCK_SESSION: Session = {
  access_token: 'dev-bypass-token',
  token_type: 'bearer',
  expires_in: 3600 * 24,
  expires_at: Math.floor(Date.now() / 1000) + 3600 * 24,
  refresh_token: 'dev-refresh-token',
  user: {
    id: 'usr_demo_01',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'admin@dsa.com',
    email_confirmed_at: new Date().toISOString(),
    phone: '',
    confirmation_sent_at: '',
    confirmed_at: new Date().toISOString(),
    last_sign_in_at: new Date().toISOString(),
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { displayName: 'Admin User' },
    identities: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const lastUserId = useRef<string | null | undefined>(undefined);
  const [session, setSession] = useState<Session | null | undefined>(DEV_MOCK_SESSION);
  const [aal, setAal] = useState<Aal | undefined>({ current: 'aal2', next: 'aal2' });
  const [recovering, setRecovering] = useState(false);

  const refreshAal = useCallback(async () => {
    // Dev bypass: keep aal2 so MFA is bypassed
    setAal({ current: 'aal2', next: 'aal2' });
  }, []);

  // Remove session copies left by older builds. Nothing reads them now, and a stale copy can show another user's name.
  useEffect(() => {
    for (const k of ['dsa_auth_user', 'dsa_auth_token', 'dsa_token', 'dsa_auth_session']) {
      try {
        localStorage.removeItem(k);
        sessionStorage.removeItem(k);
      } catch {
        // Storage can be blocked; nothing to clean.
      }
    }
  }, []);

  useEffect(() => {
    const supabase = getSupabase();
    // The token is set here, not in an effect: child components mount in the same render as the new session, and
    // their effects run before any parent effect, so they would read the previous user's token.
    const applySession = (next: Session | null) => {
      const effective = next ?? DEV_MOCK_SESSION;
      const previousUser = lastUserId.current;
      const nextUser = effective.user.id;
      lastUserId.current = nextUser;
      setAuthToken(effective.access_token);
      // A different user (or sign-out, or sign-in after sign-out) must not see cached data from the previous session.
      if (shouldClearCache(previousUser, nextUser)) queryClient.clear();
      if (isUserSwitch(previousUser, nextUser)) {
        window.location.reload();
        return;
      }
      setSession(effective);
      setAal({ current: 'aal2', next: 'aal2' });
    };
    void supabase.auth.getSession().then(({ data }) => applySession(data.session));
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      applySession(next);
    });
    return () => data.subscription.unsubscribe();
  }, [queryClient]);

  useEffect(() => {
    if (session) void refreshAal();
    else setAal(undefined);
  }, [session, refreshAal]);

  const signOut = useCallback(
    async (scope: 'local' | 'others' | 'global' = 'local') => {
      await getSupabase().auth.signOut({ scope });
      if (scope === 'others') return;
      setRecovering(false);
      // Start the next session from a clean page. Some screens keep their own copy of the previous user's data
      // outside the query cache, and only a full load is sure to drop all of it.
      setAuthToken(undefined);
      queryClient.clear();
      window.location.replace('/login');
    },
    [queryClient],
  );

  return (
    <AuthContext.Provider value={{ session, aal, recovering, refreshAal, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

export function useOptionalAuth(): AuthState | null {
  return useContext(AuthContext);
}

