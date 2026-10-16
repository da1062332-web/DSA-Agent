// Access token for the features that call the API outside TanStack Query (messaging, notifications, activities).
// The token is owned by Supabase Auth and kept current by AuthProvider; it is never read from or written to
// localStorage, so a stale or hand-edited copy cannot be used.
let currentToken: string | undefined;

export function setAuthToken(token: string | undefined): void {
  currentToken = token;
}

export function getStoredAuthToken(): string | undefined {
  if (currentToken) return currentToken;
  if (typeof window === 'undefined') return undefined;
  try {
    const sess = typeof window.sessionStorage !== 'undefined' ? window.sessionStorage.getItem('dsa_auth_token') : null;
    const loc = typeof window.localStorage !== 'undefined' ? window.localStorage.getItem('dsa_auth_token') : null;
    const direct = sess || loc;
    if (direct) return direct;
  } catch {
    // Storage access restricted or unavailable
  }
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('sb-') || key.includes('auth-token'))) {
        const val = localStorage.getItem(key);
        if (val) {
          const parsed = JSON.parse(val) as { access_token?: string };
          if (parsed?.access_token) return parsed.access_token;
        }
      }
    }
  } catch {
    // Ignore JSON parse error
  }
  return undefined;
}
