// The connector workspace rules: the tabs a caller sees, the activity labels, the verification history and the dashboard range (TEST-CWS).
import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_LABEL,
  activityLabel,
  CONNECTOR_TAB_KEYS,
  connectorTabLabel,
  dashboardRangeParams,
  payableBuckets,
  verificationHistory,
  visibleConnectorTabs,
} from './connector-workspace-model';

const none = {
  canReadBank: false,
  canReadAgreements: false,
  canReadReferrals: false,
  canReadEarnings: false,
};

describe('connector workspace rules (TEST-CWS)', () => {
  it('TEST-CWS-01 a caller with no finance, lead or bank permission sees only the tabs it may read', () => {
    expect(visibleConnectorTabs(none)).toEqual([
      'overview',
      'profile',
      'verification',
      'attributions',
      'portal',
      'activity',
    ]);
  });

  it('TEST-CWS-02 a manager with every permission sees every tab, in order, and nothing is shown empty', () => {
    const all = { canReadBank: true, canReadAgreements: true, canReadReferrals: true, canReadEarnings: true };
    expect(visibleConnectorTabs(all)).toEqual([
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
    ]);
  });

  it('TEST-CWS-03 each permission adds exactly its own tab', () => {
    expect(visibleConnectorTabs({ ...none, canReadEarnings: true })).toContain('earnings');
    expect(visibleConnectorTabs({ ...none, canReadEarnings: true })).not.toContain('referrals');
    expect(visibleConnectorTabs({ ...none, canReadReferrals: true })).toContain('referrals');
  });

  it('TEST-CWS-04 every audit action the connector module writes has a readable label, and an unknown one shows its code', () => {
    for (const action of Object.keys(ACTIVITY_LABEL)) {
      expect(ACTIVITY_LABEL[action]).not.toBe(action);
    }
    expect(activityLabel('connector.portal_user_invited')).toBe('Portal login invited');
    expect(activityLabel('connector.something_new')).toBe('connector.something_new');
  });

  it('TEST-CWS-05 the verification history keeps activation and status changes, and nothing else', () => {
    const items = [
      { action: 'connector.updated' },
      { action: 'connector.activated' },
      { action: 'connector.portal_user_invited' },
      { action: 'connector.status_changed' },
    ];
    expect(verificationHistory(items).map((i) => i.action)).toEqual([
      'connector.activated',
      'connector.status_changed',
    ]);
  });

  it('TEST-CWS-08 each tab has its label, and the bank and agreement tabs show their counts', () => {
    expect(connectorTabLabel('overview', { bank: 0, agreements: 0 })).toBe('Overview');
    expect(connectorTabLabel('bank', { bank: 2, agreements: 0 })).toBe('Bank Accounts & SOD (2)');
    expect(connectorTabLabel('agreements', { bank: 0, agreements: 3 })).toBe('Agreements & Rate Cards (3)');
    expect(connectorTabLabel('portal', { bank: 0, agreements: 0 })).toBe('Portal Access & Users');
    for (const key of CONNECTOR_TAB_KEYS) {
      expect(connectorTabLabel(key, { bank: 0, agreements: 0 }).length).toBeGreaterThan(0);
    }
  });

  it('TEST-CWS-07 payable amounts are bucketed as the portal buckets them, exact to the paisa, and reversed lines are left out', () => {
    expect(
      payableBuckets([
        { amount: '0.10', state: 'ACCRUED' },
        { amount: '0.20', state: 'ELIGIBLE' },
        { amount: '40.00', state: 'APPROVED' },
        { amount: '5.00', state: 'IN_PAYOUT' },
        { amount: '250.00', state: 'PAID' },
        { amount: '9.00', state: 'ON_HOLD' },
        { amount: '999.00', state: 'REVERSED' },
      ]),
    ).toEqual({ expected: '0.30', approved: '45.00', paid: '250.00', held: '9.00' });
    expect(payableBuckets([])).toEqual({ expected: '0.00', approved: '0.00', paid: '0.00', held: '0.00' });
  });

  it('TEST-CWS-06 a dashboard range covers whole days in UTC, can be open on either side, and an inverted range is refused', () => {
    expect(dashboardRangeParams('', '')).toEqual({ query: '', error: null });
    expect(dashboardRangeParams('2026-11-01', '')).toEqual({
      query: 'from=2026-11-01T00%3A00%3A00.000Z',
      error: null,
    });
    expect(dashboardRangeParams('2026-11-01', '2026-11-30').query).toBe(
      'from=2026-11-01T00%3A00%3A00.000Z&to=2026-11-30T23%3A59%3A59.999Z',
    );
    expect(dashboardRangeParams('2026-12-01', '2026-11-01').error).toMatch(/before the start/);
  });
});
