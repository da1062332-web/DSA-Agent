// apps/web/src/features/verifications/bureau/credit-reports.spec.ts — P1-05: the request, the validation, the calls, the consent status and the
// messages of the Bureau card. No browser is needed: credit-reports.ts has no React in it. The attempt itself (keys, retries) is in
// bureau-pull-session.spec.ts.
import type { CreditReport } from '@dsa/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as clientModule from '../../../api/client';
import type { ConsentResource } from '../../customers/types';
import {
  AGE_MESSAGE,
  BUREAUS,
  BUREAU_LABELS,
  CACHE_NOTE,
  CLOCK_DIFFERENCE_MS,
  CONSENT_TEXT,
  HISTORY_PAGE_SIZE,
  consentStatusFor,
  describePullError,
  describeReadError,
  emptyBureauPullForm,
  fetchCreditReportHistory,
  fetchLatestCreditReport,
  formatRupees,
  isFromCache,
  outcomeText,
  parseBureauPullForm,
  pullCreditReport,
} from './credit-reports';

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof clientModule>('../../../api/client');
  return { ...actual, apiFetch: vi.fn() };
});
const apiFetch = vi.mocked(clientModule.apiFetch);
const { ApiError } = clientModule;

// Synthetic values that appear nowhere else in the repository.
const PAN = 'JQXWV5182D';
const DOB = '1973-12-09';
const NAME = 'Meenakshi Raghunathan Pillai';
const NOW = new Date('2026-11-28T10:00:00.000Z');

const form = (change: Partial<ReturnType<typeof emptyBureauPullForm>> = {}) => ({
  name: NAME,
  pan: PAN,
  dateOfBirth: DOB,
  ...change,
});

beforeEach(() => {
  apiFetch.mockReset();
});

describe('P1-05 bureau pull: the request', () => {
  it('P1-05 offers the four bureaus, in the order of the contracts', () => {
    expect([...BUREAUS]).toEqual(['CIBIL', 'CRIF', 'EXPERIAN', 'EQUIFAX']);
    for (const bureau of BUREAUS) expect(BUREAU_LABELS[bureau]).toBeTruthy();
  });

  it('P1-05 a valid form is exactly what the API schema takes: the PAN upper-cased, the name and date trimmed, nothing else', () => {
    const parsed = parseBureauPullForm(
      form({ pan: ' jqxwv5182d ', name: `  ${NAME} `, dateOfBirth: ` ${DOB} ` }),
      'CIBIL',
      NOW,
    );

    expect(parsed).toEqual({ ok: true, body: { bureau: 'CIBIL', name: NAME, pan: PAN, dateOfBirth: DOB } });
  });

  const bad: [string, ReturnType<typeof form>, string, string][] = [
    ['a PAN with a digit missing', form({ pan: 'JQXWV518D' }), 'pan', 'JQXWV518D'],
    ['a PAN made of digits', form({ pan: '1234567890' }), 'pan', '1234567890'],
    ['an empty PAN', form({ pan: '' }), 'pan', 'zzz-not-typed'],
    ['a date written the other way round', form({ dateOfBirth: '09-12-1973' }), 'dateOfBirth', '09-12-1973'],
    ['a date that does not exist', form({ dateOfBirth: '1973-02-30' }), 'dateOfBirth', '1973-02-30'],
    ['a month 13', form({ dateOfBirth: '1973-13-01' }), 'dateOfBirth', '1973-13-01'],
    ['a year before 1900', form({ dateOfBirth: '1899-12-31' }), 'dateOfBirth', '1899-12-31'],
    ['an empty date', form({ dateOfBirth: '' }), 'dateOfBirth', 'zzz-not-typed'],
    ['an empty name', form({ name: '   ' }), 'name', 'zzz-not-typed'],
    ['a PAN typed into the name', form({ name: `Meenakshi ${PAN}` }), 'name', PAN],
    [
      'an account number typed into the name',
      form({ name: 'Meenakshi 731904826517' }),
      'name',
      '731904826517',
    ],
    ['a name that is too long', form({ name: 'A'.repeat(121) }), 'name', 'AAAAAAAAAA'],
  ];
  it.each(bad)(
    'P1-05 %s is refused on the field %s, with a fixed message and nothing typed in it',
    (_label, input, field, typed) => {
      const parsed = parseBureauPullForm(input, 'CIBIL', NOW);

      expect(parsed.ok).toBe(false);
      if (parsed.ok) return;
      expect(Object.keys(parsed.fieldErrors)).toContain(field);
      expect(JSON.stringify(parsed.fieldErrors)).not.toContain(typed);
    },
  );

  it('P1-05 the age rule uses the clock it is given: 18 today passes, 17 does not, 100 passes, 101 does not, a future date does not', () => {
    const at = (dateOfBirth: string) => parseBureauPullForm(form({ dateOfBirth }), 'CIBIL', NOW);

    expect(at('2008-11-28').ok).toBe(true);
    expect(at('1926-11-28').ok).toBe(true);
    for (const dateOfBirth of ['2008-11-29', '2020-01-01', '1925-11-28', '2027-01-01']) {
      const parsed = at(dateOfBirth);
      expect(parsed.ok, dateOfBirth).toBe(false);
      if (!parsed.ok) {
        expect(parsed.fieldErrors.dateOfBirth, dateOfBirth).toBe(AGE_MESSAGE);
        expect(JSON.stringify(parsed.fieldErrors), dateOfBirth).not.toContain(dateOfBirth);
      }
    }
  });

  it('P1-05 an empty form is refused on every field it asks for', () => {
    const parsed = parseBureauPullForm(emptyBureauPullForm(), 'CRIF', NOW);

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(Object.keys(parsed.fieldErrors).sort()).toEqual(['dateOfBirth', 'name', 'pan']);
  });
});

