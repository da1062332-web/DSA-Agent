// apps/web/src/auth/auth-config.ts
// Whether this deployment asks for a second factor (SUPABASE_MFA_ENABLED on the API). The web app reads it from the API rather than from
// its own build, so the sign-in screens and the API cannot disagree about it. The answer is read once per page load.
import { useEffect, useState } from 'react';
import { readConfig } from '../config';

export interface AuthConfig {
  mfaEnabled: boolean;
}

let loaded: AuthConfig | null = null;
let pending: Promise<AuthConfig> | null = null;

export function parseAuthConfig(body: unknown): AuthConfig | null {
  if (typeof body !== 'object' || body === null) return null;
  const mfaEnabled = (body as { mfaEnabled?: unknown }).mfaEnabled;
  return typeof mfaEnabled === 'boolean' ? { mfaEnabled } : null;
}

function authConfigUrl(): string {
  const config = readConfig();
  const baseUrl = config.success ? config.data.VITE_API_BASE_URL : '';
  return baseUrl ? `${baseUrl}/public/v1/auth/config` : '/public/v1/auth/config';
}

/**
 * The setting for this page load. It rejects when the API cannot say. Callers then sign nobody in, so the app fails closed.
 */
export function loadAuthConfig(fetchFn: typeof fetch = fetch): Promise<AuthConfig> {
  if (loaded) return Promise.resolve(loaded);
  pending ??= fetchFn(authConfigUrl(), { headers: { Accept: 'application/json' } })
    .then(async (res) => {
      if (!res.ok) throw new Error(`auth config ${res.status}`);
      const parsed = parseAuthConfig(await res.json());
      if (!parsed) throw new Error('auth config malformed');
      loaded = parsed;
      return parsed;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

/** The setting if it is already known for this page load, else null. Does not start a request. */
export function authConfigSnapshot(): AuthConfig | null {
  return loaded;
}

/** For tests: forget the answer, so the next load asks the API again. */
export function resetAuthConfigCache(): void {
  loaded = null;
  pending = null;
}

/** The setting once it is known, else null. The hook starts the load on first use. */
export function useAuthConfig(): AuthConfig | null {
  const [config, setConfig] = useState<AuthConfig | null>(loaded);
  useEffect(() => {
    if (config) return;
    let alive = true;
    loadAuthConfig().then(
      (c) => {
        if (alive) setConfig(c);
      },
      () => {
        // Unknown: the shell keeps the second step on, and the sign-in screen does not sign anyone in.
      },
    );
    return () => {
      alive = false;
    };
  }, [config]);
  return config;
}
