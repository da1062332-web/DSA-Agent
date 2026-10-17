// Rules for the tenant approvals screen (owner: Dev 1; DSA Notion MODULE 40, SUB-ADM.06 and SUB-ADM.07). The API enforces them again.
import type { DataCorrectionRequest, SupportAccessGrant } from '@dsa/contracts';

export const isValidJustification = (v: string): boolean => v.trim().length >= 10;
export const isValidScriptRef = (v: string): boolean => v.trim().length >= 3;
export const isValidTargetEntity = (v: string): boolean => v.trim().length >= 2;
export const isValidChangeDescription = (v: string): boolean => v.trim().length >= 5;

export const isValidCorrection = (c: {
  justification: string;
  scriptRef: string;
  targetEntity: string;
  changeDescription: string;
}): boolean =>
  isValidJustification(c.justification) &&
  isValidScriptRef(c.scriptRef) &&
  isValidTargetEntity(c.targetEntity) &&
  isValidChangeDescription(c.changeDescription);

/** What the signed-in administrator can still do with a support-access request. The requester is a platform operator, never them. */
export type GrantAction = 'DECIDE' | 'REVOKE' | 'NONE';
export const grantAction = (g: Pick<SupportAccessGrant, 'status'>): GrantAction =>
  g.status === 'PENDING' ? 'DECIDE' : g.status === 'APPROVED' ? 'REVOKE' : 'NONE';

/** SOD-08: a person cannot approve a correction they requested. */
export const canDecideCorrection = (
  c: Pick<DataCorrectionRequest, 'status' | 'requestedBy'>,
  meId: string | undefined,
  mayApprove: boolean,
): boolean => mayApprove && c.status === 'PENDING' && !!meId && c.requestedBy !== meId;

export const GRANT_STATUS_LABELS: Record<SupportAccessGrant['status'], string> = {
  PENDING: 'Waiting for your decision',
  APPROVED: 'Approved',
  DENIED: 'Denied',
  EXPIRED: 'Window ended',
  REVOKED: 'Revoked',
};

export const CORRECTION_STATUS_LABELS: Record<DataCorrectionRequest['status'], string> = {
  PENDING: 'Waiting for approval',
  APPROVED: 'Approved, waiting for the executor',
  REJECTED: 'Rejected',
  EXECUTED: 'Executed',
  FAILED: 'Failed',
};

/** Shown with every correction: no dry-run diff is invented. */
export const NO_DIFF_NOTE =
  'No dry-run diff has been attached yet. The executor attaches it before running the script.';
