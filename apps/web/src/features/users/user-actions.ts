// Which account actions the staff screens offer (MOD-USR). Mirrors the API's rules in apps/api/src/modules/platform/user-status.ts, so a
// button is shown only when the server would accept it:
//   INVITED     -> no Activate (only the invitee's own password sign-in activates, D4) and no Suspend; Resend and Delete.
//   ACTIVE      -> Suspend, Delete.
//   SUSPENDED   -> Activate, Delete.
//   DEACTIVATED -> Activate (deactivated before Delete existed), Delete.
//   Deleted     -> nothing: the record is kept only so that history stays readable.

export interface UserActionSubject {
  status: string;
  deleted?: boolean;
}

export interface UserActions {
  activate: boolean;
  suspend: boolean;
  delete: boolean;
  /** Profile fields and roles can be changed. */
  edit: boolean;
}

export function userActions(user: UserActionSubject): UserActions {
  if (user.deleted) return { activate: false, suspend: false, delete: false, edit: false };
  return {
    activate: user.status === 'SUSPENDED' || user.status === 'DEACTIVATED',
    suspend: user.status === 'ACTIVE',
    delete: true,
    edit: true,
  };
}

/** The status to show: a deleted account reads DELETED, whatever its stored status. */
export function displayStatus(user: UserActionSubject): string {
  return user.deleted ? 'DELETED' : user.status;
}
