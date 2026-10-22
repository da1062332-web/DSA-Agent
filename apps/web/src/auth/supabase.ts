// Supabase client (owner: Dev 1, UI-PLT-001). Used for auth.* only — all data goes through the Express API
// (Contracts §14). Holds the publishable key only; supabase-js keeps the session and refreshes the token.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readConfig } from '../config';

let client: SupabaseClient | undefined;

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
    localStorage.setItem(key, JSON.stringify(session));
  } catch {
    // Storage might be blocked
  }
}
