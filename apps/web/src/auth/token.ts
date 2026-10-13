// Utility to retrieve the active JWT access token across storage formats
export function getStoredAuthToken(): string | undefined {
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
    const raw = typeof window.localStorage !== 'undefined' ? window.localStorage.getItem('dsa_auth_session') : null;
    if (raw) {
      const parsed = JSON.parse(raw) as { access_token?: string };
      if (parsed?.access_token) return parsed.access_token;
    }
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
