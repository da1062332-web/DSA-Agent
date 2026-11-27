// apps/api/test/karza-adapter.spec.ts — P1-06: the real Karza KYC adapter (PAN, GST, bank penny drop).
// No network is used: a fake fetch plays Karza. The vendor answers below follow the assumed contract at the top of
// providers/karza-adapter.ts; they are not recordings of the sandbox, which is not available yet.
import { ERROR_HTTP_STATUS, MinimalResultSchema, RETRYABLE_ERROR_CODES } from '@dsa/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdapterCallContext } from '../src/modules/integrations/adapter';
import {
  KarzaAdapter,
  type KarzaAdapterOptions,
  type KarzaConfig,
  type KycCheckOutput,
  type FetchLike,
} from '../src/modules/integrations/providers/karza-adapter';

const PAN = 'ABCDE1234F';
const GSTIN = '27ABCDE1234F1Z5';
const ACCOUNT = '123456789012';
const IFSC = 'HDFC0000123';
const API_KEY = 'test-karza-key-0001';

const config: KarzaConfig = {
  apiEndpoint: 'https://kyc.example.test/v3/check',
  minMatchScore: 85,
  timeoutMs: 2_000,
};
const credentials = { apiKey: API_KEY };
const context: AdapterCallContext = {
  correlationId: 'req-corr-0001',
  tenantId: 'ten_demo_01',
  environment: 'SANDBOX',
};

type Reply = { status: number; body: string } | Error;
const json = (status: number, body: unknown): Reply => ({ status, body: JSON.stringify(body) });
const timeoutError = () =>
  Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });

interface Sent {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  signal: AbortSignal;
  redirect: string;
}

/** A fake fetch that answers with the given replies in order; the last reply repeats once the others are used up. */
function setup(replies: Reply[], options: KarzaAdapterOptions = {}) {
  const sent: Sent[] = [];
  const queue = [...replies];
  const fetchImpl: FetchLike = async (url, init) => {
    sent.push({
      url,
      method: init.method,
      headers: init.headers,
      body: JSON.parse(init.body) as Record<string, unknown>,
      signal: init.signal,
      redirect: init.redirect,
    });
    const next = (queue.length > 1 ? queue.shift() : queue[0]) ?? json(500, {});
    if (next instanceof Error) throw next;
    return { status: next.status, text: async () => next.body };
  };
  const adapter = new KarzaAdapter({ fetchImpl, sleep: async () => {}, retryDelayMs: 0, ...options });
  return { adapter, sent };
}

const run = (
  adapter: KarzaAdapter,
  capability: string,
  input: unknown,
  cfg: KarzaConfig = config,
  creds: { apiKey?: string; authToken?: string } = credentials,
  ctx: AdapterCallContext = context,
) => adapter.execute<unknown, KycCheckOutput>(capability, input, cfg, creds, ctx);

const panOk = (result: Record<string, unknown> = {}) =>
  json(200, {
    request_id: 'req_pan_1',
    'status-code': '101',
    result: { name: 'RAVI KUMAR SHARMA', status: 'Valid', ...result },
  });
const gstOk = (result: Record<string, unknown> = {}) =>
  json(200, {
    request_id: 'req_gst_1',
    'status-code': '101',
    result: {
      sts: 'Active',
      tradeNam: 'SHARMA TRADERS',
      lgnm: 'RAVI KUMAR SHARMA',
      rgdt: '01/07/2019',
      ...result,
    },
  });
const bankOk = (result: Record<string, unknown> = {}) =>
  json(200, {
    request_id: 'req_bank_1',
    'status-code': '101',
    result: {
      bankTxnStatus: true,
      accountName: 'RAVI KUMAR SHARMA',
      bankResponse: 'Transaction Successful',
      ...result,
    },
  });