describe('P1-05 bureau pull: the calls', () => {
  const report = { id: 'crp_1', bureau: 'CIBIL' } as CreditReport;

  it('P1-05 a pull is a POST to the customer with the body and the Idempotency-Key it was given', async () => {
    apiFetch.mockResolvedValue(report);
    const body = { bureau: 'CIBIL' as const, name: NAME, pan: PAN, dateOfBirth: DOB };

    const result = await pullCreditReport('cust_1', body, 'key_abc_12345');

    expect(result).toBe(report);
    expect(apiFetch).toHaveBeenCalledWith('/v1/customers/cust_1/credit-reports', {
      method: 'POST',
      body,
      idempotencyKey: 'key_abc_12345',
    });
  });

  it('P1-05 the customer id is encoded in the path', async () => {
    apiFetch.mockResolvedValue(report);

    await fetchLatestCreditReport('a b/c', 'CRIF');

    expect(apiFetch.mock.calls[0]?.[0]).toBe('/v1/customers/a%20b%2Fc/credit-reports/latest');
  });

  it('P1-05 the latest report of a bureau is read with the bureau as the query; 404 is "none yet" and any other error is thrown', async () => {
    apiFetch.mockResolvedValueOnce(report);
    expect(await fetchLatestCreditReport('cust_1', 'CIBIL')).toBe(report);
    expect(apiFetch).toHaveBeenLastCalledWith('/v1/customers/cust_1/credit-reports/latest', {
      query: { bureau: 'CIBIL' },
    });

    apiFetch.mockRejectedValueOnce(new ApiError('NOT_FOUND', 404, 'none'));
    expect(await fetchLatestCreditReport('cust_1', 'CIBIL')).toBeNull();

    apiFetch.mockRejectedValueOnce(new ApiError('FORBIDDEN', 403, 'no'));
    await expect(fetchLatestCreditReport('cust_1', 'CIBIL')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    apiFetch.mockRejectedValueOnce(new ApiError('INTERNAL_ERROR', 500, 'boom'));
    await expect(fetchLatestCreditReport('cust_1', 'CIBIL')).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
    });
  });

  it('P1-05 the history is read 20 at a time, for one bureau, with the cursor when there is one', async () => {
    apiFetch.mockResolvedValue({ data: [], meta: { nextCursor: null, limit: 20 } });

    await fetchCreditReportHistory('cust_1', 'EXPERIAN');
    await fetchCreditReportHistory('cust_1', 'EXPERIAN', 'cursor_x');

    expect(HISTORY_PAGE_SIZE).toBe(20);
    expect(apiFetch.mock.calls[0]?.[1]).toEqual({ query: { bureau: 'EXPERIAN', limit: 20 } });
    expect(apiFetch.mock.calls[1]?.[1]).toEqual({
      query: { bureau: 'EXPERIAN', limit: 20, cursor: 'cursor_x' },
    });
  });
});

