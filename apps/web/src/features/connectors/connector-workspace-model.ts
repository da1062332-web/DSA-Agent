// The connector workspace's rules, kept free of rendering so they are tested directly: which tabs a caller sees, the readable labels of
// the audit actions, the verification history, and the dashboard date range. The data comes from the API; nothing here invents data.

export const CONNECTOR_TAB_KEYS = [
  'overview',
  'profile',
  'verification',
  'bank',
  'agreements',
  'referrals',
  'earnings',
  'attributions',
  'portal',
  'activity',
] as const;
export type ConnectorTabKey = (typeof CONNECTOR_TAB_KEYS)[number];

/** What the caller may read, decided from its permissions (the API enforces the same rules on every read). */
export interface ConnectorTabAccess {
  canReadBank: boolean;
  canReadAgreements: boolean;
  canReadReferrals: boolean;
  canReadEarnings: boolean;
}

/** The tabs this caller sees, in order. A tab the caller may not read is left out, not shown empty. */
export function visibleConnectorTabs(access: ConnectorTabAccess): ConnectorTabKey[] {
  return CONNECTOR_TAB_KEYS.filter((key) => {
    switch (key) {
      case 'bank':
        return access.canReadBank;
      case 'agreements':
        return access.canReadAgreements;
      case 'referrals':
        return access.canReadReferrals;
      case 'earnings':
        return access.canReadEarnings;
      default:
        return true;
    }
  });
}

/** The label of a workspace tab. The bank and agreement tabs show how many records the caller can see. */
export function connectorTabLabel(
  key: ConnectorTabKey,
  counts: { bank: number; agreements: number },
): string {
  switch (key) {
    case 'overview':
      return 'Overview';
    case 'profile':
      return 'Profile & KYC Details';
    case 'verification':
      return 'Verification';
    case 'bank':
      return `Bank Accounts & SOD (${counts.bank})`;
    case 'agreements':
      return `Agreements & Rate Cards (${counts.agreements})`;
    case 'referrals':
      return 'Referrals';
    case 'earnings':
      return 'Earnings';
    case 'attributions':
      return 'Attributions & Disputes';
    case 'portal':
      return 'Portal Access & Users';
    case 'activity':
      return 'Activity & Audit';
  }
}

/** Readable labels for the audit actions the connector module writes. An action not listed shows as its code. */
export const ACTIVITY_LABEL: Record<string, string> = {
  'connector.created': 'Connector created',
  'connector.updated': 'Profile updated',
  'connector.owner_changed': 'Relationship manager changed',
  'connector.activated': 'Activated on a verified check',
  'connector.status_changed': 'Status changed',
  'connector.bank_account_created': 'Bank account added',
  'connector.bank_account_approved': 'Bank account approved',
  'connector.agreement_created': 'Agreement added',
  'connector.portal_user_invited': 'Portal login invited',
  'connector.portal_invitation_resent': 'Portal invitation resent',
  'connector.portal_invitation_revoked': 'Portal invitation withdrawn',
  'connector.attribution_change_requested': 'Attribution change requested',
  'connector.attribution_change_approved': 'Attribution change approved',
  'connector.dispute_resolved': 'Attribution dispute resolved',
};

export const activityLabel = (action: string): string => ACTIVITY_LABEL[action] ?? action;

/** The events that record a verification decision or a status change. */
const VERIFICATION_ACTIONS = ['connector.activated', 'connector.status_changed'];

export function verificationHistory<T extends { action: string }>(items: T[]): T[] {
  return items.filter((item) => VERIFICATION_ACTIONS.includes(item.action));
}

/** The dashboard range as query parameters. An empty side is left open. A range that ends before it starts is refused here as well. */
export function dashboardRangeParams(from: string, to: string): { query: string; error: string | null } {
  const start = from ? new Date(`${from}T00:00:00.000Z`) : null;
  const end = to ? new Date(`${to}T23:59:59.999Z`) : null;
  if (start && end && start > end) return { query: '', error: 'The end date is before the start date.' };
  const params = new URLSearchParams();
  if (start) params.set('from', start.toISOString());
  if (end) params.set('to', end.toISOString());
  return { query: params.toString(), error: null };
}

/**
 * Payable records bucketed the way the partner portal and the dashboard show them: expected (accrued or eligible), approved (approved
 * or in a payout), paid, and on hold. Reversed lines are left out. Amounts are decimal strings in rupees; sums are exact to the paisa.
 */
export function payableBuckets(items: { amount: string; state: string }[]): {
  expected: string;
  approved: string;
  paid: string;
  held: string;
} {
  const sum = (...states: string[]) =>
    (
      items
        .filter((i) => states.includes(i.state))
        .reduce((acc, i) => acc + Math.round(Number(i.amount) * 100), 0) / 100
    ).toFixed(2);
  return {
    expected: sum('ACCRUED', 'ELIGIBLE'),
    approved: sum('APPROVED', 'IN_PAYOUT'),
    paid: sum('PAID'),
    held: sum('ON_HOLD'),
  };
}

/** The status choices of the connector directory, as the API names them. */
export const DIRECTORY_STATUS_OPTIONS = [
  'DRAFT',
  'PENDING_VERIFICATION',
  'ACTIVE',
  'SUSPENDED',
  'TERMINATED',
] as const;
