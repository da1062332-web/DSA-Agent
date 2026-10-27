// Keeps credentials out of error responses and logs (owner: Dev 1). Every secret the process registers at startup (the database URL and
// its password, the JWT and signing secrets) is replaced wherever it appears. Text shaped like a credential (a URL with a login, a
// key=value secret, a bearer token, a JWT) is masked even when nothing was registered, for example a driver message about a URL this
// process never loaded.

const registered = new Set<string>();

/** Values that must never reach a response or a log. Short values are skipped: masking them would hide ordinary words. */
export function registerSecrets(values: Array<string | undefined>): void {
  for (const value of values) {
    if (value && value.length >= 8) registered.add(value);
  }
}

/** Registers a database URL together with its password, as written and decoded. */
export function registerDatabaseUrl(databaseUrl: string): void {
  registerSecrets([databaseUrl]);
  try {
    const { password } = new URL(databaseUrl);
    registerSecrets([password, safeDecode(password)]);
  } catch {
    // Not parseable as a URL: the whole string is registered above.
  }
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

const SHAPES: Array<[RegExp, string]> = [
  // scheme://login@host: keep the scheme and host, drop the login
  [/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1[redacted]@'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]'],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted-jwt]'],
  // password=..., token: ..., apikey=... in text or in a query string
  [/\b(password|passwd|pwd|secret|token|api[_-]?key|authorization)(\s*[=:]\s*)[^\s&;,'"]+/gi, '$1$2[redacted]'],
];

/** The text with every registered secret and every credential-shaped part replaced. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const secret of [...registered].sort((a, b) => b.length - a.length)) {
    out = out.split(secret).join('[redacted]');
  }
  for (const [pattern, replacement] of SHAPES) {
    out = out.replace(pattern, replacement);
  }
  return out;
}