describe('P1-05 bureau pull: a cache answer is told from a new report by its time', () => {
  const started = Date.parse('2026-11-28T10:00:00.000Z');

  it('P1-05 a report pulled before the attempt began is from the cache; one pulled during it is not', () => {
    expect(isFromCache({ pulledAt: '2026-11-28T06:00:00.000Z' }, started)).toBe(true);
    expect(isFromCache({ pulledAt: '2026-11-27T10:00:00.000Z' }, started)).toBe(true);
    expect(isFromCache({ pulledAt: '2026-11-28T10:00:01.000Z' }, started)).toBe(false);
    expect(isFromCache({ pulledAt: '2026-11-28T10:00:00.000Z' }, started)).toBe(false);
  });

  it('P1-05 a small difference between the two clocks does not make a new report look cached', () => {
    expect(CLOCK_DIFFERENCE_MS).toBe(60_000);
    expect(isFromCache({ pulledAt: '2026-11-28T09:59:30.000Z' }, started)).toBe(false);
    expect(isFromCache({ pulledAt: '2026-11-28T09:58:30.000Z' }, started)).toBe(true);
    expect(CACHE_NOTE).toContain('last 24 hours');
    expect(CACHE_NOTE).toContain('not charged again');
  });
});

describe('P1-05 bureau pull: the consent of a bureau', () => {
  const consent = (over: Partial<ConsentResource>): ConsentResource =>
    ({
      id: 'cnst_1',
      tenantId: 'ten_1',
      subjectType: 'CUSTOMER',
      subjectId: 'cust_1',
      purpose: 'BUREAU_PULL',
      purposeTarget: 'CIBIL',
      noticeVersion: 'V1',
      channel: 'OTP',
      evidenceRef: null,
      capturedBy: 'usr_1',
      capturedAt: '2026-11-20T09:00:00.000Z',
      status: 'ACTIVE',
      withdrawnAt: null,
      withdrawnBy: null,
      withdrawalReason: null,
      expiresAt: null,
      createdAt: '2026-11-20T09:00:00.000Z',
      ...over,
    }) as unknown as ConsentResource;

  it('P1-05 an active consent for the bureau is ACTIVE, with when it was captured and how', () => {
    expect(consentStatusFor([consent({})], 'CIBIL', NOW)).toEqual({
      kind: 'ACTIVE',
      capturedAt: '2026-11-20T09:00:00.000Z',
      channel: 'OTP',
    });
  });

  it('P1-05 each bureau has its own consent: a CIBIL consent says nothing about CRIF', () => {
    const consents = [consent({})];

    expect(consentStatusFor(consents, 'CRIF', NOW)).toEqual({ kind: 'NONE' });
    expect(consentStatusFor(consents, 'CIBIL', NOW).kind).toBe('ACTIVE');
  });

  it('P1-05 only BUREAU_PULL consents count: a loan-processing or verification consent is not a bureau consent', () => {
    const others = [
      consent({ purpose: 'LOAN_PROCESSING' as never, purposeTarget: null }),
      consent({ purpose: 'VERIFICATION_CHECK' as never, purposeTarget: 'CIBIL' }),
      consent({ purpose: 'SHARE_WITH_LENDER' as never, purposeTarget: 'CIBIL' }),
    ];

    expect(consentStatusFor(others, 'CIBIL', NOW)).toEqual({ kind: 'NONE' });
  });

  it('P1-05 a withdrawn consent is WITHDRAWN, an expired status is EXPIRED, and an active one past its expiry is EXPIRED too', () => {
    expect(consentStatusFor([consent({ status: 'WITHDRAWN' })], 'CIBIL', NOW)).toEqual({ kind: 'WITHDRAWN' });
    expect(consentStatusFor([consent({ status: 'EXPIRED' })], 'CIBIL', NOW)).toEqual({ kind: 'EXPIRED' });
    expect(consentStatusFor([consent({ expiresAt: '2026-11-27T00:00:00.000Z' })], 'CIBIL', NOW)).toEqual({
      kind: 'EXPIRED',
    });
    expect(consentStatusFor([consent({ expiresAt: '2026-12-31T00:00:00.000Z' })], 'CIBIL', NOW).kind).toBe(
      'ACTIVE',
    );
  });

  it('P1-05 a live consent wins over an older withdrawn one, and the newest of the dead ones decides', () => {
    const older = consent({ id: 'cnst_old', status: 'WITHDRAWN', capturedAt: '2026-10-01T09:00:00.000Z' });
    const newer = consent({ id: 'cnst_new', capturedAt: '2026-11-20T09:00:00.000Z' });
    expect(consentStatusFor([older, newer], 'CIBIL', NOW).kind).toBe('ACTIVE');

    const withdrawnLast = consent({
      id: 'cnst_w',
      status: 'WITHDRAWN',
      capturedAt: '2026-11-25T09:00:00.000Z',
    });
    const expiredFirst = consent({ id: 'cnst_e', status: 'EXPIRED', capturedAt: '2026-10-25T09:00:00.000Z' });
    expect(consentStatusFor([expiredFirst, withdrawnLast], 'CIBIL', NOW)).toEqual({ kind: 'WITHDRAWN' });
  });

  it('P1-05 consents that could not be read are UNKNOWN, never "none"', () => {
    expect(consentStatusFor(undefined, 'CIBIL', NOW)).toEqual({ kind: 'UNKNOWN' });
    expect(consentStatusFor(null, 'CIBIL', NOW)).toEqual({ kind: 'UNKNOWN' });
    expect(consentStatusFor([], 'CIBIL', NOW)).toEqual({ kind: 'NONE' });
    expect(CONSENT_TEXT.UNKNOWN).toContain('could not be read');
    expect(CONSENT_TEXT.NONE).toContain('No consent');
  });
});

