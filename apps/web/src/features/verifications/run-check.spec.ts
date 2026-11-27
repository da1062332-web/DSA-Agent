// apps/web/src/features/verifications/run-check.spec.ts — P1-06: the request, the validation and the messages of "Run a provider check".
// No browser is needed: run-check.ts has no React in it. The attempt itself (keys, retries) is in run-check-session.spec.ts.
import type { VerificationRecord } from '@dsa/contracts';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/client';
import {
  RUN_CHECK_FIELDS,
  RUN_CHECK_KINDS,
  describeReason,
  describeRunCheckError,
  emptyRunCheckForm,
  isUnknownOutcome,
  parseRunCheckForm,
  unknownOutcomeWarning,
  withoutSensitiveValues,
  type RunCheckForm,
} from './run-check';

// Synthetic values that appear nowhere else in the repository.
const PAN = 'QXZKW7391L';
const GSTIN = '27QXZKW7391L1Z5';
const ACCOUNT = '731904826517';
const NAME = 'Sunita Devi Verma';
const CUSTOMER = 'cus_01M4V6DFM0TFA9D04QJTW32ETD';
const CONSENT = 'cnst_01M4V6DFM0TFA9D04QJTW32ETD';

const form = (change: Partial<RunCheckForm> = {}): RunCheckForm => ({
  ...emptyRunCheckForm(),
  subjectId: CUSTOMER,
  consentRecordId: CONSENT,
  ...change,
});
const pan = (change: Partial<RunCheckForm> = {}) => form({ check: 'PAN', idNumber: PAN, ...change });
const gst = (change: Partial<RunCheckForm> = {}) => form({ check: 'GST', idNumber: GSTIN, ...change });
const bank = (change: Partial<RunCheckForm> = {}) =>
  form({ check: 'BANK_ACCOUNT', accountNumber: ACCOUNT, ifsc: 'HDFC0001234', ...change });

describe('P1-06 run a provider check: the request', () => {
  it('P1-06 offers PAN, GST and the bank penny drop, and the fields each one asks for', () => {
    expect([...RUN_CHECK_KINDS]).toEqual(['PAN', 'GST', 'BANK_ACCOUNT']);
    expect(RUN_CHECK_FIELDS.PAN).toEqual(['idNumber', 'name']);
    expect(RUN_CHECK_FIELDS.GST).toEqual(['idNumber', 'name']);
    expect(RUN_CHECK_FIELDS.BANK_ACCOUNT).toEqual(['accountNumber', 'ifsc', 'name']);
  });

  it('P1-06 a PAN request is exactly what the API schema takes: normalised, the purpose defaulted, nothing else', () => {
    const parsed = parseRunCheckForm(pan({ idNumber: ' qxzkw7391l ', name: `  ${NAME} ` }));

    expect(parsed).toEqual({
      ok: true,
      body: {
        check: 'PAN',
        subjectType: 'CUSTOMER',
        subjectId: CUSTOMER,
        consentRecordId: CONSENT,
        idNumber: PAN,
        name: NAME,
        purpose: 'KYC',
      },
    });
  });

  it('P1-06 a GST request carries the GSTIN as idNumber; a name left blank is not sent at all', () => {
    const parsed = parseRunCheckForm(gst({ name: '   ' }));

    expect(parsed).toEqual({
      ok: true,
      body: {
        check: 'GST',
        subjectType: 'CUSTOMER',
        subjectId: CUSTOMER,
        consentRecordId: CONSENT,
        idNumber: GSTIN,
        purpose: 'KYC',
      },
    });
  });

  it('P1-06 a bank request carries the account number and the IFSC, spaces and hyphens removed and the IFSC in capitals, and no idNumber', () => {
    const parsed = parseRunCheckForm(bank({ accountNumber: '7319 0482-6517', ifsc: ' hdfc0001234 ' }));

    expect(parsed).toEqual({
      ok: true,
      body: {
        check: 'BANK_ACCOUNT',
        subjectType: 'CUSTOMER',
        subjectId: CUSTOMER,
        consentRecordId: CONSENT,
        accountNumber: ACCOUNT,
        ifsc: 'HDFC0001234',
        purpose: 'KYC',
      },
    });
  });

  it("P1-06 only the chosen check's own fields are sent: a PAN left in the form does not go with a bank check, and the reverse", () => {
    const toBank = parseRunCheckForm(bank({ idNumber: PAN }));
    const toPan = parseRunCheckForm(pan({ accountNumber: ACCOUNT, ifsc: 'HDFC0001234' }));

    expect(toBank.ok && JSON.stringify(toBank.body)).not.toContain(PAN);
    expect(toPan.ok && JSON.stringify(toPan.body)).not.toContain(ACCOUNT);
    expect(toPan.ok && 'ifsc' in toPan.body).toBe(false);
  });

  it('P1-06 the subject can be a customer, a loan application or a lead', () => {
    for (const subjectType of ['CUSTOMER', 'LOAN_APPLICATION', 'LEAD'] as const) {
      expect(parseRunCheckForm(pan({ subjectType })).ok, subjectType).toBe(true);
    }
  });
});

