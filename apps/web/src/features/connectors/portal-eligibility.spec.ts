// The partner portal's states: data is asked for only when the server says the login is eligible, and each refused state has its notice.
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/client';
import {
  PORTAL_CLOSED_TEXT,
  portalDataOpen,
  portalNotice,
  portalNoticeSeverity,
  portalTableText,
  type PortalEligibility,
} from './portal-eligibility';

const PENDING =
  'Your portal account is active, but your connector onboarding is awaiting verification and activation.';
const SUSPENDED = 'Your portal access has been suspended. Please contact your DSA administrator.';
const INVITATION =
  'Your connector portal invitation is pending. Please complete the invitation process using the link sent to your registered email.';

describe('partner portal eligibility (state A to E)', () => {
  it('opens the portal data only for an eligible login (state D)', () => {
    expect(portalDataOpen({ state: 'ELIGIBLE', message: null })).toBe(true);
    expect(portalDataOpen({ state: 'CONNECTOR_PENDING', message: PENDING })).toBe(false);
    expect(portalDataOpen({ state: 'ACCESS_SUSPENDED', message: SUSPENDED })).toBe(false);
    expect(portalDataOpen({ state: 'NOT_LINKED', message: 'x' })).toBe(false);
    expect(portalDataOpen(undefined)).toBe(false);
  });

  it('shows no notice for an eligible login', () => {
    expect(portalNotice({ state: 'ELIGIBLE', message: null }, null)).toBeNull();
  });

  it('shows the server text for a pending connector (state B), as information', () => {
    const e: PortalEligibility = { state: 'CONNECTOR_PENDING', message: PENDING };
    expect(portalNotice(e, null)).toBe(PENDING);
    expect(portalNoticeSeverity(e)).toBe('info');
  });

  it('shows the server text for a suspended login (state C), as a warning', () => {
    const e: PortalEligibility = { state: 'ACCESS_SUSPENDED', message: SUSPENDED };
    expect(portalNotice(e, null)).toBe(SUSPENDED);
    expect(portalNoticeSeverity(e)).toBe('warning');
  });

  it('shows a safe message for a login that is not linked (state E)', () => {
    const e: PortalEligibility = { state: 'NOT_LINKED', message: null };
    expect(portalNotice(e, null)).toBe(
      'Your portal access is not active. Please contact your DSA administrator.',
    );
  });

  it('shows the invitation message for a sign-in that is not a portal login yet (state A), from the 401 text', () => {
    expect(portalNotice(undefined, new ApiError('UNAUTHENTICATED', 401, INVITATION))).toBe(INVITATION);
  });

  it('shows a generic message for any other failure to check the state', () => {
    expect(portalNotice(undefined, new ApiError('INTERNAL_ERROR', 500, 'boom'))).toBe(
      'Your portal access could not be checked. Refresh the page and try again.',
    );
  });

  it('shows nothing while the state is still being checked', () => {
    expect(portalNotice(undefined, null)).toBeNull();
  });
});

describe('portal table text (an empty table says why)', () => {
  const LOADING = 'Loading referrals...';
  const EMPTY = 'No referrals submitted yet. Click "Submit Referral" to refer a borrower.';

  it('is loading while the login is still being checked', () => {
    expect(portalTableText(false, true, LOADING, EMPTY, false)).toBe(LOADING);
  });

  it('says the portal is closed for a login the server refused, and not that there is nothing yet', () => {
    expect(portalTableText(false, false, LOADING, EMPTY, false)).toBe(PORTAL_CLOSED_TEXT);
  });

  it('is loading or empty once the portal is open', () => {
    expect(portalTableText(true, false, LOADING, EMPTY, true)).toBe(LOADING);
    expect(portalTableText(true, false, LOADING, EMPTY, false)).toBe(EMPTY);
  });
});
