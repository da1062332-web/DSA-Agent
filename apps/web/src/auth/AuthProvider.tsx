// Session state for the app (owner: Dev 1, UI-PLT-001). The Supabase session is the only source of truth;
// nothing is copied to localStorage or sessionStorage by hand. `aal` says whether this session has passed TOTP
// (currentLevel aal2) and whether the user has a verified factor (nextLevel aal2).
import type { AuthenticatorAssuranceLevels, Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { getSupabase } from './supabase';

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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [aal, setAal] = useState<Aal | undefined>(undefined);
  const [recovering, setRecovering] = useState(false);

  const refreshAal = useCallback(async () => {
    const { data, error } = await getSupabase().auth.mfa.getAuthenticatorAssuranceLevel();
    // On error the guard treats the session as aal1 with no factor; the API still enforces step-up itself.
    setAal(
      error || !data ? { current: null, next: null } : { current: data.currentLevel, next: data.nextLevel },
    );
  }, []);

  useEffect(() => {
    const supabase = getSupabase();
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      setSession(next);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session) void refreshAal();
    else setAal(undefined);
  }, [session, refreshAal]);

  const signOut = useCallback(async (scope: 'local' | 'others' | 'global' = 'local') => {
    await getSupabase().auth.signOut({ scope });
    if (scope !== 'others') setRecovering(false);
  }, []);

  return (
    <AuthContext.Provider value={{ session, aal, recovering, refreshAal, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const state = useContext(AuthContext);
  if (!state) throw new Error('useAuth must be used inside <AuthProvider>');
  return state;
}
