// The only place that decides whether the DISABLE_MFA development switch is honoured (owner: Dev 1; SUB-AUTH.02).
// MFA is mandatory for admin, owner, branch manager, loan ops, verifier, compliance, finance, rule roles, auditors and the platform
// realm. The switch exists so a developer can work against a LOCAL Supabase stack without an authenticator app. It is honoured only when
// BOTH hold: the process is not in production, and SUPABASE_URL points at the local machine. Anywhere else the variable is ignored
// (MFA stays on), and loadConfig refuses to start the API with the variable set there, so it cannot be left on by accident.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function isLocalSupabaseUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return LOCAL_HOSTS.has(host) || host.endsWith('.localhost');
  } catch {
    return false;
  }
}

/** Where skipping MFA is acceptable at all: not production, and a local Supabase stack. */
export function mfaMayBeDisabledHere(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== 'production' && isLocalSupabaseUrl(env.SUPABASE_URL);
}

/** True only when a developer asked for it AND this is a place where that is allowed. Never true in production or against hosted. */
export function mfaDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DISABLE_MFA === 'true' && mfaMayBeDisabledHere(env);
}
