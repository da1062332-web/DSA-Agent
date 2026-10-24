// Supabase client (owner: Dev 1, UI-PLT-001). Used for auth.* only — all data goes through the Express API
// (Contracts §14). Holds the publishable key only; supabase-js keeps the session and refreshes the token.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readConfig } from '../config';

let client: SupabaseClient | undefined;
let storageClient: SupabaseClient | undefined;

/** App.tsx renders ConfigError instead of the app when the config is invalid, so this never throws in practice. */
export function getSupabase(): SupabaseClient {
  if (!client) {
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

export function saveBypassSession(session: unknown): void {
  const key = getStorageKey();
  try {
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem('dsa_bypass_active', 'true');
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('dsa_bypass_active', 'true');
      localStorage.setItem(key, JSON.stringify(session));
    }
  } catch {
    // Storage might be blocked
  }
}

export function isBypassActive(): boolean {
  try {
    if (
      (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('dsa_bypass_active') === 'true') ||
      (typeof localStorage !== 'undefined' && localStorage.getItem('dsa_bypass_active') === 'true')
    ) {
      return true;
    }
    if (typeof localStorage !== 'undefined') {
      const key = getStorageKey();
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.refresh_token === 'bypass-refresh-token') {
          return true;
        }
      }
    }
  } catch {
    // Storage might be blocked or unparseable
  }
  return false;
}
