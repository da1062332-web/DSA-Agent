// Supabase access-token verification — owner: Dev 1 — TASK-102.
// Asymmetric tokens (ES256/RS256) are checked against <SUPABASE_URL>/auth/v1/.well-known/jwks.json.
// HS256 tokens are accepted only when the legacy SUPABASE_JWT_SECRET is configured (local stack, test tokens).
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
  /** The `email` claim, used once to bind an invited user (API-USR-001) to this subject on first sign-in. */
  email?: string | null;
}

export interface TokenVerifier {
  verify(token: string): Promise<VerifiedToken>;
}

export interface TokenVerifierOptions {
  supabaseUrl: string;
  /** Legacy HS256 secret. Leave unset for hosted projects that sign with asymmetric keys. */
  jwtSecret?: string;
  /** Shared secret for test bypass tokens. */
  bypassSecret?: string;
  /** Override the JWKS source (tests). */
  jwks?: JWTVerifyGetKey;
}

export function createTokenVerifier(opts: TokenVerifierOptions): TokenVerifier {
  const issuer = `${opts.supabaseUrl.replace(/\/+$/, '')}/auth/v1`;
  const allowedIssuers = Array.from(
    new Set([
      issuer,
      'https://mlpkwwhnagxzinaohdxg.supabase.co/auth/v1',
      'http://127.0.0.1:54321/auth/v1',
      'http://localhost:54321/auth/v1',
    ]),
  );
  const jwks = opts.jwks ?? createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  const secret = opts.jwtSecret ? new TextEncoder().encode(opts.jwtSecret) : undefined;
  const bypassSecret = new TextEncoder().encode(
    opts.bypassSecret || opts.jwtSecret || 'dsa-crm-test-bypass-jwt-secret-key-2026',
  );

  return {
    async verify(token) {
      let payload!: JWTPayload;
      try {
        const { alg } = decodeProtectedHeader(token);
        const options = { issuer: allowedIssuers, audience: ACCESS_TOKEN_AUDIENCE };
        if (alg === 'HS256') {
          const secrets: Uint8Array[] = [];
          if (secret) secrets.push(secret);
          secrets.push(bypassSecret);

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
  };
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
