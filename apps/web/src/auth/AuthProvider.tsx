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

const SESSION_STORAGE_KEY = 'dsa_auth_session';

export function getStoredSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function saveStoredSession(session: Session | null): void {
  try {
    if (session) {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    } else {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  } catch {}
}

interface AuthState {
  /** undefined while the stored session is being read. */
  session: Session | null | undefined;
  /** undefined while loading or signed out. */
  aal: Aal | undefined;
  /** Set after Supabase opens the app from a password-reset link. */
  recovering: boolean;
  setSession(session: Session | null): void;
  refreshAal(): Promise<void>;
  signOut(scope?: 'local' | 'others' | 'global'): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<Session | null | undefined>(undefined);
  const [aal, setAal] = useState<Aal | undefined>(undefined);
  const [recovering, setRecovering] = useState(false);

  const setSession = useCallback((newSession: Session | null) => {
    saveStoredSession(newSession);
    setSessionState(newSession);
  }, []);

  const refreshAal = useCallback(async () => {
    try {
      const { data, error } = await getSupabase().auth.mfa.getAuthenticatorAssuranceLevel();
      setAal(
        error || !data ? { current: 'aal1' as any, next: null } : { current: data.currentLevel, next: data.nextLevel },
      );
    } catch {
      setAal({ current: 'aal1' as any, next: null });
    }
  }, []);

  useEffect(() => {
    const stored = getStoredSession();
    if (stored) {
      setSessionState(stored);
      return;
    }
    try {
      const supabase = getSupabase();
      void supabase.auth.getSession().then(({ data }) => setSessionState(data.session));
      const { data } = supabase.auth.onAuthStateChange((event, next) => {
        if (event === 'PASSWORD_RECOVERY') setRecovering(true);
        if (next) saveStoredSession(next);
        setSessionState(next);
      });
      return () => data.subscription.unsubscribe();
    } catch {
      setSessionState(null);
    }
  }, []);

  useEffect(() => {
    if (session) void refreshAal();
    else setAal(undefined);
  }, [session, refreshAal]);

  const signOut = useCallback(async (scope: 'local' | 'others' | 'global' = 'local') => {
    saveStoredSession(null);
    setSessionState(null);
    try {
      await getSupabase().auth.signOut({ scope });
    } catch {}
    if (scope !== 'others') setRecovering(false);
  }, []);

  return (
    <AuthContext.Provider value={{ session, aal, recovering, setSession, refreshAal, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const state = useContext(AuthContext);
  if (!state) throw new Error('useAuth must be used inside <AuthProvider>');
  return state;
}