const vendorStatus = (code: string) => json(200, { request_id: 'req_x', 'status-code': code, result: {} });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('P1-06 Karza adapter: PAN', () => {
  it('P1-06 PAN sends the PAN, consent and correlation id to the configured endpoint, with the key in a header only', async () => {
    const { adapter, sent } = setup([panOk()]);
    await run(adapter, 'VERIFICATION.PAN', { idNumber: ' abcde1234f ' });

    expect(sent).toHaveLength(1);
    const call = sent[0] as Sent;
    expect(call.url).toBe(config.apiEndpoint);
    expect(call.method).toBe('POST');
    expect(call.headers['x-karza-key']).toBe(API_KEY);
    expect(call.headers['content-type']).toBe('application/json');
    expect(call.body).toEqual({ pan: PAN, consent: 'Y', clientData: { caseId: 'req-corr-0001' } });
    expect(JSON.stringify(call.body)).not.toContain(API_KEY);
    expect(call.signal).toBeInstanceOf(AbortSignal);
    expect(call.redirect).toBe('error');
  });

  it('P1-06 PAN with a matching name is VERIFIED, scored, masked and free of the name and the full PAN', async () => {
    const { adapter } = setup([panOk()]);
    const res = await run(adapter, 'VERIFICATION.PAN', { idNumber: PAN, name: 'Ravi Kumar Sharma' });

    expect(res.success).toBe(true);
    const data = res.data as KycCheckOutput;
    expect(data).toMatchObject({
      outcome: 'VERIFIED',
      verificationResult: 'VERIFIED',
      verified: true,
      matchScore: 100,
      identifierMasked: 'ABCDE****F',
      referenceId: 'req_pan_1',
      reason: null,
    });
    expect(MinimalResultSchema.safeParse(data.minimalResult).success).toBe(true);
    expect(data.minimalResult).toMatchObject({
      maskedIdentifier: 'ABCDE****F',
      nameMatchScore: 100,
      providerReference: 'req_pan_1',
      discrepancies: [],
    });
    expect(res.metadata).toMatchObject({
      provider: 'KARZA',
      capability: 'VERIFICATION.PAN',
      environment: 'SANDBOX',
      httpStatus: 200,
      externalTransactionId: 'req_pan_1',
    });
    const text = JSON.stringify(res);
    expect(text).not.toContain(PAN);
    expect(text).not.toContain('RAVI KUMAR SHARMA');
    expect(text).not.toContain(API_KEY);
    expect(text).not.toContain('94.5');
  });

  it('P1-06 PAN without a requested name invents no score', async () => {
    const { adapter } = setup([panOk()]);
    const res = await run(adapter, 'VERIFICATION.PAN', { idNumber: PAN });
    const data = res.data as KycCheckOutput;

    expect(data.outcome).toBe('VERIFIED');
    expect(data.matchScore).toBeNull();
    expect('nameMatchScore' in data.minimalResult).toBe(false);
  });

  it('P1-06 PAN name score is compared with minMatchScore: 80 passes a threshold of 80 and fails 85', async () => {
    const lenient = setup([panOk()]);
    const passes = await run(
      lenient.adapter,
      'VERIFICATION.PAN',
      { idNumber: PAN, name: 'Ravi Sharma' },
      {
        ...config,
        minMatchScore: 80,
      },
    );
    expect(passes.data).toMatchObject({ outcome: 'VERIFIED', matchScore: 80 });

    const strict = setup([panOk()]);
    const fails = await run(strict.adapter, 'VERIFICATION.PAN', { idNumber: PAN, name: 'Ravi Sharma' });
    expect(fails.data).toMatchObject({
      outcome: 'MISMATCH',
      verificationResult: 'REJECTED',
      verified: false,
      matchScore: 80,
      reason: 'NAME_MISMATCH',
    });
    expect((fails.data as KycCheckOutput).minimalResult.discrepancies).toEqual(['NAME_MISMATCH']);
  });

  it('P1-06 PAN of another person is a MISMATCH, not an error', async () => {
    const { adapter } = setup([panOk()]);
    const res = await run(adapter, 'VERIFICATION.PAN', { idNumber: PAN, name: 'Mohan Lal Gupta' });

    expect(res.success).toBe(true);
    expect(res.data).toMatchObject({
      outcome: 'MISMATCH',
      verified: false,
      matchScore: 0,
      reason: 'NAME_MISMATCH',
    });
  });

  it('P1-06 PAN the vendor calls invalid (102) or unknown (103) is a MISMATCH with the reason', async () => {
    const invalid = await run(setup([vendorStatus('102')]).adapter, 'VERIFICATION.PAN', { idNumber: PAN });
    expect(invalid.success).toBe(true);
    expect(invalid.data).toMatchObject({
      outcome: 'MISMATCH',
      verificationResult: 'REJECTED',
      verified: false,
      matchScore: null,
      reason: 'ID_INVALID',
    });

    const unknown = await run(setup([vendorStatus('103')]).adapter, 'VERIFICATION.PAN', { idNumber: PAN });
    expect(unknown.data).toMatchObject({ outcome: 'MISMATCH', reason: 'NOT_FOUND' });
  });

  it('P1-06 PAN whose status text is not valid is a MISMATCH even when the vendor answered 101', async () => {
    for (const status of ['Invalid', 'Deactivated', 'Fake']) {
      const res = await run(setup([panOk({ status })]).adapter, 'VERIFICATION.PAN', { idNumber: PAN });
      expect(res.data, status).toMatchObject({
        outcome: 'MISMATCH',
        reason: 'PAN_NOT_VALID',
        verified: false,
      });
    }
  });

  it('P1-06 PAN asked to match a name the vendor did not return is FAILED, never VERIFIED', async () => {
    const { adapter } = setup([
      json(200, { request_id: 'req_pan_2', 'status-code': '101', result: { status: 'Valid' } }),
    ]);
    const res = await run(adapter, 'VERIFICATION.PAN', { idNumber: PAN, name: 'Ravi Kumar Sharma' });

    expect(res.success).toBe(true);
    expect(res.data).toMatchObject({
      outcome: 'FAILED',
      verificationResult: 'INCONCLUSIVE',
      verified: false,
      matchScore: null,
      reason: 'NAME_NOT_RETURNED',
    });
  });

  it('P1-06 vendor 107 (not supported) is FAILED and INCONCLUSIVE', async () => {
    const res = await run(setup([vendorStatus('107')]).adapter, 'VERIFICATION.PAN', { idNumber: PAN });
    expect(res.success).toBe(true);
    expect(res.data).toMatchObject({
      outcome: 'FAILED',
      verificationResult: 'INCONCLUSIVE',
      verified: false,
      reason: 'NOT_SUPPORTED',
    });
  });
});

