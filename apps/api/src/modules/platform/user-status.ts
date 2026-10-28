// Which account changes an administrator may make (owner: platform, MOD-USR). Pure, so the rules are tested without a database. The
// routes enforce them (router.ts PATCH /v1/users/:id, user-lifecycle.ts); the web app offers only the buttons these rules allow
// (apps/web/src/features/users/user-actions.ts mirrors them).
//
//   INVITED     -> becomes ACTIVE only by the invitee's own password sign-in (D4); an administrator can delete the invitation.
//   ACTIVE      -> SUSPENDED, DEACTIVATED (API only; the app offers Delete instead).
//   SUSPENDED   -> ACTIVE (reactivate), DEACTIVATED.
//   DEACTIVATED -> ACTIVE (a user deactivated before Delete existed).
//   Deleted     -> nothing: the record is kept only so that history stays readable.

export const ACTIVATION_REFUSED =
  'An invited user becomes active only by setting a password and signing in. Send a new invitation if they need one.';

export const DELETED_REFUSED =
  'This account has been deleted. It is kept only so that history stays readable, and it cannot be changed.';

/** Why an administrator cannot move a user from `from` to `to`, or null when they can. Unchanged status is always allowed. */
export function statusChangeRefusal(from: string, to: string): string | null {
  if (from === to) return null;
  switch (to) {
    case 'ACTIVE':
      if (from === 'INVITED') return ACTIVATION_REFUSED;
      return from === 'SUSPENDED' || from === 'DEACTIVATED' ? null : `A ${from} user cannot be activated.`;
    case 'SUSPENDED':
      return from === 'ACTIVE' ? null : 'Only an active user can be suspended.';
    case 'DEACTIVATED':
      return from === 'ACTIVE' || from === 'SUSPENDED' || from === 'INVITED'
        ? null
        : `A ${from} user cannot be deactivated.`;
    case 'INVITED':
      return 'A user becomes invited only through an invitation.';
    default:
      return `Unknown status ${to}.`;
  }
}