describe('P1-05 bureau pull: money and words', () => {
  it('P1-05 rupees are grouped the Indian way, with two decimals', () => {
    expect(formatRupees({ amount: '18400.00', currency: 'INR' })).toBe('₹18,400.00');
    expect(formatRupees({ amount: '1234567.50', currency: 'INR' })).toBe('₹12,34,567.50');
    expect(formatRupees({ amount: '999.00', currency: 'INR' })).toBe('₹999.00');
    expect(formatRupees({ amount: '100000.00', currency: 'INR' })).toBe('₹1,00,000.00');
    expect(formatRupees({ amount: '0.00', currency: 'INR' })).toBe('₹0.00');
    expect(formatRupees({ amount: '45.5', currency: 'INR' })).toBe('₹45.50');
    expect(formatRupees({ amount: '45.00', currency: 'USD' })).toBe('USD 45.00');
    expect(formatRupees(null)).toBeNull();
    expect(formatRupees(undefined)).toBeNull();
  });

  it('P1-05 a report of no history says so in words and never offers a score', () => {
    expect(outcomeText({ outcome: 'NO_HISTORY', bureau: 'CIBIL' })).toBe(
      'No credit history was found at CIBIL',
    );
    expect(outcomeText({ outcome: 'NO_HISTORY', bureau: 'EXPERIAN' })).toBe(
      'No credit history was found at Experian',
    );
    expect(outcomeText({ outcome: 'SCORED', bureau: 'CIBIL' })).toBe('Scored');
  });
});

