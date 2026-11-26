// What the Users screens show for each account type (STAFF or CONNECTOR). Pure functions, so the rules are tested without rendering.
// A CONNECTOR account is a partner portal login: it holds no role, and its access comes from its linked connector. Staff accounts keep
// the behaviour they always had.
import type { AccountType } from './types';

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  STAFF: 'Staff',
  CONNECTOR: 'Partner portal',
};

export const isPartnerAccount = (user: { userType?: AccountType }): boolean => user.userType === 'CONNECTOR';

/**
 * The Roles cell of the user list. A partner login shows a "Partner portal" chip instead of "None", since it has no role by design.
 * A staff account shows its roles, or "None" when it has none. A row without role data (see hasRoleDetail) gives no labels.
 */
export function roleCell(user: { userType?: AccountType; assignedRoles?: string[] }): {
  partner: boolean;
  labels: string[];
} {
  if (isPartnerAccount(user)) return { partner: true, labels: [ACCOUNT_TYPE_LABEL.CONNECTOR] };
  return { partner: false, labels: user.assignedRoles ?? [] };
}

/**
 * Whether the list row carries role data. GET /v1/users returns the full row (account type, roles, masked contact) only to a user.manage
 * holder; everyone else with user.read gets the short directory row (name, branch, status, availability). The page must not read roles from
 * a short row, and must not print "None" for roles it was never given.
 */
export function hasRoleDetail(user: { userType?: AccountType; assignedRoles?: string[] }): boolean {
  return user.assignedRoles !== undefined || user.userType === 'CONNECTOR';
}

/** The Contact cell text: the masked e-mail, or a dash when the short directory row has none. */
export function contactText(user: { emailMasked?: string | null }): string {
  return user.emailMasked ?? '—';
}

/**
 * The tab numbers of the user detail page that a user gets: 0 Profile, 1 Account Status, 2 Roles, 3 Audit. A partner login has no roles
 * to show, so the Roles tab (2) is left out.
 */
export function detailTabValues(user: { userType?: AccountType }): number[] {
  return isPartnerAccount(user) ? [0, 1, 3] : [0, 1, 2, 3];
}
