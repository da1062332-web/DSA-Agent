// The only place that decides whether the DISABLE_MFA development switch is honoured (owner: Dev 1; SUB-AUTH.02).
// MFA is mandatory for admin, owner, branch manager, loan ops, verifier, compliance, finance, rule roles, auditors and the platform
// realm. The switch exists so a developer can work against a LOCAL Supabase stack and a local or approved test database without an
// authenticator app. It is honoured only when ALL of these hold: the process is not in production, SUPABASE_URL points at the local
// machine, and DATABASE_URL is local or listed in TEST_DATABASE_HOSTS. Anywhere else the variable is ignored (MFA stays on), and
// loadConfig refuses to start the API with the variable set there, so it cannot be left on by accident.
import { isLocalUrl } from '@dsa/kernel';
import { isApprovedTestDatabase } from '../test-auth';

/** Where skipping MFA is acceptable at all: not production, a local Supabase stack, and a local or approved test database. */
export function mfaMayBeDisabledHere(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env.NODE_ENV !== 'production' &&
    isLocalUrl(env.SUPABASE_URL) &&
    isApprovedTestDatabase(env.DATABASE_URL, env.TEST_DATABASE_HOSTS)
  );
}

/** True only when a developer asked for it AND this is a place where that is allowed. Never true in production or against hosted. */
export function mfaDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DISABLE_MFA === 'true' && mfaMayBeDisabledHere(env);
}
