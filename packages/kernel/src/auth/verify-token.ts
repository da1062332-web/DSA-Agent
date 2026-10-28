// Supabase access-token verification — owner: Dev 1 — TASK-102.
// Asymmetric tokens (ES256/RS256) are checked against <SUPABASE_URL>/auth/v1/.well-known/jwks.json.
// HS256 tokens are accepted only with the legacy SUPABASE_JWT_SECRET, or with the test bypass secret against the local stack.
// The tenant comes only from app_metadata.tenant_id; app_metadata is writable by the service role only.
import { AppError } from '@dsa/contracts';
import {
  createRemoteJWKSet,
  decodeProtectedHeader,
  errors,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';

export const ACCESS_TOKEN_AUDIENCE = 'authenticated';
const TENANT_ID = /^ten_[0-9A-Za-z_-]+$/;

export interface VerifiedToken {
  /** Supabase Auth user id (`sub`); matches app_user.idp_subject. */
  subject: string;
  tenantId: string;
  aal: 'aal1' | 'aal2';
  /** Time of the most recent TOTP verification when aal = aal2, else null. Drives step-up (Contracts §7). */
  mfaVerifiedAt: Date | null;
  /** The `email` claim, matched against app users. */
  email?: string | null;
  /** How this session was signed in, from the token's `amr` claim, e.g. "password", "otp" or "totp". Empty when unknown. */
  authMethods?: string[];
}

export interface TokenVerifier {
  verify(token: string): Promise<VerifiedToken>;
}

export interface TokenVerifierOptions {
  supabaseUrl: string;
  /** Legacy HS256 secret. Leave unset for hosted projects that sign with asymmetric keys. */
  jwtSecret?: string;
  /** Secret for test bypass tokens. Honoured only when supabaseUrl is the local Supabase stack. */
  bypassSecret?: string;
  /** Override the JWKS source (tests). */
  jwks?: JWTVerifyGetKey;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** True for the local Supabase stack (localhost, 127.0.0.1, ::1). Test tokens are minted and accepted only against it. */
export function isLocalUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return LOCAL_HOSTS.has(host) || host.endsWith('.localhost');
  } catch {
    return false;
  }
}

const issuerOf = (supabaseUrl: string) => `${supabaseUrl.replace(/\/+$/, '')}/auth/v1`;

/** The `iss` values accepted for a project. The local stack answers on either spelling of its host, so both are accepted there. */
function allowedIssuersFor(supabaseUrl: string): string[] {
  const issuers = [issuerOf(supabaseUrl)];
  if (isLocalUrl(supabaseUrl)) {
    const url = new URL(supabaseUrl);
    for (const hostname of ['127.0.0.1', 'localhost']) {
      url.hostname = hostname;
      issuers.push(issuerOf(url.toString()));
    }
  }
  return Array.from(new Set(issuers));
}

export function createTokenVerifier(opts: TokenVerifierOptions): TokenVerifier {
  const issuer = issuerOf(opts.supabaseUrl);
  const allowedIssuers = allowedIssuersFor(opts.supabaseUrl);
  const jwks = opts.jwks ?? createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  const secret = opts.jwtSecret ? new TextEncoder().encode(opts.jwtSecret) : undefined;
  // Test tokens are honoured only against the local stack: any other project has no test secret at all.
  const bypassSecret =
    opts.bypassSecret && isLocalUrl(opts.supabaseUrl) ? new TextEncoder().encode(opts.bypassSecret) : undefined;

  return {
    async verify(token) {
      let payload!: JWTPayload;
      try {
        const { alg } = decodeProtectedHeader(token);
        const options = { issuer: allowedIssuers, audience: ACCESS_TOKEN_AUDIENCE };
        if (alg === 'HS256') {
          const secrets: Uint8Array[] = [];
          if (secret) secrets.push(secret);
          if (bypassSecret) secrets.push(bypassSecret);

          let verified = false;
          let lastErr: unknown;
          for (const s of secrets) {
            try {
              ({ payload } = await jwtVerify(token, s, { ...options, algorithms: ['HS256'] }));
              verified = true;
              break;
            } catch (e) {
              lastErr = e;
            }
          }
          if (!verified) {
            if (lastErr instanceof errors.JWTExpired) throw AppError.of('TOKEN_EXPIRED', 'Access token has expired.');
            throw unauthenticated();
          }
        } else {
          ({ payload } = await jwtVerify(token, jwks, { ...options, algorithms: ['ES256', 'RS256'] }));
        }
      } catch (err) {
        if (err instanceof errors.JWTExpired) throw AppError.of('TOKEN_EXPIRED', 'Access token has expired.');
        if (err instanceof AppError) throw err;
        throw unauthenticated();
      }
      return readClaims(payload);
    },
  };
}

function readClaims(payload: JWTPayload): VerifiedToken {
  const appMetadata = payload.app_metadata as { tenant_id?: unknown } | undefined;
  const tenantId = appMetadata?.tenant_id;
  if (!payload.sub || typeof tenantId !== 'string' || !TENANT_ID.test(tenantId)) throw unauthenticated();

  const aal = payload.aal === 'aal2' ? 'aal2' : 'aal1';
  return {
    subject: payload.sub,
    tenantId,
    aal,
    mfaVerifiedAt: aal === 'aal2' ? latestTotp(payload.amr) : null,
    email: typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : null,
    authMethods: amrMethods(payload.amr),
  };
}

/** The methods the session was signed in with, e.g. ['password'] or ['otp']. Anything that is not a method name is ignored. */
function amrMethods(amr: unknown): string[] {
  if (!Array.isArray(amr)) return [];
  return amr
    .map((e) => (e && typeof e === 'object' ? (e as { method?: unknown }).method : undefined))
    .filter((m): m is string => typeof m === 'string');
}

/** Supabase puts `amr: [{ method: 'totp', timestamp: <unix s> }, …]` on the access token. */
function latestTotp(amr: unknown): Date | null {
  if (!Array.isArray(amr)) return null;
  const times = amr
    .filter((e): e is { method: string; timestamp: number } => typeof e?.timestamp === 'number')
    .filter((e) => e.method === 'totp')
    .map((e) => e.timestamp);
  return times.length ? new Date(Math.max(...times) * 1000) : null;
}

const unauthenticated = () => AppError.of('UNAUTHENTICATED', 'Missing or invalid access token.');
