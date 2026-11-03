// The second-factor decisions with the project's setting on and off (SUPABASE_MFA_ENABLED=true and =false). Each case states the setting.
import { describe, expect, it } from 'vitest';
import {
  loginRedirect,
  secondFactorDialogAllowed,
  secondFactorPromptAllowed,
  shellSkipsSecondFactor,
  signInFinishesWithoutCode,
} from './mfa-flow';

const ON = true;
const OFF = false;

describe('sign-in with second factors OFF (SUPABASE_MFA_ENABLED=false)', () => {
  it('a correct password completes the sign-in, with no code', () => {
    expect(signInFinishesWithoutCode(OFF)).toBe(true);
  });

  it('the second-factor dialog never opens, for any session, role or mode', () => {
    for (const aal of ['aal1', 'aal2', null, undefined] as const) {
      for (const addAuthenticator of [false, true]) {
        expect(
          secondFactorDialogAllowed({ session: true, mfaEnabled: OFF, aal, developerSkip: false, addAuthenticator }),
        ).toBe(false);
      }
    }
  });

  it('a signed-in person is sent to the dashboard', () => {
    expect(loginRedirect({ session: true, mfaEnabled: OFF, aal: 'aal1', developerSkip: false, addAuthenticator: false })).toBe(
      'home',
    );
  });

  it('a signed-in person adding an authenticator is sent back to the page that asked for it', () => {
    expect(loginRedirect({ session: true, mfaEnabled: OFF, aal: 'aal1', developerSkip: false, addAuthenticator: true })).toBe(
      'from',
    );
  });

  it('the shell skips the second step', () => {
    expect(shellSkipsSecondFactor({ mfaEnabled: OFF }, false)).toBe(true);
  });
});

describe('sign-in with second factors ON (SUPABASE_MFA_ENABLED=true)', () => {
  it('a correct password is not enough: the second step follows', () => {
    expect(signInFinishesWithoutCode(ON)).toBe(false);
  });

  it('the dialog opens for a signed-in session that has not passed the second factor', () => {
    expect(
      secondFactorDialogAllowed({ session: true, mfaEnabled: ON, aal: 'aal1', developerSkip: false, addAuthenticator: false }),
    ).toBe(true);
  });

  it('the dialog stays closed once the second factor has passed', () => {
    expect(
      secondFactorDialogAllowed({ session: true, mfaEnabled: ON, aal: 'aal2', developerSkip: false, addAuthenticator: false }),
    ).toBe(false);
  });

  it('adding an authenticator opens the dialog even after a second factor has passed', () => {
    expect(
      secondFactorDialogAllowed({ session: true, mfaEnabled: ON, aal: 'aal2', developerSkip: false, addAuthenticator: true }),
    ).toBe(true);
  });

  it('nothing opens without a session', () => {
    expect(
      secondFactorDialogAllowed({ session: false, mfaEnabled: ON, aal: 'aal1', developerSkip: false, addAuthenticator: false }),
    ).toBe(false);
  });

  it('a signed-in person with the second factor passed goes to the dashboard', () => {
    expect(loginRedirect({ session: true, mfaEnabled: ON, aal: 'aal2', developerSkip: false, addAuthenticator: false })).toBe(
      'home',
    );
  });

  it('a signed-in person without the second factor stays on the form', () => {
    expect(loginRedirect({ session: true, mfaEnabled: ON, aal: 'aal1', developerSkip: false, addAuthenticator: false })).toBeNull();
  });

  it('adding an authenticator stays on the security flow', () => {
    expect(loginRedirect({ session: true, mfaEnabled: ON, aal: 'aal1', developerSkip: false, addAuthenticator: true })).toBeNull();
  });

  it('the shell keeps the second step on', () => {
    expect(shellSkipsSecondFactor({ mfaEnabled: ON }, false)).toBe(false);
  });
});

describe('authenticator code prompts (step-up dialog and set-up controls)', () => {
  it('are never offered with second factors OFF', () => {
    expect(secondFactorPromptAllowed(OFF)).toBe(false);
  });

  it('are offered with second factors ON', () => {
    expect(secondFactorPromptAllowed(ON)).toBe(true);
  });

  it('are still offered while the setting is unknown, since the API enforces a second factor when it is on', () => {
    expect(secondFactorPromptAllowed(null)).toBe(true);
  });
});

describe('setting not yet known, and the developer switch', () => {
  it('an unknown setting opens no dialog and sends no one home on its own', () => {
    expect(
      secondFactorDialogAllowed({ session: true, mfaEnabled: null, aal: 'aal1', developerSkip: false, addAuthenticator: false }),
    ).toBe(false);
    expect(loginRedirect({ session: true, mfaEnabled: null, aal: 'aal1', developerSkip: false, addAuthenticator: false })).toBeNull();
  });

  it('an unknown setting keeps the shell gate on', () => {
    expect(shellSkipsSecondFactor(null, false)).toBe(false);
  });

  it('the developer switch skips the second step in the shell and at the login', () => {
    expect(shellSkipsSecondFactor(null, true)).toBe(true);
    expect(loginRedirect({ session: true, mfaEnabled: ON, aal: 'aal1', developerSkip: true, addAuthenticator: false })).toBe('home');
    expect(
      secondFactorDialogAllowed({ session: true, mfaEnabled: ON, aal: 'aal1', developerSkip: true, addAuthenticator: false }),
    ).toBe(false);
  });
});