describe('P1-06 run a provider check: a bad form sends nothing, and the message never repeats what was typed', () => {
  const bad: [string, RunCheckForm, string, string][] = [
    ['a PAN with a digit missing', pan({ idNumber: 'QXZKW739L' }), 'idNumber', 'QXZKW739L'],
    ['a GSTIN without the Z', gst({ idNumber: '27QXZKW7391L1Y5' }), 'idNumber', '27QXZKW7391L1Y5'],
    ['a GSTIN given to a PAN check', pan({ idNumber: GSTIN }), 'idNumber', GSTIN],
    ['an account number of 8 digits', bank({ accountNumber: '48201937' }), 'accountNumber', '48201937'],
    [
      'an account number with letters',
      bank({ accountNumber: '4820AB193746' }),
      'accountNumber',
      '4820AB193746',
    ],
    [
      'an account number of 19 digits',
      bank({ accountNumber: '1234567890123456789' }),
      'accountNumber',
      '1234567890123456789',
    ],
    ['an IFSC whose fifth character is not zero', bank({ ifsc: 'HDFC1001234' }), 'ifsc', 'HDFC1001234'],
    ['an IFSC that is too short', bank({ ifsc: 'SBIN00' }), 'ifsc', 'SBIN00'],
    ['a PAN typed into the name', pan({ name: `Ravi ${PAN}` }), 'name', PAN],
    ['an account number typed into the name', bank({ name: `Sunita ${ACCOUNT}` }), 'name', ACCOUNT],
    ['no subject id', pan({ subjectId: '' }), 'subjectId', 'zzz-not-typed'],
    [
      'a consent id of the wrong shape',
      pan({ consentRecordId: 'consent-12345' }),
      'consentRecordId',
      'consent-12345',
    ],
  ];

  it.each(bad)('P1-06 %s is refused on the field %s', (_label, input, field, typed) => {
    const parsed = parseRunCheckForm(input);

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(Object.keys(parsed.fieldErrors)).toContain(field);
    expect(JSON.stringify(parsed.fieldErrors)).not.toContain(typed);
  });

  it('P1-06 an empty form is refused on every field it has, with a message for each', () => {
    const parsed = parseRunCheckForm(emptyRunCheckForm());

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(Object.keys(parsed.fieldErrors).sort()).toEqual(['consentRecordId', 'idNumber', 'subjectId']);
    for (const message of Object.values(parsed.fieldErrors)) expect(message).toBeTruthy();
  });

  it('P1-06 the PAN message says PAN and the GST message says GSTIN, the bank messages name the account and the IFSC', () => {
    const asMessage = (input: RunCheckForm, field: 'idNumber' | 'accountNumber' | 'ifsc') => {
      const parsed = parseRunCheckForm(input);
      return !parsed.ok ? (parsed.fieldErrors[field] ?? '') : '';
    };

    expect(asMessage(pan({ idNumber: 'x' }), 'idNumber')).toContain('PAN');
    expect(asMessage(gst({ idNumber: 'x' }), 'idNumber')).toContain('GSTIN');
    expect(asMessage(bank({ accountNumber: 'x' }), 'accountNumber')).toContain('9 to 18 digits');
    expect(asMessage(bank({ ifsc: 'x' }), 'ifsc')).toContain('IFSC');
  });
});

