// Server-side gate for sensitive financial operations: payouts, payment records, and approvals that change an amount or a payee.
// Containment added 2026-11-04 (docs/PRODUCTION_SECURITY_CONTAINMENT.md).
//
// The kernel's requireStepUp() is a no-op when the project's authenticator sign-in is off (SUPABASE_MFA_ENABLED=false). In that state these
// operations would run on a password alone. This gate refuses them instead, and it does not depend on any frontend state.
//
// When the project has a second factor, the gate falls through to requireStepUp(), so a recent aal2 verification is still required.
// Setting SUPABASE_MFA_ENABLED=true lifts the refusal. This module does not read or change that setting, and it never assumes that any
// user has enrolled a factor.
import { AppError, type RequestContext } from '@dsa/contracts';
import { projectMfaOff } from './mfa-switch';

/** The part of the kernel authorization port this gate needs. */
export interface SecondFactorGate {
  requireStepUp(ctx: RequestContext, maxAgeSeconds?: number): void;
}

/** Issue code in the error details, so a client and the audit trail can tell containment from an ordinary step-up refusal. */
export const PROJECT_SECOND_FACTOR_OFF = 'PROJECT_SECOND_FACTOR_OFF';

export function requireFinancialStepUp(authz: SecondFactorGate, ctx: RequestContext): void {
  if (projectMfaOff()) {
    throw AppError.of(
      'FORBIDDEN',
      'This payout or approval is unavailable: the project has no second factor, so step-up MFA cannot be checked. It is restored when step-up MFA is enabled.',
      [{ field: 'SUPABASE_MFA_ENABLED', issue: PROJECT_SECOND_FACTOR_OFF }],
    );
  }
  authz.requireStepUp(ctx);
}
