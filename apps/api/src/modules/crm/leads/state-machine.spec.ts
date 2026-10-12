// apps/api/src/modules/crm/leads/state-machine.spec.ts — owner: Dev 5 (SUB-LEAD.06)
import { describe, expect, it } from 'vitest';
import type { LeadRow } from './repository';
import { validateLeadTransition } from './state-machine';

function mockLead(overrides: Partial<LeadRow> = {}): LeadRow {
  return {
    id: 'lead_01JTEST000000000000000000',
    tenant_id: 'ten_01JTEST000000000000000000',
    branch_id: 'br_01',
    full_name: 'Test Customer',
    mobile_e164: '+919876543210',
    mobile_hash: Buffer.from('hash'),
    email: 'test@example.com',
    email_hash: Buffer.from('hash'),
    product_category: 'PL',
    indicative_amount: '300000.00',
    amount_currency: 'INR',
    pincode: '560001',
    source: 'WALK_IN',
    sub_source: null,
    campaign: null,
    utm: null,
    connector_id: null,
    referred_at: null,
    state: 'NEW',
    disqualification_reason: null,
    qual_applicant_type: null,
    qual_requested_amount: null,
    qual_tenure_months: null,
    qual_purpose_code: null,
    owner_user_id: 'usr_01',
    owner_queue_id: null,
    priority: 'MEDIUM',
    customer_id: null,
    application_id: null,
    duplicate_flag: 'NONE',
    duplicate_candidate_ids: [],
    last_duplicate_decision_id: null,
    last_routing_decision_id: null,
    contact_attempts: 0,
    tags: [],
    next_follow_up_at: null,
    lock_version: 0,
    created_at: new Date(),
    created_by: 'usr_01',
    updated_at: new Date(),
    updated_by: 'usr_01',
    ...overrides,
  };
}