describe('P1-06 run a provider check: what is cleared', () => {
  it('P1-06 the PAN, GSTIN, account number and name are cleared; who the check is about, the consent and the IFSC code are kept', () => {
    const cleared = withoutSensitiveValues(bank({ idNumber: PAN, name: NAME }));

    expect(cleared).toMatchObject({
      check: 'BANK_ACCOUNT',
      subjectId: CUSTOMER,
      consentRecordId: CONSENT,
      idNumber: '',
      accountNumber: '',
      name: '',
    });
    expect(JSON.stringify(cleared)).not.toContain(PAN);
    expect(JSON.stringify(cleared)).not.toContain(ACCOUNT);
    expect(JSON.stringify(cleared)).not.toContain(NAME);
  });
});

describe('P1-06 run a provider check: errors in plain words', () => {
  const api = (code: string, httpStatus: number, details: ApiError['details'] = [], correlationId?: string) =>
    new ApiError(code, httpStatus, `server text mentioning ${PAN} and ${ACCOUNT}`, correlationId, details);

  it('P1-06 no provider set up (NO_ACTIVE_CONNECTION) says so and is not retried', () => {
    const view = describeRunCheckError(
      api('VALIDATION_ERROR', 422, [{ field: 'check', issue: 'NO_ACTIVE_CONNECTION' }]),
    );

    expect(view.title).toBe('No provider is set up for this check');
    expect(view.message).toContain('Integrations');
    expect(view.canRetry).toBe(false);
  });

  it('P1-06 a consent of someone else, a missing or expired consent, and an unknown id each get their own message', () => {
    const mismatch = describeRunCheckError(
      api('VALIDATION_ERROR', 422, [{ field: 'consentRecordId', issue: 'CONSENT_SUBJECT_MISMATCH' }]),
    );
    const required = describeRunCheckError(api('CONSENT_REQUIRED', 422));
    const missing = describeRunCheckError(api('NOT_FOUND', 404));

    expect(mismatch.title).toBe('This consent belongs to someone else');
    expect(required.title).toBe('Consent is missing');
    expect(required.message).toContain('expired');
    expect(missing.title).toBe('Not found');
    for (const view of [mismatch, required, missing]) expect(view.canRetry).toBe(false);
  });

  it('P1-06 a key that was already used says to start a new check, and a refusal of permission says so', () => {
    const reused = describeRunCheckError(api('IDEMPOTENCY_KEY_REUSED', 422));
    const forbidden = describeRunCheckError(api('FORBIDDEN', 403));

    expect(reused.title).toBe('This request was already used');
    expect(reused.message).toContain('Start a new check');
    expect(reused.canRetry).toBe(false);
    expect(forbidden.title).toBe('Not allowed');
    expect(forbidden.canRetry).toBe(false);
  });

  it('P1-06 a busy provider (429), an unreachable one (503) and a server error (500) can be retried, with the correlation id when there is one', () => {
    const busy = describeRunCheckError(api('RATE_LIMITED', 429, [], 'corr_busy_1'));
    const down = describeRunCheckError(api('DEPENDENCY_UNAVAILABLE', 503, [], 'corr_down_1'));
    const broken = describeRunCheckError(api('INTERNAL_ERROR', 500, [], 'corr_500_1'));
    const noId = describeRunCheckError(api('INTERNAL_ERROR', 500));

    expect(busy).toMatchObject({
      title: 'The provider is busy',
      canRetry: true,
      correlationId: 'corr_busy_1',
    });
    expect(down).toMatchObject({
      title: 'The provider could not be reached',
      canRetry: true,
      correlationId: 'corr_down_1',
    });
    expect(broken).toMatchObject({
      title: 'The server could not complete the check',
      canRetry: true,
      correlationId: 'corr_500_1',
    });
    expect(noId).not.toHaveProperty('correlationId');
  });

  it('P1-06 a lost connection says it cannot tell whether the request arrived, and that the same reference is used again', () => {
    const view = describeRunCheckError(new ApiError('DEPENDENCY_UNAVAILABLE', 0, 'Cannot reach the API.'));

    expect(view.title).toBe('Connection lost');
    expect(view.message).toContain('cannot tell whether the request reached the server');
    expect(view.message).toContain('same reference');
    expect(view.canRetry).toBe(true);
  });

  it('P1-06 an error that is not an ApiError, and a code nobody listed, can be retried and say nothing technical', () => {
    expect(describeRunCheckError(new Error('boom'))).toMatchObject({ canRetry: true });
    expect(describeRunCheckError(api('SOMETHING_NEW', 418))).toMatchObject({
      title: 'The check could not be run',
      canRetry: true,
    });
  });

  it("P1-06 the server's own text is never shown: nothing typed can come back through an error message", () => {
    const errors = [
      api('VALIDATION_ERROR', 422),
      api('VALIDATION_ERROR', 422, [{ field: 'check', issue: 'NO_ACTIVE_CONNECTION' }]),
      api('CONSENT_REQUIRED', 422),
      api('NOT_FOUND', 404),
      api('IDEMPOTENCY_KEY_REUSED', 422),
      api('RATE_LIMITED', 429),
      api('DEPENDENCY_UNAVAILABLE', 503),
      api('INTERNAL_ERROR', 500),
      api('FORBIDDEN', 403),
      new Error(`failed for ${PAN}`),
    ];
    for (const error of errors) {
      const shown = JSON.stringify(describeRunCheckError(error));
      expect(shown).not.toContain(PAN);
      expect(shown).not.toContain(ACCOUNT);
      expect(shown).not.toContain('server text');
    }
  });
});

