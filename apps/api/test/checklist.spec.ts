// Completeness rules of the application checklist (MOD-DOC checklist slice, API-APP-007; owner: Dev 3).
import { describe, expect, it } from 'vitest';
import { summarise, toChecklistItem } from '../src/modules/origination/applications/checklist';
import type { ChecklistItem } from '../src/modules/origination/applications/checklist-schemas';

const item = (over: Partial<ChecklistItem>): ChecklistItem => ({
  id: 'chk_1',
  applicationId: 'app_1',
  partyId: 'pty_1',
  documentTypeCode: 'PAN_CARD',
  ordinal: 1,
  mandatory: true,
  requiredCount: 1,
  periodMonths: null,
  status: 'PENDING',
  rejectReason: null,
  attestationNote: null,
  reviewedBy: null,
  reviewedAt: null,
  documentId: null,
  sourceDecisionId: 'dec_1',
  version: 0,
  ...over,
});

describe('application checklist summary', () => {
  it('TEST-CHK-01 an empty checklist is not complete (nothing has been generated yet)', () => {
    expect(summarise([]).complete).toBe(false);
  });

  it('TEST-CHK-02 mandatory items must be accepted, waived or not applicable; optional ones do not block', () => {
    const s = summarise([
      item({ id: 'a', status: 'ACCEPTED' }),
      item({ id: 'b', status: 'WAIVED' }),
      item({ id: 'c', status: 'NOT_APPLICABLE' }),
      item({ id: 'd', mandatory: false, status: 'PENDING' }),
    ]);
    expect(s).toMatchObject({ total: 4, mandatory: 3, outstandingMandatory: 0, complete: true });
  });

  it('TEST-CHK-03 a rejected, expired, submitted or pending mandatory item keeps the file incomplete and is counted', () => {
    const s = summarise([
      item({ id: 'a', status: 'REJECTED' }),
      item({ id: 'b', status: 'EXPIRED' }),
      item({ id: 'c', status: 'SUBMITTED' }),
      item({ id: 'd', status: 'ACCEPTED' }),
    ]);
    expect(s).toMatchObject({
      outstandingMandatory: 3,
      rejected: 1,
      expired: 1,
      accepted: 1,
      complete: false,
    });
  });

  it('TEST-CHK-04 database rows map to the API shape, with nulls kept and dates in ISO form', () => {
    const mapped = toChecklistItem({
      id: 'chk_9',
      application_id: 'app_9',
      party_id: 'pty_9',
      document_type_code: 'BANK_STATEMENT',
      ordinal: 2,
      mandatory: false,
      required_count: 3,
      period_months: 6,
      status: 'ACCEPTED',
      reject_reason: null,
      attestation_note: 'Seen',
      reviewed_by: 'usr_1',
      reviewed_at: new Date('2026-10-16T10:00:00Z'),
      document_id: null,
      source_decision_id: 'dec_9',
      lock_version: 4,
    });
    expect(mapped).toMatchObject({
      periodMonths: 6,
      reviewedAt: '2026-10-16T10:00:00.000Z',
      documentId: null,
      version: 4,
    });
  });
});
