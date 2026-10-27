// Supabase client (owner: Dev 1, UI-PLT-001). Used for auth.* only — all data goes through the Express API
// (Contracts §14). Holds the publishable key only; supabase-js keeps the session and refreshes the token.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readConfig } from '../config';
import { BYPASS_FLAG, BYPASS_REFRESH_TOKEN, testAuthEnabled } from './test-auth';

let client: SupabaseClient | undefined;
let storageClient: SupabaseClient | undefined;

/** Removes a test sign-in left in this browser. It runs before the client is created, so Supabase never loads that session. */
function clearTestSignIn(): void {
  try {
    sessionStorage.removeItem(BYPASS_FLAG);
    localStorage.removeItem(BYPASS_FLAG);
    const key = getStorageKey();
    const raw = localStorage.getItem(key);
    if (raw && JSON.parse(raw)?.refresh_token === BYPASS_REFRESH_TOKEN) localStorage.removeItem(key);
  } catch {
    // Storage might be blocked or unparseable
  }
}

/** App.tsx renders ConfigError instead of the app when the config is invalid, so this never throws in practice. */
export function getSupabase(): SupabaseClient {
  if (!client) {
    if (!testAuthEnabled()) clearTestSignIn();
    const config = readConfig();
    if (!config.success) throw new Error('Web configuration is invalid.');
    client = createClient(config.data.VITE_SUPABASE_URL, config.data.VITE_SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
  }
  return client;
}

/**
 * Storage client that ensures storage calls are never rejected by local test/bypass tokens.
 * When local development bypass session is active, uses an unpersisted client with the valid anon key,
 * preventing Supabase Storage 400 signature verification failures.
 */
export function getSupabaseStorageClient(): SupabaseClient {
  if (isBypassActive()) {
    if (!storageClient) {
      const config = readConfig();
      if (!config.success) throw new Error('Web configuration is invalid.');
      storageClient = createClient(config.data.VITE_SUPABASE_URL, config.data.VITE_SUPABASE_PUBLISHABLE_KEY, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
          storageKey: 'sb-isolated-storage-token',
        },
      });
    }
    return storageClient;
  }
  return getSupabase();
}

export function getStorageKey(): string {
  const config = readConfig();
  if (!config.success) return 'sb-auth-token';
  try {
    const host = new URL(config.data.VITE_SUPABASE_URL).hostname;
    return `sb-${host.split('.')[0]}-auth-token`;
  } catch {
    return 'sb-auth-token';
  }
}

/** Stores a test sign-in. Refused outside a test build, so no other build can hold one. */
export function saveBypassSession(session: unknown): void {
  if (!testAuthEnabled()) throw new Error('Test sign-in is not available in this build.');
  const key = getStorageKey();
  try {
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(BYPASS_FLAG, 'true');
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(BYPASS_FLAG, 'true');
      localStorage.setItem(key, JSON.stringify(session));
    }
  } catch {
    // Storage might be blocked
  }
}

/** True only in a test build with a test sign-in in this browser. Always false in other builds. */
export function isBypassActive(): boolean {
  return testAuthEnabled() && hasTestSignIn();
}

/** True when this browser holds a test sign-in. Reached only through isBypassActive, so a production build drops it. */
function hasTestSignIn(): boolean {
  try {
    if (
      (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(BYPASS_FLAG) === 'true') ||
      (typeof localStorage !== 'undefined' && localStorage.getItem(BYPASS_FLAG) === 'true')
    ) {
      return true;
    }
    if (typeof localStorage !== 'undefined') {
      const key = getStorageKey();
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.refresh_token === BYPASS_REFRESH_TOKEN) {
          return true;
        }
      }
    }
  } catch {
    // Storage might be blocked or unparseable
  }
  return false;
}