describe('P1-06 run a provider check: reasons and the unknown outcome', () => {
  const record = (checkType: VerificationRecord['checkType'], discrepancies: string[]) =>
    ({ checkType, minimalResult: { statusDescription: 'x', discrepancies } }) as Pick<
      VerificationRecord,
      'checkType' | 'minimalResult'
    >;

  it('P1-06 every reason code the API can give has plain words, and an unknown code is shown as words, not hidden', () => {
    for (const code of [
      'ID_INVALID',
      'NOT_FOUND',
      'PAN_NOT_VALID',
      'GST_NOT_ACTIVE',
      'NAME_MISMATCH',
      'NAME_NOT_RETURNED',
      'BANK_TXN_FAILED',
      'NOT_SUPPORTED',
      'OUTCOME_UNKNOWN',
    ]) {
      const words = describeReason(code);
      expect(words, code).not.toMatch(/^Reason:/);
      expect(words, code).not.toContain('_');
    }
    expect(describeReason('NEW_REASON_CODE')).toBe('Reason: new reason code.');
  });

  it('P1-06 only a bank check with OUTCOME_UNKNOWN is an unknown outcome', () => {
    expect(isUnknownOutcome(record('BANK_ACCOUNT', ['OUTCOME_UNKNOWN']))).toBe(true);
    expect(isUnknownOutcome(record('BANK_ACCOUNT', ['BANK_TXN_FAILED']))).toBe(false);
    expect(isUnknownOutcome(record('BANK_ACCOUNT', []))).toBe(false);
    expect(isUnknownOutcome(record('PAN', ['OUTCOME_UNKNOWN']))).toBe(false);
  });

  it('P1-06 the unknown-outcome warning says the Rs 1 may or may not have been sent and quotes the case', () => {
    const warning = unknownOutcomeWarning('KARZA:idem_0123456789abcdef0123');

    expect(warning).toContain('The bank did not confirm.');
    expect(warning).toContain('₹1 may or may not have been sent');
    expect(warning).toContain('Confirm with the provider before starting another check');
    expect(warning).toContain('(case: KARZA:idem_0123456789abcdef0123)');
  });
});