describe('P1-06 Karza adapter: GST', () => {
  it('P1-06 GST sends the GSTIN with consent and returns it with the PAN inside it masked', async () => {
    const { adapter, sent } = setup([gstOk()]);
    const res = await run(adapter, 'VERIFICATION.GST', { idNumber: GSTIN, name: 'Sharma Traders' });

    expect((sent[0] as Sent).body).toEqual({
      gstin: GSTIN,
      consent: 'Y',
      clientData: { caseId: 'req-corr-0001' },
    });
    expect(res.success).toBe(true);
    const data = res.data as KycCheckOutput;
    expect(data).toMatchObject({
      outcome: 'VERIFIED',
      verified: true,
      matchScore: 100,
      identifierMasked: '27ABCDE****F1Z5',
      referenceId: 'req_gst_1',
      details: { gstStatus: 'ACTIVE', registrationDate: '2019-07-01' },
    });
    expect(MinimalResultSchema.safeParse(data.minimalResult).success).toBe(true);
    const text = JSON.stringify(res);
    expect(text).not.toContain(GSTIN);
    expect(text).not.toContain(PAN);
    expect(text).not.toContain('SHARMA TRADERS');
  });

  it('P1-06 GST name is matched against the better of the trade name and the legal name', async () => {
    const byLegalName = await run(setup([gstOk()]).adapter, 'VERIFICATION.GST', {
      idNumber: GSTIN,
      name: 'Ravi Kumar Sharma',
    });
    expect(byLegalName.data).toMatchObject({ outcome: 'VERIFIED', matchScore: 100 });

    const neither = await run(setup([gstOk()]).adapter, 'VERIFICATION.GST', {
      idNumber: GSTIN,
      name: 'Mohan Lal Gupta',
    });
    expect(neither.data).toMatchObject({ outcome: 'MISMATCH', reason: 'NAME_MISMATCH' });
  });

  it('P1-06 GST that is not active is a MISMATCH carrying its status', async () => {
    const res = await run(setup([gstOk({ sts: 'Cancelled' })]).adapter, 'VERIFICATION.GST', {
      idNumber: GSTIN,
    });
    expect(res.success).toBe(true);
    expect(res.data).toMatchObject({
      outcome: 'MISMATCH',
      verificationResult: 'REJECTED',
      reason: 'GST_NOT_ACTIVE',
      details: { gstStatus: 'CANCELLED' },
    });
  });

  it('P1-06 GST answer without a status cannot be verified', async () => {
    const res = await run(setup([gstOk({ sts: undefined })]).adapter, 'VERIFICATION.GST', {
      idNumber: GSTIN,
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatchObject({ code: 'INTERNAL_ERROR', retryable: false });
    expect(res.data).toMatchObject({ outcome: 'ERROR', verified: false, verificationResult: null });
  });

  it('P1-06 GST registration date that is not a real date is left out, not guessed', async () => {
    const res = await run(setup([gstOk({ rgdt: '31/02/2019' })]).adapter, 'VERIFICATION.GST', {
      idNumber: GSTIN,
    });
    expect(res.data).toMatchObject({ outcome: 'VERIFIED', details: { gstStatus: 'ACTIVE' } });
    expect((res.data as KycCheckOutput).details).not.toHaveProperty('registrationDate');
  });
});

describe('P1-06 Karza adapter: bank penny drop', () => {
  it('P1-06 BANK sends the account number and IFSC, and the account is masked to its last four digits', async () => {
    const { adapter, sent } = setup([bankOk()]);
    const res = await run(adapter, 'VERIFICATION.BANK', {
      accountNumber: '1234 5678-9012',
      ifsc: 'hdfc0000123',
      name: 'Ravi Kumar Sharma',
    });

    expect((sent[0] as Sent).body).toEqual({
      accountNumber: ACCOUNT,
      ifsc: IFSC,
      consent: 'Y',
      clientData: { caseId: 'req-corr-0001' },
    });
    expect(res.success).toBe(true);
    const data = res.data as KycCheckOutput;
    expect(data).toMatchObject({
      outcome: 'VERIFIED',
      verified: true,
      matchScore: 100,
      identifierMasked: '********9012',
      referenceId: 'req_bank_1',
    });
    expect(MinimalResultSchema.safeParse(data.minimalResult).success).toBe(true);
    const text = JSON.stringify(res);
    expect(text).not.toContain(ACCOUNT);
    expect(text).not.toContain('RAVI KUMAR SHARMA');
  });

  it('P1-06 BANK credit that did not go through is FAILED, and a missing transaction status is an error', async () => {
    const failed = await run(setup([bankOk({ bankTxnStatus: false })]).adapter, 'VERIFICATION.BANK', {
      accountNumber: ACCOUNT,
      ifsc: IFSC,
    });
    expect(failed.success).toBe(true);
    expect(failed.data).toMatchObject({
      outcome: 'FAILED',
      verificationResult: 'INCONCLUSIVE',
      verified: false,
      reason: 'BANK_TXN_FAILED',
    });

    const missing = await run(setup([bankOk({ bankTxnStatus: undefined })]).adapter, 'VERIFICATION.BANK', {
      accountNumber: ACCOUNT,
      ifsc: IFSC,
    });
    expect(missing.success).toBe(false);
    expect(missing.data).toMatchObject({ outcome: 'ERROR', verified: false });
  });

  it('P1-06 BANK holder name that differs is a MISMATCH', async () => {
    const res = await run(setup([bankOk({ accountName: 'MOHAN LAL GUPTA' })]).adapter, 'VERIFICATION.BANK', {
      accountNumber: ACCOUNT,
      ifsc: IFSC,
      name: 'Ravi Kumar Sharma',
    });
    expect(res.data).toMatchObject({
      outcome: 'MISMATCH',
      verificationResult: 'REJECTED',
      reason: 'NAME_MISMATCH',
      matchScore: 0,
    });
  });
});

describe('P1-06 Karza adapter: input and connection checks make no HTTP call', () => {
  const bad: [string, string, unknown, string][] = [
    ['PAN of the wrong shape', 'VERIFICATION.PAN', { idNumber: 'ABCDE12345' }, 'ABCDE12345'],
    ['PAN of the wrong length', 'VERIFICATION.PAN', { idNumber: 'ABCDE1234' }, 'ABCDE1234'],
    ['PAN that is not text', 'VERIFICATION.PAN', { idNumber: 1234567890 }, '1234567890'],
    ['no PAN at all', 'VERIFICATION.PAN', {}, 'zzz-no-value'],
    ['an empty requested name', 'VERIFICATION.PAN', { idNumber: PAN, name: '' }, 'zzz-no-value'],
    ['GSTIN without the Z', 'VERIFICATION.GST', { idNumber: '27ABCDE1234F1Y5' }, '27ABCDE1234F1Y5'],
    [
      'account number that is too short',
      'VERIFICATION.BANK',
      { accountNumber: '12345678', ifsc: IFSC },
      '12345678',
    ],
    [
      'account number with letters',
      'VERIFICATION.BANK',
      { accountNumber: '12345678A901', ifsc: IFSC },
      '12345678A901',
    ],
    [
      'IFSC without the zero',
      'VERIFICATION.BANK',
      { accountNumber: ACCOUNT, ifsc: 'HDFC1000123' },
      'HDFC1000123',
    ],
    ['no IFSC', 'VERIFICATION.BANK', { accountNumber: ACCOUNT }, ACCOUNT],
  ];

  it.each(bad)(
    'P1-06 %s is a non-retryable VALIDATION_ERROR that does not echo the value',
    async (_label, capability, input, leaked) => {
      const { adapter, sent } = setup([panOk()]);
      const res = await run(adapter, capability, input);

      expect(sent).toHaveLength(0);
      expect(res.success).toBe(false);
      expect(res.data).toBeUndefined();
      expect(res.error).toMatchObject({ code: 'VALIDATION_ERROR', retryable: false });
      expect(res.metadata.httpStatus).toBe(422);
      expect(JSON.stringify(res)).not.toContain(leaked);
    },
  );

  it('P1-06 a capability the adapter does not serve is refused without a call', async () => {
    const { adapter, sent } = setup([panOk()]);
    const res = await run(adapter, 'MESSAGING.SMS', { idNumber: PAN });

    expect(sent).toHaveLength(0);
    expect(res.error).toMatchObject({ code: 'VALIDATION_ERROR', retryable: false });
  });

  it('P1-06 a connection without a usable https apiEndpoint is a VALIDATION_ERROR and nothing is sent', async () => {
    for (const apiEndpoint of [
      undefined,
      '',
      'not a url',
      'http://kyc.example.test/pan',
      'https://user:pw@kyc.example.test/pan',
    ]) {
      const { adapter, sent } = setup([panOk()]);
      const res = await run(adapter, 'VERIFICATION.PAN', { idNumber: PAN }, { ...config, apiEndpoint });

      expect(sent, String(apiEndpoint)).toHaveLength(0);
      expect(res.error, String(apiEndpoint)).toMatchObject({ code: 'VALIDATION_ERROR', retryable: false });
      expect(res.error?.details, String(apiEndpoint)).toEqual([
        { field: 'config.apiEndpoint', issue: 'NOT_CONFIGURED' },
      ]);
    }
  });

  it('P1-06 a missing vault credential is a non-retryable INTERNAL_ERROR and nothing is sent', async () => {
    const { adapter, sent } = setup([panOk()]);
    const res = await run(adapter, 'VERIFICATION.PAN', { idNumber: PAN }, config, {});

    expect(sent).toHaveLength(0);
    expect(res.error).toMatchObject({ code: 'INTERNAL_ERROR', retryable: false });
  });

  it('P1-06 an authToken credential is used as the key when there is no apiKey', async () => {
    const { adapter, sent } = setup([panOk()]);
    await run(adapter, 'VERIFICATION.PAN', { idNumber: PAN }, config, { authToken: 'token-key-0002' });

    expect((sent[0] as Sent).headers['x-karza-key']).toBe('token-key-0002');
  });

  it('P1-06 validateConfig accepts the seeded configuration and rejects malformed endpoints, scores and timeouts', () => {
    const adapter = new KarzaAdapter();

    expect(
      adapter.validateConfig({
        apiEndpoint: 'https://sandbox.karza.in/v2/pan-verification',
        minMatchScore: 85,
      }),
    ).toEqual({ valid: true });
    expect(adapter.validateConfig({})).toEqual({ valid: true });
    expect(adapter.validateConfig(null).valid).toBe(false);

    const rejected: [Record<string, unknown>, RegExp][] = [
      [{ apiEndpoint: 'http://kyc.example.test/pan' }, /https/],
      [{ apiEndpoint: 'kyc.example.test/pan' }, /absolute URL/],
      [{ apiEndpoint: 'https://user:pw@kyc.example.test/pan' }, /credentials/],
      [{ apiEndpoint: 42 }, /not set/],
      [{ minMatchScore: 101 }, /minMatchScore/],
      [{ minMatchScore: '85' }, /minMatchScore/],
      [{ timeoutMs: 10 }, /timeoutMs/],
      [{ timeoutMs: 600_000 }, /timeoutMs/],
      [{ timeoutMs: 1500.5 }, /timeoutMs/],
    ];
    for (const [candidate, pattern] of rejected) {
      const verdict = adapter.validateConfig(candidate);
      expect(verdict.valid, JSON.stringify(candidate)).toBe(false);
      expect((verdict.errors ?? []).join(' '), JSON.stringify(candidate)).toMatch(pattern);
    }
  });
});

describe('P1-06 Karza adapter: errors are classified and are never VERIFIED', () => {
  const statuses = [
    [429, 'RATE_LIMITED'],
    [408, 'DEPENDENCY_UNAVAILABLE'],
    [500, 'DEPENDENCY_UNAVAILABLE'],
    [400, 'VALIDATION_ERROR'],
    [422, 'VALIDATION_ERROR'],
    [401, 'INTERNAL_ERROR'],
    [403, 'INTERNAL_ERROR'],
    [404, 'NOT_FOUND'],
    [402, 'INTERNAL_ERROR'],
    [418, 'INTERNAL_ERROR'],
  ] as const;

  it.each(statuses)(
    'P1-06 HTTP %i from Karza is %s, taken from the catalogue, in one attempt',
    async (status, code) => {
      const { adapter, sent } = setup([json(status, { message: `rejected ${PAN}` })]);
      const res = await run(adapter, 'VERIFICATION.PAN', { idNumber: PAN });

      expect(sent).toHaveLength(1);
      expect(res.success).toBe(false);
      expect(res.error?.code).toBe(code);
      expect(Object.keys(ERROR_HTTP_STATUS)).toContain(res.error?.code);
      expect(res.error?.retryable).toBe(RETRYABLE_ERROR_CODES.has(code));
      expect(res.metadata.httpStatus).toBe(status);
      expect(res.data).toMatchObject({
        outcome: 'ERROR',
        verified: false,
        verificationResult: null,
        matchScore: null,
      });
      expect(JSON.stringify(res)).not.toContain(PAN);
    },
  );

  it.each([502, 503, 504])(
    'P1-06 HTTP %i is retryable and a lookup is attempted twice before it gives up',
    async (status) => {
      const { adapter, sent } = setup([json(status, {})]);
      const res = await run(adapter, 'VERIFICATION.GST', { idNumber: GSTIN });

      expect(sent).toHaveLength(2);
      expect(res.error).toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE', retryable: true });
      expect(res.metadata.httpStatus).toBe(status);
      expect(res.data).toMatchObject({ outcome: 'ERROR', verified: false });
    },
  );

  it('P1-06 a timeout, a refused connection and a broken fetch are retryable, say nothing about the input, and are never VERIFIED', async () => {
    const refused = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    const leaky = new Error(`connect failed while sending ${PAN} for account ${ACCOUNT}`);
    for (const failure of [timeoutError(), refused, leaky]) {
      const { adapter, sent } = setup([failure]);
      const res = await run(adapter, 'VERIFICATION.PAN', { idNumber: PAN, name: 'Ravi Kumar Sharma' });

      expect(sent).toHaveLength(2);
      expect(res.success).toBe(false);
      expect(res.error).toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE', retryable: true });
      expect(res.data).toMatchObject({
        outcome: 'ERROR',
        verified: false,
        verificationResult: null,
        matchScore: null,
      });
      const text = JSON.stringify(res);
      expect(text).not.toContain(PAN);
      expect(text).not.toContain(ACCOUNT);
    }
  });

  it('P1-06 vendor busy (104) and vendor source down (108) are retryable errors that name the vendor code', async () => {
    for (const code of ['104', '108']) {
      const { adapter, sent } = setup([vendorStatus(code)]);
      const res = await run(adapter, 'VERIFICATION.PAN', { idNumber: PAN });

      expect(sent).toHaveLength(1);
      expect(res.success).toBe(false);
      expect(res.error).toMatchObject({
        code: 'DEPENDENCY_UNAVAILABLE',
        retryable: true,
        details: [{ meta: { vendorStatusCode: code } }],
      });
      expect(res.data).toMatchObject({ outcome: 'ERROR', verified: false });
    }
  });

  it('P1-06 an answer this adapter does not recognise fails closed and is never VERIFIED', async () => {
    const answers: [string, Reply][] = [
      ['unknown status-code', vendorStatus('999')],
      ['missing status-code', json(200, { request_id: 'r', result: { name: 'RAVI', status: 'Valid' } })],
      ['status-code 105', vendorStatus('105')],
      ['empty object', json(200, {})],
      ['array', json(200, [])],
      ['plain text', { status: 200, body: 'OK' }],
      ['html page', { status: 200, body: '<html>gateway</html>' }],
      ['null', json(200, null)],
    ];
    for (const [label, reply] of answers) {
      const { adapter } = setup([reply]);
      const res = await run(adapter, 'VERIFICATION.PAN', { idNumber: PAN });

      expect(res.success, label).toBe(false);
      expect(res.error, label).toMatchObject({ code: 'INTERNAL_ERROR', retryable: false });
      expect(res.data, label).toMatchObject({ outcome: 'ERROR', verified: false, verificationResult: null });
    }
  });

  it('P1-06 an unsafe vendor request id or status code is not echoed', async () => {
    const { adapter } = setup([
      json(200, { request_id: `<script>${PAN}</script>`, 'status-code': '101', result: { status: 'Valid' } }),
    ]);
    const res = await run(adapter, 'VERIFICATION.PAN', { idNumber: PAN });
    expect(res.data).toMatchObject({ outcome: 'VERIFIED', referenceId: null });
    expect(JSON.stringify(res)).not.toContain('<script');

    const odd = setup([json(200, { 'status-code': `x${PAN}y-too-long`, result: {} })]);
    const bad = await run(odd.adapter, 'VERIFICATION.PAN', { idNumber: PAN });
    expect(bad.error?.details).toBeUndefined();
    expect(JSON.stringify(bad)).not.toContain(PAN);
  });
});

describe('P1-06 Karza adapter: retries', () => {
  it('P1-06 a PAN or GST lookup is retried once after a timeout and then succeeds', async () => {
    const pan = setup([timeoutError(), panOk()]);
    const first = await run(pan.adapter, 'VERIFICATION.PAN', { idNumber: PAN });
    expect(pan.sent).toHaveLength(2);
    expect(first.success).toBe(true);
    expect(first.data).toMatchObject({ outcome: 'VERIFIED' });

    const gst = setup([json(503, {}), gstOk()]);
    const second = await run(gst.adapter, 'VERIFICATION.GST', { idNumber: GSTIN });
    expect(gst.sent).toHaveLength(2);
    expect(second.data).toMatchObject({ outcome: 'VERIFIED' });
  });

  it('P1-06 the pause between lookup attempts is the configured one, and the number of attempts is configurable', async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const { adapter, sent } = setup([timeoutError()], { sleep, retryDelayMs: 250, lookupMaxAttempts: 3 });
    const res = await run(adapter, 'VERIFICATION.PAN', { idNumber: PAN });

    expect(sent).toHaveLength(3);
    expect(sleep.mock.calls).toEqual([[250], [250]]);
    expect(res.error).toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE', retryable: true });
  });

  it('P1-06 a rate limit and a rejected request are not retried', async () => {
    for (const status of [429, 400, 401]) {
      const { adapter, sent } = setup([json(status, {})]);
      await run(adapter, 'VERIFICATION.PAN', { idNumber: PAN });
      expect(sent, String(status)).toHaveLength(1);
    }
  });

  it('P1-06 the penny drop is never repeated automatically, because a timeout does not say whether the Rs 1 left', async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    for (const failure of [timeoutError(), json(503, {}), json(502, {})]) {
      const { adapter, sent } = setup([failure, bankOk()], { sleep });
      const res = await run(adapter, 'VERIFICATION.BANK', { accountNumber: ACCOUNT, ifsc: IFSC });

      expect(sent).toHaveLength(1);
      expect(res.success).toBe(false);
      expect(res.error?.retryable).toBe(true);
      expect(res.data).toMatchObject({ outcome: 'ERROR', verified: false });
    }
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe('P1-06 Karza adapter: environment, health and logging', () => {
  it('P1-06 the result carries the environment of the call, SANDBOX when none is given', async () => {
    const production = await run(
      setup([panOk()]).adapter,
      'VERIFICATION.PAN',
      { idNumber: PAN },
      config,
      credentials,
      {
        ...context,
        environment: 'PRODUCTION',
      },
    );
    expect(production.metadata.environment).toBe('PRODUCTION');

    const fallback = await run(
      setup([panOk()]).adapter,
      'VERIFICATION.PAN',
      { idNumber: PAN },
      config,
      credentials,
      {
        correlationId: 'req-corr-0002',
        tenantId: 'ten_demo_01',
      },
    );
    expect(fallback.metadata.environment).toBe('SANDBOX');
  });

  it('P1-06 without an injected fetch the adapter uses the global fetch, once, with the same request', async () => {
    const reply = JSON.stringify({
      request_id: 'req_g_1',
      'status-code': '101',
      result: { status: 'Valid' },
    });
    const globalFetch = vi.fn(async (_url: string, _init: unknown) => new Response(reply, { status: 200 }));
    vi.stubGlobal('fetch', globalFetch);
    try {
      const res = await new KarzaAdapter().execute<unknown, KycCheckOutput>(
        'VERIFICATION.PAN',
        { idNumber: PAN },
        config,
        credentials,
        context,
      );

      expect(globalFetch).toHaveBeenCalledTimes(1);
      const [url, init] = globalFetch.mock.calls[0] as [
        string,
        { method: string; headers: Record<string, string>; body: string; redirect: string },
      ];
      expect(url).toBe(config.apiEndpoint);
      expect(init).toMatchObject({ method: 'POST', redirect: 'error' });
      expect(init.headers['x-karza-key']).toBe(API_KEY);
      expect(JSON.parse(init.body)).toEqual({
        pan: PAN,
        consent: 'Y',
        clientData: { caseId: 'req-corr-0001' },
      });
      expect(res.data).toMatchObject({ outcome: 'VERIFIED', identifierMasked: 'ABCDE****F' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('P1-06 the health check reports whether a credential was resolved and does not call Karza', async () => {
    const { adapter, sent } = setup([panOk()]);

    const withKey = await adapter.checkHealth(config, credentials);
    expect(withKey).toMatchObject({ healthy: true, statusCode: 200 });
    expect(withKey.message).toContain('not probed');

    const without = await adapter.checkHealth(config, {});
    expect(without).toMatchObject({ healthy: false, statusCode: 401 });
    expect(sent).toHaveLength(0);
  });

  it('P1-06 nothing is written to the console or the process streams with a raw PAN, GSTIN, account number or key', async () => {
    const written: string[] = [];
    const record = (...args: unknown[]) => {
      written.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    };
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation(record);
    }
    const sink = ((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    vi.spyOn(process.stdout, 'write').mockImplementation(sink);
    vi.spyOn(process.stderr, 'write').mockImplementation(sink);

    const leaky = new Error(`socket hang up after sending ${PAN} ${GSTIN} ${ACCOUNT} ${API_KEY}`);
    const scenarios: [string, unknown, Reply[]][] = [
      ['VERIFICATION.PAN', { idNumber: PAN, name: 'Ravi Kumar Sharma' }, [panOk()]],
      ['VERIFICATION.GST', { idNumber: GSTIN }, [gstOk()]],
      ['VERIFICATION.BANK', { accountNumber: ACCOUNT, ifsc: IFSC }, [bankOk()]],
      ['VERIFICATION.PAN', { idNumber: PAN }, [leaky]],
      ['VERIFICATION.PAN', { idNumber: PAN }, [json(500, { echo: PAN })]],
      ['VERIFICATION.PAN', { idNumber: PAN }, [vendorStatus('999')]],
      ['VERIFICATION.GST', { idNumber: GSTIN.replace('Z', 'Y') }, [gstOk()]],
    ];
    for (const [capability, input, replies] of scenarios) {
      const { adapter } = setup(replies);
      const res = await run(adapter, capability, input);
      expect(JSON.stringify(res)).not.toContain(API_KEY);
    }

    const output = written.join('\n');
    for (const secret of [PAN, GSTIN, ACCOUNT, API_KEY]) {
      expect(output).not.toContain(secret);
    }
  });
});
