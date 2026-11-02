// The partner-facing referral status (API-CPT-001). Every internal lead state maps to one approved partner status, so a raw
// internal state is never sent to a connector. Pure mapping: no database.
import { describe, expect, it } from 'vitest';
import { LEAD_STATES } from '../src/modules/crm/leads/types';
import { COARSE } from '../src/modules/finance/connector-portal';

const PARTNER_STATUSES = ['RECEIVED', 'IN_PROGRESS', 'APPLICATION', 'CLOSED'];

describe('partner referral status (TEST-CPT-MAP)', () => {
  it('TEST-CPT-MAP-01 every lead state maps to an approved partner status', () => {
    for (const state of LEAD_STATES) {
      expect(COARSE[state], state).toBeDefined();
      expect(PARTNER_STATUSES, state).toContain(COARSE[state]);
    }
  });

  it('TEST-CPT-MAP-02 the map has no entry for a state the lead model does not have', () => {
    expect(Object.keys(COARSE).sort()).toEqual([...LEAD_STATES].sort());
  });
});
