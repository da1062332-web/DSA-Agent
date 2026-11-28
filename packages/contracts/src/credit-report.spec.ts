// P1-05: the credit-bureau soft pull contracts: the request, the age rule, the stored summary, the consent purpose and the fake port.
import { describe, expect, it } from 'vitest';
import type { RequestContext, Tx } from './kernel';
import {
  CREDIT_BUREAUS,
  CreditReportSchema,
  LatestCreditReportQuerySchema,
  ListCreditReportsQuerySchema,
  PullCreditReportSchema,
  isPullableDateOfBirth,
} from './credit-report';
import { CONSENT_PURPOSES } from './compliance';
import { FakeBureauPullPort, fakeBureauResult } from './fakes';
import { ID_PREFIXES } from './ids';
import { STANDARD_CAPABILITY_DESCRIPTORS } from './integrations';

const base = { bureau: 'CIBIL', name: 'Sunita Devi Verma', pan: 'QXZKW7391L', dateOfBirth: '1987-06-23' };
const NOW = new Date('2026-11-28T10:00:00.000Z');

describe('P1-05 PullCreditReportSchema', () => {
  it('P1-05 takes a bureau, a name, a PAN and a date of birth, and normalises the PAN', () => {
    expect(PullCreditReportSchema.parse({ ...base, pan: ' qxzkw7391l ' })).toEqual(base);
    for (const bureau of CREDIT_BUREAUS)
      expect(PullCreditReportSchema.safeParse({ ...base, bureau }).success, bureau).toBe(true);
  });

  it('P1-05 refuses an unknown bureau, a bad PAN, a bad date and a bad name, and never echoes what was typed', () => {
    const bad: [string, Record<string, unknown>, string][] = [
      ['an unknown bureau', { bureau: 'TRANSUNION' }, 'zzz-not-checked'],
      ['a PAN with a digit missing', { pan: 'QXZKW739L' }, 'QXZKW739L'],
      ['a PAN of digits', { pan: '1234567890' }, '1234567890'],
      ['a date written the other way round', { dateOfBirth: '23-06-1987' }, '23-06-1987'],
      ['a date that does not exist', { dateOfBirth: '1987-02-30' }, '1987-02-30'],
      ['a month 13', { dateOfBirth: '1987-13-01' }, '1987-13-01'],
      ['a year before 1900', { dateOfBirth: '1899-12-31' }, '1899-12-31'],
      ['a date of birth that is not text', { dateOfBirth: 19870623 }, '19870623'],
      ['no name', { name: undefined }, 'zzz-not-typed'],
      ['an empty name', { name: '   ' }, 'zzz-not-typed'],
      ['a PAN typed into the name', { name: 'Sunita QXZKW7391L' }, 'QXZKW7391L'],
      ['an account number typed into the name', { name: 'Sunita 731904826517' }, '731904826517'],
      ['a name that is too long', { name: 'A'.repeat(121) }, 'AAAAAAAAAA'],
    ];
    for (const [label, change, typed] of bad) {
      const result = PullCreditReportSchema.safeParse({ ...base, ...change });
      expect(result.success, label).toBe(false);
      if (!result.success) expect(JSON.stringify(result.error.issues), label).not.toContain(typed);
    }
  });

  it('P1-05 is strict: an Aadhaar number, a mobile, a result or a consent id as an extra key is a 422', () => {
    for (const extra of [
      { aadhaar: '123456789012' },
      { mobile: '9876543210' },
      { score: 800 },
      { consentRecordId: 'cnst_x' },
      { dob: '1987-06-23' },
    ]) {
      expect(PullCreditReportSchema.safeParse({ ...base, ...extra }).success, JSON.stringify(extra)).toBe(
        false,
      );
    }
  });
});

describe('P1-05 the age rule (the clock is passed in; it reuses ageOn and isRealDate of P1-02)', () => {
  it('P1-05 a pull is allowed for 18 to 100 years old, and not for a younger, an older or a future date of birth', () => {
    expect(isPullableDateOfBirth('2008-11-28', NOW)).toBe(true); // 18 today
    expect(isPullableDateOfBirth('2008-11-29', NOW)).toBe(false); // 17, 18 tomorrow
    expect(isPullableDateOfBirth('1926-11-28', NOW)).toBe(true); // 100 today
    expect(isPullableDateOfBirth('1926-11-27', NOW)).toBe(true); // 100 (turned 100 yesterday)
    expect(isPullableDateOfBirth('1925-11-28', NOW)).toBe(false); // 101
    expect(isPullableDateOfBirth('2030-01-01', NOW)).toBe(false);
    expect(isPullableDateOfBirth('2026-02-30', NOW)).toBe(false);
  });
});

