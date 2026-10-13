// Test tokens — owner: Dev 1 — TASK-102. Supabase-shaped HS256 access tokens signed with the LOCAL
// SUPABASE_JWT_SECRET, for tests and the E2E harness only. Refuses any non-local SUPABASE_URL (Contracts §7).
import { SignJWT } from 'jose';
import { ACCESS_TOKEN_AUDIENCE } from '../auth/verify-token';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

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
  const host = new URL(opts.supabaseUrl).hostname;
  if (!LOCAL_HOSTS.has(host) && !host.endsWith('.localhost')) {
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
