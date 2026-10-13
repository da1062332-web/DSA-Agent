// Utility to retrieve the active JWT access token across storage formats
export function getStoredAuthToken(): string | undefined {
  const direct = sessionStorage.getItem('dsa_auth_token') || localStorage.getItem('dsa_auth_token');
  if (direct) return direct;
  try {
    const raw = localStorage.getItem('dsa_auth_session');
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
