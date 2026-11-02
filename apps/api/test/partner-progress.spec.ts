// The partner view of a referral's progress and its documents (TEST-PPROG). Pure rules: every lead state has a partner label, an unknown
// state shows generically, every application and lender state is recorded with its proposed label and none is visible, and the timeline
// shows only steps the referral has reached.
import { describe, expect, it } from 'vitest';
import { LEAD_STATES } from '../src/modules/crm/leads/types';
import {
  APPLICATION_STATE_VIEW,
  LENDER_STATE_VIEW,
  PARTNER_DOCUMENT_STATUS,
  partnerDocumentStatus,
  partnerLeadStatus,
  partnerTimeline,
} from '../src/modules/partner-view/partner-progress';

// The internal enums, as the migrations define them (20261001000021 and 20261001000022). The test fails if a state is added to either
// without its partner view being recorded.
const LOAN_APPLICATION_STATES = [
  'DRAFT',
  'DOCUMENTS_PENDING',
  'UNDER_REVIEW',
  'READY_FOR_SUBMISSION',
  'SUBMITTED',
  'SANCTIONED',
  'PARTIALLY_DISBURSED',
  'DISBURSED',
  'CLOSED',
  'REJECTED',
  'WITHDRAWN',
  'CANCELLED',
];
const LENDER_CASE_STATES = [
  'DRAFT',
  'PACKAGE_READY',
  'SUBMITTED',
  'UNDER_PROCESSING',
  'QUERY_RAISED',
  'QUERY_RESPONDED',
  'SANCTIONED',
  'REJECTED',
  'WITHDRAWN',
  'SANCTION_EXPIRED',
  'SANCTION_CANCELLED',
  'PARTIALLY_DISBURSED',
  'DISBURSED',
  'CLOSED',
];

describe('partner view of a referral (TEST-PPROG)', () => {
  it('TEST-PPROG-01 every lead state has one of the four partner labels', () => {
    for (const state of LEAD_STATES) {
      expect(['RECEIVED', 'IN_PROGRESS', 'APPLICATION', 'CLOSED']).toContain(partnerLeadStatus(state));
    }
    expect(partnerLeadStatus('NEW')).toBe('RECEIVED');
    expect(partnerLeadStatus('CONVERTED')).toBe('APPLICATION');
    expect(partnerLeadStatus('ARCHIVED')).toBe('CLOSED');
  });

  it('TEST-PPROG-02 a state the map does not name shows as in progress, never as the raw value', () => {
    expect(partnerLeadStatus('SANCTIONED')).toBe('IN_PROGRESS');
    expect(partnerLeadStatus('')).toBe('IN_PROGRESS');
  });

  it('TEST-PPROG-03 every application and lender state is recorded with a proposed label, and none is visible to a partner', () => {
    expect(APPLICATION_STATE_VIEW.map((s) => s.state).sort()).toEqual([...LOAN_APPLICATION_STATES].sort());
    expect(LENDER_STATE_VIEW.map((s) => s.state).sort()).toEqual([...LENDER_CASE_STATES].sort());
    for (const entry of [...APPLICATION_STATE_VIEW, ...LENDER_STATE_VIEW]) {
      expect(entry.visibleToPartner).toBe(false);
      expect(entry.proposedLabel.length).toBeGreaterThan(0);
    }
  });

  it('TEST-PPROG-04 the timeline shows only the steps the referral has reached, and marks the current one', () => {
    const labels = (status: Parameters<typeof partnerTimeline>[0]) =>
      partnerTimeline(status).map((s) => [s.label, s.done, s.current]);
    expect(labels('RECEIVED')).toEqual([['Submitted', false, true]]);
    expect(labels('IN_PROGRESS')).toEqual([
      ['Submitted', true, false],
      ['Under review', false, true],
    ]);
    expect(labels('APPLICATION')).toEqual([
      ['Submitted', true, false],
      ['Under review', true, false],
      ['Application stage', false, true],
    ]);
    expect(labels('CLOSED')).toEqual([
      ['Submitted', true, false],
      ['Closed', false, true],
    ]);
  });

  it('TEST-PPROG-05 a document status maps to a partner label, and an unknown one is not shown as received', () => {
    expect(partnerDocumentStatus('PENDING')).toBe('NOT_SUBMITTED');
    expect(partnerDocumentStatus('SUBMITTED')).toBe('PENDING_REVIEW');
    expect(partnerDocumentStatus('ACCEPTED')).toBe('ACCEPTED');
    expect(partnerDocumentStatus('REJECTED')).toBe('ACTION_REQUIRED');
    expect(partnerDocumentStatus('SOMETHING_NEW')).toBe('NOT_SUBMITTED');
    expect(Object.keys(PARTNER_DOCUMENT_STATUS)).toEqual(
      expect.arrayContaining([
        'PENDING',
        'SUBMITTED',
        'ACCEPTED',
        'REJECTED',
        'EXPIRED',
        'WAIVED',
        'NOT_APPLICABLE',
      ]),
    );
  });
});
