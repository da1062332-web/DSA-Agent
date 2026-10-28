// Test tokens — owner: Dev 1 — TASK-102. Supabase-shaped HS256 access tokens signed with the LOCAL
// SUPABASE_JWT_SECRET, for tests and the E2E harness only. Refuses any non-local SUPABASE_URL (Contracts §7).
import { SignJWT } from 'jose';
import { ACCESS_TOKEN_AUDIENCE, isLocalUrl } from '../auth/verify-token';

export interface TestTokenOptions {
  supabaseUrl: string;
  jwtSecret: string;
  /** Supabase Auth user id; must equal app_user.idp_subject of an ACTIVE user in the tenant. */
  sub: string;
  tenantId: string;
  /** aal2 adds a TOTP amr entry at `now`, which satisfies step-up for 900 s. */
  aal?: 'aal1' | 'aal2';
  ttlSeconds?: number;
  now?: Date;
}

export async function mintTestToken(opts: TestTokenOptions): Promise<string> {
  if (!isLocalUrl(opts.supabaseUrl)) {
    throw new Error('test tokens are allowed only against the local Supabase stack (Contracts §7)');
  }
  const iat = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  const aal = opts.aal ?? 'aal1';
  const amr = [{ method: 'password', timestamp: iat }];
  if (aal === 'aal2') amr.push({ method: 'totp', timestamp: iat });

  return new SignJWT({ role: 'authenticated', aal, amr, app_metadata: { tenant_id: opts.tenantId } })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(`${opts.supabaseUrl.replace(/\/+$/, '')}/auth/v1`)
    .setAudience(ACCESS_TOKEN_AUDIENCE)
    .setSubject(opts.sub)
    .setIssuedAt(iat)
    .setExpirationTime(iat + (opts.ttlSeconds ?? 3600))
    .sign(new TextEncoder().encode(opts.jwtSecret));
}

export interface BypassTokenOptions {
  supabaseUrl: string;
  secret: string;
  sub: string;
  tenantId: string;
  email?: string;
  aal?: 'aal1' | 'aal2';
  ttlSeconds?: number;
  now?: Date;
}

/**
 * Mint a test bypass access token signed with the provided HMAC secret.
 * Suitable for testing/QA login bypass with aal2 MFA pre-satisfied. Refuses any SUPABASE_URL that is not the local stack.
 */
export async function mintBypassToken(opts: BypassTokenOptions): Promise<string> {
  if (!isLocalUrl(opts.supabaseUrl)) {
    throw new Error('test bypass tokens are allowed only against the local Supabase stack (Contracts §7)');
  }
  const iat = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  const aal = opts.aal ?? 'aal2';
  const amr = [{ method: 'password', timestamp: iat }];
  if (aal === 'aal2') amr.push({ method: 'totp', timestamp: iat });

  const issuer = `${opts.supabaseUrl.replace(/\/+$/, '')}/auth/v1`;

  return new SignJWT({
    role: 'authenticated',
    aal,
    amr,
    email: opts.email,
    app_metadata: { tenant_id: opts.tenantId },
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(issuer)
    .setAudience(ACCESS_TOKEN_AUDIENCE)
    .setSubject(opts.sub)
    .setIssuedAt(iat)
    .setExpirationTime(iat + (opts.ttlSeconds ?? 86400))
    .sign(new TextEncoder().encode(opts.secret));
}