describe('P1-05 the stored summary and its queries', () => {
  const stored = {
    id: 'crp_01M4V6DFM0TFA9D04QJTW32ETD',
    tenantId: 'ten_demo_01',
    customerId: 'cust_01M4V6DFM0TFA9D04QJTW32ETD',
    consentRecordId: 'cnst_01M4V6DFM0TFA9D04QJTW32ETD',
    bureau: 'CIBIL',
    provider: 'CRIF',
    outcome: 'SCORED',
    reportDate: '2026-11-28',
    score: 742,
    activeAccounts: 3,
    monthlyEmi: { amount: '18400.00', currency: 'INR' },
    maxDpd12m: 0,
    enquiries6m: 1,
    vendorRef: 'req_1',
    cost: { amount: '45.00', currency: 'INR' },
    pulledBy: 'usr_01M4V6DFM0TFA9D04QJTW32ETD',
    pulledAt: '2026-11-28T10:00:00.000Z',
    lockVersion: 0,
    createdAt: '2026-11-28T10:00:00.000Z',
  };

  it('P1-05 a SCORED summary and a NO_HISTORY summary (no score, never 0) both fit the schema', () => {
    expect(CreditReportSchema.safeParse(stored).success).toBe(true);
    const none = {
      ...stored,
      outcome: 'NO_HISTORY',
      score: null,
      activeAccounts: null,
      monthlyEmi: null,
      maxDpd12m: null,
      enquiries6m: null,
      cost: null,
    };
    expect(CreditReportSchema.safeParse(none).success).toBe(true);
  });

  it('P1-05 a score outside 300 to 900 is refused, and the money has the amount as a string', () => {
    for (const score of [0, 299, 901, 742.5])
      expect(CreditReportSchema.safeParse({ ...stored, score }).success, String(score)).toBe(false);
    expect(
      CreditReportSchema.safeParse({ ...stored, monthlyEmi: { amount: 18400, currency: 'INR' } }).success,
    ).toBe(false);
  });

  it('P1-05 the summary has no field for a PAN, a date of birth or a name', () => {
    const keys = Object.keys(CreditReportSchema.shape);
    for (const forbidden of ['pan', 'dateOfBirth', 'dob', 'name', 'fullName', 'rawReport', 'payload'])
      expect(keys).not.toContain(forbidden);
  });

  it('P1-05 the list query takes a bureau, a limit up to 200 and a cursor; the latest query takes only a bureau', () => {
    expect(ListCreditReportsQuerySchema.parse({}).limit).toBe(50);
    expect(ListCreditReportsQuerySchema.parse({ bureau: 'CRIF', limit: '200' })).toMatchObject({
      bureau: 'CRIF',
      limit: 200,
    });
    expect(ListCreditReportsQuerySchema.safeParse({ limit: '201' }).success).toBe(false);
    expect(ListCreditReportsQuerySchema.safeParse({ bureau: 'X' }).success).toBe(false);
    expect(LatestCreditReportQuerySchema.safeParse({}).success).toBe(true);
    expect(LatestCreditReportQuerySchema.safeParse({ bureau: 'EXPERIAN' }).success).toBe(true);
    expect(LatestCreditReportQuerySchema.safeParse({ limit: 5 }).success).toBe(false);
  });
});

describe('P1-05 consent purpose, id prefix, and the fake port', () => {
  it('P1-05 BUREAU_PULL is a consent purpose next to the five earlier ones, and crp is an id prefix', () => {
    expect([...CONSENT_PURPOSES]).toEqual([
      'CONTACT',
      'LOAN_PROCESSING',
      'SHARE_WITH_LENDER',
      'VERIFICATION_CHECK',
      'MARKETING',
      'BUREAU_PULL',
    ]);
    expect(ID_PREFIXES).toContain('crp');
  });

  it('P1-05 BUREAU.SOFT_PULL is a classified S3 capability of the BUREAU category', () => {
    const descriptor = STANDARD_CAPABILITY_DESCRIPTORS.find((d) => d.capability === 'BUREAU.SOFT_PULL');
    expect(descriptor).toMatchObject({
      category: 'BUREAU',
      dataClassification: 'S3',
      requiredConfigFields: ['apiEndpoint'],
      supportedProviders: ['CRIF', 'MOCK'],
    });
  });

  const tx = {} as Tx;
  const ctx = {} as RequestContext;
  const request = {
    bureau: 'CIBIL' as const,
    name: 'Sunita Devi Verma',
    pan: 'QXZKW7391L',
    dateOfBirth: '1987-06-23',
    caseId: 'idem_0123456789abcdef0123',
  };

  it('P1-05 the fake records requests, answers SCORED by default, repeats the last scripted answer and throws a scripted Error', async () => {
    const port = new FakeBureauPullPort().respondWith(
      new Error('bureau down'),
      fakeBureauResult({ outcome: 'NO_HISTORY', summary: null }),
    );

    await expect(port.pull(tx, ctx, request)).rejects.toThrow('bureau down');
    const none = await port.pull(tx, ctx, request);
    const again = await port.pull(tx, ctx, request);

    expect(none).toMatchObject({ outcome: 'NO_HISTORY', summary: null });
    expect(again).toEqual(none);
    expect(port.requests).toHaveLength(3);
    expect((await new FakeBureauPullPort().pull(tx, ctx, request)).summary?.score).toBe(742);
  });

  it('P1-05 a default result carries no PAN, date of birth or name', async () => {
    const result = await new FakeBureauPullPort().pull(tx, ctx, request);

    for (const typed of [request.pan, request.dateOfBirth, request.name])
      expect(JSON.stringify(result)).not.toContain(typed);
  });
});
