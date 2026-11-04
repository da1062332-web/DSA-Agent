// What the partner portal shows for each state of a portal login. The server decides the state (GET /portal/v1/eligibility). The page only
// reads it, and asks for the portal's data only when the state is ELIGIBLE.
import { ApiError } from '../../api/client';

export type PortalState = 'ELIGIBLE' | 'CONNECTOR_PENDING' | 'ACCESS_SUSPENDED' | 'NOT_LINKED';

export interface PortalEligibility {
  state: PortalState;
  /** The text for the user, from the server. Null while the portal is open. */
  message: string | null;
}

/** The portal's data is requested only once the server says this login is eligible. */
export const portalDataOpen = (eligibility: PortalEligibility | undefined): boolean =>
  eligibility?.state === 'ELIGIBLE';

/**
 * What to tell the user about their portal access, or null while the portal is open or still being checked. A 401 means the sign-in is not a
 * portal login yet (the invitation is not complete, or has expired). The server's message says which, so it is shown as it is.
 */
export function portalNotice(eligibility: PortalEligibility | undefined, error: unknown): string | null {
  if (eligibility) {
    if (eligibility.state === 'ELIGIBLE') return null;
    return eligibility.message ?? 'Your portal access is not active. Please contact your DSA administrator.';
  }
  if (!error) return null;
  if (error instanceof ApiError && error.httpStatus === 401) return error.message;
  return 'Your portal access could not be checked. Refresh the page and try again.';
}

/** A connector whose onboarding is still in progress is information, not an error. Everything else needs attention. */
export const portalNoticeSeverity = (eligibility: PortalEligibility | undefined): 'info' | 'warning' =>
  eligibility?.state === 'CONNECTOR_PENDING' ? 'info' : 'warning';

/** What a portal table says when it has no rows while the portal is closed for this login. The notice above says why. */
export const PORTAL_CLOSED_TEXT = 'Not available for this portal login. See the notice above.';

/**
 * The text for a portal table with no rows. While the login is being checked the table is loading. A login the server refused gets the
 * closed text, not "nothing here yet", because the table has not been asked for. Once the portal is open, the table is loading or empty.
 */
export function portalTableText(
  open: boolean,
  checking: boolean,
  loadingText: string,
  emptyText: string,
  dataLoading: boolean,
): string {
  if (!open) return checking ? loadingText : PORTAL_CLOSED_TEXT;
  return dataLoading ? loadingText : emptyText;
}