describe('P1-05 bureau pull: errors in plain words', () => {
  const api = (
    code: string,
    httpStatus: number,
    details: InstanceType<typeof ApiError>['details'] = [],
    correlationId?: string,
  ) =>
    new ApiError(
      code,
      httpStatus,
      `server text mentioning ${PAN} and ${DOB} and ${NAME}`,
      correlationId,
      details,
    );

  it('P1-05 missing consent, no provider, a bad age, and a bureau that did not accept the details each get their own message and are not retried', () => {
    const consent = describePullError(
      api('CONSENT_REQUIRED', 422, [{ field: 'bureau', issue: 'BUREAU_CONSENT_REQUIRED' }], 'corr_1'),
    );
    const noProvider = describePullError(
      api('VALIDATION_ERROR', 422, [{ field: 'bureau', issue: 'NO_ACTIVE_CONNECTION' }]),
    );
    const age = describePullError(
      api('VALIDATION_ERROR', 422, [{ field: 'dateOfBirth', issue: 'INVALID_AGE' }]),
    );
    const vendor = describePullError(
      api('VALIDATION_ERROR', 422, [{ issue: 'VENDOR_STATUS', meta: { vendorStatusCode: '102' } }]),
    );
    const generic = describePullError(api('VALIDATION_ERROR', 422));

    expect(consent).toMatchObject({ title: 'Consent is missing', canRetry: false, correlationId: 'corr_1' });
    expect(consent.message).toContain('Record the consent');
    expect(noProvider).toMatchObject({ title: 'No bureau provider is set up', canRetry: false });
    expect(noProvider.message).toContain('Integrations');
    expect(age).toMatchObject({ title: 'Date of birth not accepted', message: AGE_MESSAGE, canRetry: false });
    expect(vendor).toMatchObject({ title: 'The bureau did not accept this request', canRetry: false });
    expect(generic).toMatchObject({ title: 'The request was not accepted', canRetry: false });
  });

  it('P1-05 an unknown customer, a refusal of permission and a key that was already used are not retried', () => {
    expect(describePullError(api('NOT_FOUND', 404))).toMatchObject({
      title: 'Customer not found',
      canRetry: false,
    });
    expect(describePullError(api('FORBIDDEN', 403))).toMatchObject({ title: 'Not allowed', canRetry: false });
    expect(describePullError(api('IDEMPOTENCY_KEY_REUSED', 422))).toMatchObject({
      title: 'This request was already used',
      canRetry: false,
    });
  });

  it('P1-05 a busy bureau (429), an unreachable one (503) and a server error (500) can be retried, with the reference when there is one', () => {
    expect(describePullError(api('RATE_LIMITED', 429, [], 'corr_429'))).toMatchObject({
      title: 'The bureau is busy',
      canRetry: true,
      correlationId: 'corr_429',
    });
    expect(describePullError(api('DEPENDENCY_UNAVAILABLE', 503, [], 'corr_503'))).toMatchObject({
      title: 'The bureau could not be reached',
      canRetry: true,
      correlationId: 'corr_503',
    });
    expect(describePullError(api('INTERNAL_ERROR', 500, [], 'corr_500'))).toMatchObject({
      title: 'The server could not complete the pull',
      canRetry: true,
      correlationId: 'corr_500',
    });
    expect(describePullError(api('INTERNAL_ERROR', 500))).not.toHaveProperty('correlationId');
  });

  it('P1-05 a lost connection says it cannot tell whether the request arrived, and that the same reference is used again', () => {
    const view = describePullError(new ApiError('DEPENDENCY_UNAVAILABLE', 0, 'Cannot reach the API.'));

    expect(view.title).toBe('Connection lost');
    expect(view.message).toContain('cannot tell whether the request reached the server');
    expect(view.message).toContain('same reference');
    expect(view.canRetry).toBe(true);
  });

  it('P1-05 an error that is not an ApiError, and a code nobody listed, can be retried', () => {
    expect(describePullError(new Error('boom'))).toMatchObject({ canRetry: true });
    expect(describePullError(api('SOMETHING_NEW', 418))).toMatchObject({
      title: 'The report could not be pulled',
      canRetry: true,
    });
  });

  it("P1-05 the server's own text is never shown: nothing typed can come back through an error message", () => {
    const errors = [
      api('CONSENT_REQUIRED', 422),
      api('VALIDATION_ERROR', 422),
      api('VALIDATION_ERROR', 422, [{ field: 'dateOfBirth', issue: 'INVALID_AGE' }]),
      api('NOT_FOUND', 404),
      api('FORBIDDEN', 403),
      api('IDEMPOTENCY_KEY_REUSED', 422),
      api('RATE_LIMITED', 429),
      api('DEPENDENCY_UNAVAILABLE', 503),
      api('INTERNAL_ERROR', 500),
      new Error(`failed for ${PAN}`),
    ];
    for (const error of errors) {
      const shown = JSON.stringify(describePullError(error));
      for (const typed of [PAN, DOB, NAME, 'server text']) expect(shown).not.toContain(typed);
    }
  });

  it('P1-05 a failed read says what failed in fixed words, with the reference when there is one', () => {
    expect(describeReadError(api('FORBIDDEN', 403, [], 'corr_f'))).toEqual({
      message: 'You do not have permission to view credit reports.',
      correlationId: 'corr_f',
    });
    expect(describeReadError(new ApiError('DEPENDENCY_UNAVAILABLE', 0, 'x')).message).toContain(
      'Check the connection',
    );
    expect(describeReadError(new Error(`bad ${PAN}`))).toEqual({
      message: 'The reports could not be loaded.',
    });
    expect(JSON.stringify(describeReadError(api('INTERNAL_ERROR', 500)))).not.toContain(PAN);
  });
});
