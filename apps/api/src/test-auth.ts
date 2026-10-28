// Test login (owner: Dev 1). A fixed one-time code (TEST_BYPASS_OTP, 000000 by default) signs a person in without a password or an
// authenticator app. It exists for automated tests and for local development against an isolated database, and it is off everywhere
// else. The API serves it only when TEST_AUTH_ENABLED=true and every check here passes. loadConfig refuses to start otherwise, so a
// shared or production configuration cannot switch it on by accident.
import { isLocalUrl } from '@dsa/kernel';

/** The hosted project's reference. It is never a test target, whatever the URL, host or database login says. */
const SHARED_PROJECT_REF = 'mlpkwwhnagxzinaohdxg';
/** Secrets published in this repository. A test secret must never be one of them. */
const PUBLISHED_SECRETS = new Set(['dsa-crm-test-bypass-jwt-secret-key-2026']);
const MIN_SECRET_LENGTH = 32;

/** The settings the checks read. Messages name them; they never print a value. */
export interface TestAuthSettings {
  NODE_ENV?: string;
  SUPABASE_URL?: string;
  DATABASE_URL?: string;
  /** Hosts of isolated test databases the developer approved, comma-separated. Local hosts need no entry. */
  TEST_DATABASE_HOSTS?: string;
  SUPABASE_JWT_SECRET?: string;
  BYPASS_JWT_SECRET?: string;
}

export interface TestAuthConfig {
  /** The local Supabase stack. Test tokens carry this issuer and are accepted only against it. */
  supabaseUrl: string;
  /** Signs and verifies test tokens. Never the project's JWT secret. */
  secret: string;
  /** The fixed one-time code. */
  otp: string;
}

function decodeLogin(login: string): string {
  try {
    return decodeURIComponent(login).toLowerCase();
  } catch {
    return login.toLowerCase();
  }
}

/**
 * True when the database is on this machine, or on a host the developer approved for an isolated test database.
 * The shared project is refused even when its host is listed.
 */
export function isApprovedTestDatabase(databaseUrl: string | undefined, approvedHosts: string | undefined): boolean {
  if (!databaseUrl) return false;
  let host: string;
  let login: string;
  try {
    const url = new URL(databaseUrl);
    host = url.hostname.toLowerCase();
    login = decodeLogin(url.username);
  } catch {
    return false;
  }
  if (!host) return false;
  if (host.includes(SHARED_PROJECT_REF) || login.includes(SHARED_PROJECT_REF)) return false;
  if (isLocalUrl(databaseUrl)) return true;
  return approvedHosts
    ? approvedHosts
        .split(',')
        .map((h) => h.trim().toLowerCase())
        .includes(host)
    : false;
}

/** The problems that make test login unsafe in this configuration. Empty when it may be on. */
export function testAuthProblems(env: TestAuthSettings): string[] {
  const problems: string[] = [];
  if (env.NODE_ENV === 'production') problems.push('NODE_ENV must not be production');
  if (!isLocalUrl(env.SUPABASE_URL)) {
    problems.push('SUPABASE_URL must point at the local Supabase stack (localhost or 127.0.0.1)');
  }
  if (!isApprovedTestDatabase(env.DATABASE_URL, env.TEST_DATABASE_HOSTS)) {
    problems.push(
      'DATABASE_URL must point at a local database or at a host listed in TEST_DATABASE_HOSTS, and never at the shared project',
    );
  }
  const secret = env.BYPASS_JWT_SECRET ?? '';
  if (secret.length < MIN_SECRET_LENGTH || PUBLISHED_SECRETS.has(secret) || secret === env.SUPABASE_JWT_SECRET) {
    problems.push(
      `BYPASS_JWT_SECRET must be set, unique, at least ${MIN_SECRET_LENGTH} characters, and different from SUPABASE_JWT_SECRET`,
    );
  }
  return problems;
}

/**
 * The test-login settings when test login is on, undefined when it is off. Throws, naming the settings, when it is on but unsafe.
 * server.ts is the only caller: the result goes to createApp (the routes) and to the token verifier (the test secret).
 */
export function resolveTestAuth(
  env: TestAuthSettings & { TEST_AUTH_ENABLED: boolean; TEST_BYPASS_OTP: string; SUPABASE_URL: string },
): TestAuthConfig | undefined {
  if (!env.TEST_AUTH_ENABLED) return undefined;
  const problems = testAuthProblems(env);
  if (problems.length > 0 || env.BYPASS_JWT_SECRET === undefined) {
    throw new Error(`Test login is refused:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  }
  return { supabaseUrl: env.SUPABASE_URL, secret: env.BYPASS_JWT_SECRET, otp: env.TEST_BYPASS_OTP };
}
