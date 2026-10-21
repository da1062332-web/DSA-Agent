// The current access token, kept by AuthProvider. API calls go through api/client.ts, which reads the Supabase session itself;
// this copy is for code that needs the token synchronously.
// The token is owned by Supabase Auth and kept current by AuthProvider; it is never read from or written to
// localStorage, so a stale or hand-edited copy cannot be used.
let currentToken: string | undefined;

export function setAuthToken(token: string | undefined): void {
  currentToken = token;
}

export function getStoredAuthToken(): string | undefined {
  return currentToken;
}
