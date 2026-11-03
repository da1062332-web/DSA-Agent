// apps/web/src/auth/mfa-flow.ts
// The second-factor decisions for the sign-in screen and the app shell, as pure functions of the project setting and the session.
// Nothing here calls Supabase or the API. The setting comes from GET /public/v1/auth/config (see auth-config.ts), so the screens and the
// API read the same answer.
import type { AuthConfig } from './auth-config';

// The assurance level from the auth library ('aal1', 'aal2', or none yet). Only 'aal2' means the second factor has passed.
export type Aal = string | null | undefined;

/** Whether a correct password completes the sign-in on its own. True only when the project has second factors off. */
export function signInFinishesWithoutCode(mfaEnabled: boolean): boolean {
  return !mfaEnabled;
}

/**
 * Whether the second-factor dialog may open. Never when second factors are off for the project, and never before the setting is known:
 * the page waits for the answer rather than guess.
 */
export function secondFactorDialogAllowed(input: {
  session: boolean;
  mfaEnabled: boolean | null;
  aal: Aal;
  developerSkip: boolean;
  addAuthenticator: boolean;
}): boolean {
  if (!input.session || input.mfaEnabled !== true) return false;
  if (input.addAuthenticator) return true;
  return input.aal !== 'aal2' && !input.developerSkip;
}

/**
 * Where the sign-in screen sends a session that is already signed in: 'home' for the person's own home, 'from' for the page that asked
 * for an authenticator, or null to stay on the form.
 */
export function loginRedirect(input: {
  session: boolean;
  mfaEnabled: boolean | null;
  aal: Aal;
  developerSkip: boolean;
  addAuthenticator: boolean;
}): 'home' | 'from' | null {
  if (!input.session) return null;
  if (input.mfaEnabled === false) return input.addAuthenticator ? 'from' : 'home';
  if (input.addAuthenticator) return null;
  return input.aal === 'aal2' || input.developerSkip ? 'home' : null;
}

/** Whether the app shell skips the second step for this session. An unknown setting does not skip it. */
export function shellSkipsSecondFactor(config: AuthConfig | null, developerSkip: boolean): boolean {
  return developerSkip || config?.mfaEnabled === false;
}

/**
 * Whether an authenticator code may be asked for at all: the step-up dialog and the set-up controls. Off only when the project has second
 * factors off. An unknown setting still offers them, because the API enforces the second factor whenever it is on.
 */
export function secondFactorPromptAllowed(mfaEnabled: boolean | null): boolean {
  return mfaEnabled !== false;
}
