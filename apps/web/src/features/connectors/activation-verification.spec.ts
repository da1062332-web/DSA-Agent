// The activation dialog lists only the verifications that can activate this connector: VERIFIED, about this connector, nothing else.
import { describe, expect, it } from 'vitest';
import { passedVerificationsFor, type VerificationRow } from './activation-verification';

const CON = 'con_act_1';
const OTHER = 'con_act_2';

const row = (over: Partial<VerificationRow>): VerificationRow => ({
  id: 'ver_x',
  result: 'VERIFIED',
  subjectType: 'CONNECTOR',
  subjectId: CON,
  checkType: 'KYC',
  ...over,
});

describe('passed verifications for the activation dialog', () => {
  it('lists the VERIFIED records about this connector', () => {
    const rows = [row({ id: 'ver_ok', checkType: 'KYC' })];
    expect(passedVerificationsFor(CON, rows)).toEqual([{ id: 'ver_ok', label: 'ver_ok (KYC)' }]);
  });

  it('leaves out a rejected record, a customer record and another connector’s record', () => {
    const rows = [
      row({ id: 'ver_rejected', result: 'REJECTED' }),
      row({ id: 'ver_customer', subjectType: 'CUSTOMER', subjectId: 'cust_1' }),
      row({ id: 'ver_other', subjectId: OTHER }),
    ];
    expect(passedVerificationsFor(CON, rows)).toEqual([]);
  });

  it('is empty when there are no records, so the dialog says there is nothing to choose', () => {
    expect(passedVerificationsFor(CON, [])).toEqual([]);
  });
});
