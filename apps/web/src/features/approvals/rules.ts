// Rules for the tenant approvals screen (owner: Dev 1; DSA Notion MODULE 40, SUB-ADM.06). The API enforces them again.
import type { SupportAccessGrant } from '@dsa/contracts';

/** What the signed-in administrator can still do with a support-access request. The requester is a platform operator, never them. */
export type GrantAction = 'DECIDE' | 'REVOKE' | 'NONE';
export const grantAction = (g: Pick<SupportAccessGrant, 'status'>): GrantAction =>
  g.status === 'PENDING' ? 'DECIDE' : g.status === 'APPROVED' ? 'REVOKE' : 'NONE';

/**
 * A PENDING request whose access window has already ended. The API refuses both approve and deny for it, so the screen
 * must not offer either button. Same rule as platform-store.ts (the request can no longer be decided).
 */
export const grantWindowEnded = (g: Pick<SupportAccessGrant, 'status' | 'endsAt'>, now: Date): boolean =>
  g.status === 'PENDING' && new Date(g.endsAt).getTime() <= now.getTime();

export const GRANT_STATUS_LABELS: Record<SupportAccessGrant['status'], string> = {
  PENDING: 'Waiting for your decision',
  APPROVED: 'Approved',
  DENIED: 'Denied',
  EXPIRED: 'Window ended',
  REVOKED: 'Revoked',
};
