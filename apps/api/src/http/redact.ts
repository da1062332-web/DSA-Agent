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

/**
 * Upload and download links carry a bearer token in the path: the upload intent token (/document-uploads/), a signed file link
 * (/document-files/), and the public upload link (/upload/). Logs keep the route and drop the token. The query string is dropped too.
 */
const LINK_TOKEN_PATH = /\/(document-uploads|document-files|upload)\/[^/?#]+/g;

export function redactRequestPath(url: string): string {
  return url.split('?')[0]!.replace(LINK_TOKEN_PATH, (_match, route: string) => `/${route}/[redacted]`);
}

/**
 * Identity data (S3) that must never reach a log or an error response (task P1-01). PAN keeps its first five letters and its last
 * letter, so `ABCDE1234F` becomes `ABCDE****F`. An Aadhaar-shaped number keeps only its last four digits. A date of birth is hidden
 * when it follows a dob-style key (dob, date of birth, dateOfBirth, date_of_birth, date-of-birth), either with `=` or `:`, or with a
 * space and a numeric date. A bare date with no key is not identity data on its own and is left alone.
 */
const DOB_KEY = 'dob|date[\\s_-]?of[\\s_-]?birth';
const PII_SHAPES: Array<[RegExp, string]> = [
  [/\b([A-Z]{5})[0-9]{4}([A-Z])\b/gi, '$1****$2'],
  [/\b\d{4}[\s-]?\d{4}[\s-]?(\d{4})\b/g, '**** **** $1'],
  [new RegExp(`\\b(${DOB_KEY})(\\s*[=:]\\s*)["']?[^\\s&;,'"]+`, 'gi'), '$1$2[redacted]'],
  // The spaced form: the key, a space, then a date shaped like 01/01/1990, 1990-01-01 or 01.01.90.
  [new RegExp(`\\b(${DOB_KEY})(\\s+)["']?\\d{1,4}[-/.]\\d{1,2}[-/.]\\d{1,4}\\b`, 'gi'), '$1$2[redacted]'],
];

/**
 * A PAN in text as ABCDE****F, and the PAN inside a GSTIN as 27ABCDE****F1Z5 (GSTIN characters 3 to 12 are the holder's PAN). The
 * vendor call-log redactor uses this, so the PAN mask is written once.
 */
export function maskPanText(text: string): string {
  return text
    .replace(/\b(\d{2}[A-Z]{5})\d{4}([A-Z][1-9A-Z]Z[0-9A-Z])\b/g, '$1****$2')
    .replace(/\b([A-Z]{5})\d{4}([A-Z])\b/g, '$1****$2');
}

/** The text with every registered secret, every credential-shaped part and every identity-data pattern replaced. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const secret of [...registered].sort((a, b) => b.length - a.length)) {
    out = out.split(secret).join('[redacted]');
  }
  for (const [pattern, replacement] of SHAPES) {
    out = out.replace(pattern, replacement);
  }
  for (const [pattern, replacement] of PII_SHAPES) {
    out = out.replace(pattern, replacement);
  }
  return out;
}