describe('Lead State Machine (SUB-LEAD.06)', () => {
  it('T-LEAD-01 moves NEW to CONTACT_ATTEMPTED and increments attempts', () => {
    const lead = mockLead({ state: 'NEW', contact_attempts: 0 });
    const outcome = validateLeadTransition(lead, { transitionCode: 'T-LEAD-01' });

    expect(outcome.targetState).toBe('CONTACT_ATTEMPTED');
    expect(outcome.requiredPermission).toBe('lead.update');
    expect(outcome.updates.contact_attempts).toBe(1);
  });

  it('T-LEAD-01 moves CONTACT_ATTEMPTED to CONTACT_ATTEMPTED and increments attempts', () => {
    const lead = mockLead({ state: 'CONTACT_ATTEMPTED', contact_attempts: 2 });
    const outcome = validateLeadTransition(lead, { transitionCode: 'T-LEAD-01' });

    expect(outcome.targetState).toBe('CONTACT_ATTEMPTED');
    expect(outcome.updates.contact_attempts).toBe(3);
  });

  it('T-LEAD-02 moves NEW or CONTACT_ATTEMPTED to IN_PROGRESS', () => {
    const leadNew = mockLead({ state: 'NEW' });
    const outcomeNew = validateLeadTransition(leadNew, { transitionCode: 'T-LEAD-02' });
    expect(outcomeNew.targetState).toBe('IN_PROGRESS');
    expect(outcomeNew.requiredPermission).toBe('lead.update');

    const leadContacted = mockLead({ state: 'CONTACT_ATTEMPTED' });
    const outcomeContacted = validateLeadTransition(leadContacted, { transitionCode: 'T-LEAD-02' });
    expect(outcomeContacted.targetState).toBe('IN_PROGRESS');
  });

  it('T-LEAD-04 moves to QUALIFIED when qualification fields are provided', () => {
    const lead = mockLead({ state: 'IN_PROGRESS' });
    const outcome = validateLeadTransition(lead, {
      transitionCode: 'T-LEAD-04',
      qualification: {
        applicantType: 'SALARIED',
        requestedAmount: { amount: '500000.00', currency: 'INR' },
        tenureMonths: 36,
        purposeCode: 'PERSONAL_NEEDS',
      },
    });

    expect(outcome.targetState).toBe('QUALIFIED');
    expect(outcome.requiredPermission).toBe('lead.qualify');
    expect(outcome.updates.qual_applicant_type).toBe('SALARIED');
    expect(outcome.updates.qual_requested_amount).toBe('500000.00');
    expect(outcome.updates.qual_tenure_months).toBe(36);
  });

  it('T-LEAD-04 throws VALIDATION_ERROR when qualification details are missing', () => {
    const lead = mockLead({ state: 'IN_PROGRESS' });
    expect(() =>
      validateLeadTransition(lead, { transitionCode: 'T-LEAD-04' }),
    ).toThrowError(/qualification details/i);
  });

  it('T-LEAD-05 moves open lead to DISQUALIFIED with reason', () => {
    const lead = mockLead({ state: 'CONTACT_ATTEMPTED' });
    const outcome = validateLeadTransition(lead, {
      transitionCode: 'T-LEAD-05',
      disqualificationReason: 'NOT_INTERESTED',
    });

    expect(outcome.targetState).toBe('DISQUALIFIED');
    expect(outcome.requiredPermission).toBe('lead.qualify');
    expect(outcome.updates.disqualification_reason).toBe('NOT_INTERESTED');
  });

  it('T-LEAD-05 throws VALIDATION_ERROR when disqualification reason is absent', () => {
    const lead = mockLead({ state: 'IN_PROGRESS' });
    expect(() =>
      validateLeadTransition(lead, { transitionCode: 'T-LEAD-05' }),
    ).toThrowError(/requires disqualificationReason/i);
  });

  it('T-LEAD-01 sets next_follow_up_at when provided', () => {
    const lead = mockLead({ state: 'NEW' });
    const followUpDate = '2026-10-15T10:00:00.000Z';
    const outcome = validateLeadTransition(lead, {
      transitionCode: 'T-LEAD-01',
      nextFollowUpAt: followUpDate,
    });

    expect(outcome.targetState).toBe('CONTACT_ATTEMPTED');
    expect(outcome.updates.next_follow_up_at).toEqual(new Date(followUpDate));
  });

  it('T-LEAD-06 reopens DISQUALIFIED or NOT_CONTACTABLE to NEW with reasonCode', () => {
    const leadDisq = mockLead({ state: 'DISQUALIFIED', disqualification_reason: 'NOT_INTERESTED' });
    const outcome = validateLeadTransition(leadDisq, {
      transitionCode: 'T-LEAD-06',
      reasonCode: 'CUSTOMER_RECONTACTED',
    });

    expect(outcome.targetState).toBe('NEW');
    expect(outcome.requiredPermission).toBe('lead.reopen');
    expect(outcome.updates.state).toBe('NEW');
    expect(outcome.updates.disqualification_reason).toBeNull();

    const leadUnreach = mockLead({ state: 'NOT_CONTACTABLE' });
    const outcomeUnreach = validateLeadTransition(leadUnreach, {
      transitionCode: 'T-LEAD-06',
      reasonCode: 'ALTERNATIVE_NUMBER_PROVIDED',
    });
    expect(outcomeUnreach.targetState).toBe('NEW');
  });

  it('T-LEAD-06 throws VALIDATION_ERROR when reasonCode is absent', () => {
    const leadDisq = mockLead({ state: 'DISQUALIFIED' });
    expect(() =>
      validateLeadTransition(leadDisq, { transitionCode: 'T-LEAD-06' }),
    ).toThrowError(/requires a reopening reasonCode/i);
  });

  it('rejects invalid transitions with 409 INVALID_TRANSITION', () => {
    const leadConverted = mockLead({ state: 'CONVERTED' });
    expect(() =>
      validateLeadTransition(leadConverted, { transitionCode: 'T-LEAD-01' }),
    ).toThrowError(/Cannot execute T-LEAD-01 from state 'CONVERTED'/i);

    const leadNew = mockLead({ state: 'NEW' });
    expect(() =>
      validateLeadTransition(leadNew, { transitionCode: 'T-LEAD-06', reasonCode: 'TEST' }),
    ).toThrowError(/Only DISQUALIFIED or NOT_CONTACTABLE leads can be reopened/i);
  });
});
