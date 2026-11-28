// apps/api/test/bureau-adapter.spec.ts — P1-05: the credit-bureau soft-pull adapter (BUREAU.SOFT_PULL). No network is used: a fake fetch plays the
// bureau. The vendor answers below follow the ASSUMED contract at the top of providers/bureau-adapter.ts; they are not recordings of a sandbox,
// which does not exist yet.
import { ERROR_HTTP_STATUS, RETRYABLE_ERROR_CODES, STANDARD_CAPABILITY_DESCRIPTORS } from '@dsa/contracts';
import { describe, expect, it } from 'vitest';
import { sanitizeProviderPayload, type AdapterCallContext } from '../src/modules/integrations/adapter';
import { IntegrationRegistry } from '../src/modules/integrations/integration-registry';
import {
  BUREAU_PROVIDER_ID,
  BureauAdapter,
  type BureauConfig,
  type BureauPullOutput,
} from '../src/modules/integrations/providers/bureau-adapter';
import { MockTestAdapter } from '../src/modules/integrations/providers/mock-adapter';
import type { FetchLike } from '../src/modules/integrations/providers/vendor-http';

// Synthetic values that appear nowhere else in the repository.
const PAN = 'QXZKW7391L';
const DOB = '1987-06-23';
const NAME = 'Sunita Devi Verma';
const API_KEY = 'test-bureau-key-0001';

const config: BureauConfig = { apiEndpoint: 'https://bureau.example.test/v1/pull', timeoutMs: 2_000 };
const credentials = { apiKey: API_KEY };
const context: AdapterCallContext = {
  correlationId: 'idem_0123456789abcdef0123',
  tenantId: 'ten_demo_01',
  environment: 'SANDBOX',
};
const input = { bureau: 'CIBIL', name: NAME, pan: PAN, dateOfBirth: DOB };

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
function setup(replies: Reply[]) {
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
  return { adapter: new BureauAdapter({ fetchImpl, sleep: async () => {}, retryDelayMs: 0 }), sent };
}

const run = (
  adapter: BureauAdapter,
  payload: unknown = input,
  cfg: BureauConfig = config,
  creds: { apiKey?: string; authToken?: string } = credentials,
  capability = 'BUREAU.SOFT_PULL',
) => adapter.execute<unknown, BureauPullOutput>(capability, payload, cfg, creds, context);

const report = (result: Record<string, unknown> = {}) =>
  json(200, {
    request_id: 'req_bureau_1',
    'status-code': '101',
    result: {
      score: 742,
      activeAccounts: 3,
      totalEmi: 18400,
      maxDpd12m: 0,
      enquiries6m: 1,
      reportDate: '2026-11-28',
      ...result,
    },
  });
const vendorStatus = (code: string, result: Record<string, unknown> = {}) =>
  json(200, { request_id: 'req_x', 'status-code': code, result });

/** Everything a failed or successful pull hands back, as text, to look for what was typed. */
const everything = (res: unknown) => JSON.stringify(res);
const noPersonalData = (res: unknown, label = '') => {
  for (const typed of [PAN, DOB, NAME, 'Sunita', API_KEY])
    expect(everything(res), `${label} ${typed}`).not.toContain(typed);
};

describe('P1-05 bureau adapter: the request', () => {
  it('P1-05 sends one POST to the configured endpoint with the key in a header only, the consent flag and the case id, and never follows a redirect', async () => {
    const { adapter, sent } = setup([report()]);

    await run(adapter, { ...input, pan: ' qxzkw7391l ' });

    expect(sent).toHaveLength(1);
    const call = sent[0] as Sent;
    expect(call.url).toBe(config.apiEndpoint);
    expect(call.method).toBe('POST');
    expect(call.redirect).toBe('error');
    expect(call.signal).toBeInstanceOf(AbortSignal);
    expect(call.headers['x-api-key']).toBe(API_KEY);
    expect(call.headers['content-type']).toBe('application/json');
    expect(call.body).toEqual({
      bureau: 'CIBIL',
      name: NAME,
      pan: PAN,
      dob: DOB,
      consent: 'Y',
      clientData: { caseId: context.correlationId },
    });
    expect(JSON.stringify(call.body)).not.toContain(API_KEY);
  });

  it('P1-05 uses the auth token when the vault holds no api key', async () => {
    const { adapter, sent } = setup([report()]);

    await run(adapter, input, config, { authToken: 'token-for-the-bureau' });

    expect(sent[0]?.headers['x-api-key']).toBe('token-for-the-bureau');
  });
});

describe('P1-05 bureau adapter: a report', () => {
  it('P1-05 a scored report returns the summary only, with the money as a string, the bureau date, the request id and no cost when none is configured', async () => {
    const { adapter } = setup([report()]);

    const res = await run(adapter);

    expect(res.success).toBe(true);
    expect(res.data).toEqual({
      outcome: 'SCORED',
      reportDate: '2026-11-28',
      summary: {
        score: 742,
        activeAccounts: 3,
        monthlyEmi: { amount: '18400.00', currency: 'INR' },
        maxDpd12m: 0,
        enquiries6m: 1,
      },
      vendorRef: 'req_bureau_1',
      unitCost: null,
    });
    expect(res.metadata).toMatchObject({
      provider: BUREAU_PROVIDER_ID,
      capability: 'BUREAU.SOFT_PULL',
      environment: 'SANDBOX',
      httpStatus: 200,
      externalTransactionId: 'req_bureau_1',
    });
    noPersonalData(res);
  });

  it('P1-05 the unit cost comes from the connection configuration and is never invented', async () => {
    const withCost = await run(setup([report()]).adapter, input, { ...config, unitCostAmount: '45.00' });
    const without = await run(setup([report()]).adapter);

    expect(withCost.data?.unitCost).toEqual({ amount: '45.00', currency: 'INR' });
    expect(without.data?.unitCost).toBeNull();
  });

  it('P1-05 the EMI is read as rupees and paise from a number or a string, and a bad amount is not a report', async () => {
    const amounts: [unknown, string | null][] = [
      [18400, '18400.00'],
      [18400.1, '18400.10'],
      [0, '0.00'],
      ['18400', '18400.00'],
      ['18400.5', '18400.50'],
      ['18400.55', '18400.55'],
      [18400.123, null],
      ['18400.123', null],
      [-1, null],
      ['-1', null],
      ['abc', null],
      [null, null],
      [undefined, null],
      [Number.NaN, null],
      [1e15, null],
    ];
    for (const [totalEmi, expected] of amounts) {
      const res = await run(setup([report({ totalEmi })]).adapter);
      if (expected === null) {
        expect(res.success, String(totalEmi)).toBe(false);
        expect(res.data, String(totalEmi)).toBeUndefined();
      } else {
        expect(res.data?.summary?.monthlyEmi.amount, String(totalEmi)).toBe(expected);
      }
    }
  });

  it('P1-05 the figures may be digit strings, and the report date is optional', async () => {
    const res = await run(
      setup([report({ activeAccounts: '4', maxDpd12m: '30', enquiries6m: '2', reportDate: undefined })])
        .adapter,
    );

    expect(res.data).toMatchObject({
      reportDate: null,
      summary: { activeAccounts: 4, maxDpd12m: 30, enquiries6m: 2 },
    });
  });

  it('P1-05 no history (status-code 103) is a result with no score at all, never an error and never 0', async () => {
    const res = await run(setup([vendorStatus('103')]).adapter);

    expect(res.success).toBe(true);
    expect(res.data).toEqual({
      outcome: 'NO_HISTORY',
      reportDate: null,
      summary: null,
      vendorRef: 'req_x',
      unitCost: null,
    });
    expect(JSON.stringify(res.data)).not.toContain('"score"');
    // The bureau's own date is kept when it gives one.
    const dated = await run(setup([vendorStatus('103', { reportDate: '2026-11-27' })]).adapter);
    expect(dated.data?.reportDate).toBe('2026-11-27');
  });

  it('P1-05 a request id that is not a short token is dropped, not stored', async () => {
    const res = await run(
      setup([
        json(200, {
          request_id: 'a b c; DROP',
          'status-code': '101',
          result: { score: 742, activeAccounts: 1, totalEmi: 1, maxDpd12m: 0, enquiries6m: 0 },
        }),
      ]).adapter,
    );

    expect(res.data?.vendorRef).toBeNull();
  });
});

describe('P1-05 bureau adapter: fail closed, never a default score', () => {
  const broken: [string, Record<string, unknown>][] = [
    ['no score', { score: undefined }],
    ['a score of null', { score: null }],
    ['a score of 0', { score: 0 }],
    ['a score of -1', { score: -1 }],
    ['a score of 299', { score: 299 }],
    ['a score of 901', { score: 901 }],
    ['a score with a decimal', { score: 742.5 }],
    ['a score given as text', { score: '742' }],
    ['no active accounts figure', { activeAccounts: undefined }],
    ['a negative active accounts figure', { activeAccounts: -1 }],
    ['no EMI figure', { totalEmi: undefined }],
    ['no days-past-due figure', { maxDpd12m: undefined }],
    ['a days-past-due figure with a decimal', { maxDpd12m: 1.5 }],
    ['no enquiries figure', { enquiries6m: undefined }],
    ['a report date that is not a date', { reportDate: '28/11/2026' }],
    ['a report date that does not exist', { reportDate: '2026-02-30' }],
  ];
  it.each(broken)(
    'P1-05 a positive answer with %s is an error with no data: nothing is recorded',
    async (_label, change) => {
      const res = await run(setup([report(change)]).adapter);

      expect(res.success).toBe(false);
      expect(res.data).toBeUndefined();
      expect(res.error).toMatchObject({ code: 'INTERNAL_ERROR', retryable: false });
      noPersonalData(res);
    },
  );

  it('P1-05 an answer that is not a JSON object, an empty answer, an array, an unknown status-code and an answer without one are errors', async () => {
    const replies: Reply[] = [
      { status: 200, body: 'upstream gateway timeout' },
      { status: 200, body: '' },
      json(200, [1, 2, 3]),
      vendorStatus('999'),
      json(200, { request_id: 'req_x', result: { score: 742 } }),
      json(200, { 'status-code': '101' }),
    ];
    for (const reply of replies) {
      const res = await run(setup([reply]).adapter);
      expect(res.success).toBe(false);
      expect(res.data).toBeUndefined();
      expect(res.error?.code).toBe('INTERNAL_ERROR');
    }
  });
});

describe('P1-05 bureau adapter: errors keep their class, and a pull is attempted once', () => {
  const cases: [string, Reply, string, boolean, number][] = [
    ['HTTP 429', json(429, {}), 'RATE_LIMITED', true, 429],
    ['HTTP 503', json(503, {}), 'DEPENDENCY_UNAVAILABLE', true, 503],
    ['HTTP 502', json(502, {}), 'DEPENDENCY_UNAVAILABLE', true, 502],
    ['HTTP 504', json(504, {}), 'DEPENDENCY_UNAVAILABLE', true, 504],
    ['HTTP 500', json(500, {}), 'DEPENDENCY_UNAVAILABLE', true, 500],
    ['HTTP 408', json(408, {}), 'DEPENDENCY_UNAVAILABLE', true, 408],
    ['HTTP 401', json(401, {}), 'INTERNAL_ERROR', false, 401],
    ['HTTP 403', json(403, {}), 'INTERNAL_ERROR', false, 403],
    ['HTTP 404', json(404, {}), 'NOT_FOUND', false, 404],
    ['HTTP 400', json(400, {}), 'VALIDATION_ERROR', false, 400],
    ['HTTP 422', json(422, {}), 'VALIDATION_ERROR', false, 422],
    ['an HTTP status nobody listed (409)', json(409, {}), 'INTERNAL_ERROR', false, 409],
    ['the vendor saying its source is busy (104)', vendorStatus('104'), 'DEPENDENCY_UNAVAILABLE', true, 200],
    [
      'the vendor saying its source is unavailable (108)',
      vendorStatus('108'),
      'DEPENDENCY_UNAVAILABLE',
      true,
      200,
    ],
    ['the vendor not accepting the details (102)', vendorStatus('102'), 'VALIDATION_ERROR', false, 200],
    ['the bureau not being available (107)', vendorStatus('107'), 'VALIDATION_ERROR', false, 200],
    ['a timeout', timeoutError(), 'DEPENDENCY_UNAVAILABLE', true, 503],
    [
      'a dropped connection',
      Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }),
      'DEPENDENCY_UNAVAILABLE',
      true,
      503,
    ],
    ['an error with no cause', new Error('boom'), 'DEPENDENCY_UNAVAILABLE', true, 503],
  ];
  it.each(cases)(
    'P1-05 %s is %s (retryable: %s) with no data, sent once, and carries no personal data',
    async (_label, reply, code, retryable, httpStatus) => {
      const { adapter, sent } = setup([reply, report()]);

      const res = await run(adapter);

      expect(sent).toHaveLength(1);
      expect(res.success).toBe(false);
      expect(res.data).toBeUndefined();
      expect(res.error).toMatchObject({ code, retryable });
      expect(res.metadata.httpStatus).toBe(httpStatus);
      noPersonalData(res);
    },
  );

  it('P1-05 a retryable code is retryable and a refused key is not, as the Contracts catalogue says', async () => {
    for (const [, reply, code, retryable] of cases.map(
      (c) => c.slice(0, 4) as [string, Reply, string, boolean],
    )) {
      const res = await run(setup([reply]).adapter);
      expect(res.error?.retryable).toBe(RETRYABLE_ERROR_CODES.has(code as never));
      expect(res.error?.retryable).toBe(retryable);
      expect(code in ERROR_HTTP_STATUS).toBe(true);
    }
  });

  it('P1-05 the vendor status code is reported in the error details, as a fixed token', async () => {
    const res = await run(setup([vendorStatus('104')]).adapter);

    expect(res.error?.details).toEqual([{ issue: 'VENDOR_STATUS', meta: { vendorStatusCode: '104' } }]);
  });
});

describe('P1-05 bureau adapter: nothing is sent when the request cannot be right', () => {
  const bad: [string, Record<string, unknown>, string, string][] = [
    ['a PAN with a digit missing', { pan: 'QXZKW739L' }, 'pan', 'QXZKW739L'],
    ['a date of birth that does not exist', { dateOfBirth: '1987-02-30' }, 'dateOfBirth', '1987-02-30'],
    [
      'a date of birth written the other way round',
      { dateOfBirth: '23-06-1987' },
      'dateOfBirth',
      '23-06-1987',
    ],
    ['an unknown bureau', { bureau: 'TRANSUNION' }, 'bureau', 'TRANSUNION'],
    ['no name', { name: undefined }, 'name', 'zzz-not-typed'],
    ['an empty name', { name: '  ' }, 'name', 'zzz-not-typed'],
  ];
  it.each(bad)(
    'P1-05 %s: VALIDATION_ERROR on the field, a fixed issue code, the value never repeated, the bureau not called',
    async (_label, change, field, typed) => {
      const { adapter, sent } = setup([report()]);

      const res = await run(adapter, { ...input, ...change });

      expect(sent).toHaveLength(0);
      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('VALIDATION_ERROR');
      const details = (res.error?.details ?? []) as { field?: string; issue: string }[];
      expect(details.map((d) => d.field)).toContain(field);
      for (const detail of details) expect(detail.issue).toMatch(/^[A-Z_]+$/);
      expect(everything(res)).not.toContain(typed);
    },
  );

  it('P1-05 no endpoint, an endpoint that is not https, one with credentials, no key and another capability stop the pull before the bureau', async () => {
    const attempt = async (
      label: string,
      cfg: BureauConfig,
      creds: { apiKey?: string },
      capability = 'BUREAU.SOFT_PULL',
    ) => {
      const { adapter, sent } = setup([report()]);
      const res = await run(adapter, input, cfg, creds, capability);
      expect(sent, label).toHaveLength(0);
      expect(res.success, label).toBe(false);
      expect(res.data, label).toBeUndefined();
      noPersonalData(res, label);
      return res;
    };
    expect((await attempt('no endpoint', { timeoutMs: 2_000 }, credentials)).error?.code).toBe(
      'VALIDATION_ERROR',
    );
    expect(
      (await attempt('http endpoint', { apiEndpoint: 'http://bureau.example.test/x' }, credentials)).error
        ?.code,
    ).toBe('VALIDATION_ERROR');
    expect(
      (
        await attempt(
          'credentials in the endpoint',
          { apiEndpoint: 'https://user:pw@bureau.example.test/x' },
          credentials,
        )
      ).error?.code,
    ).toBe('VALIDATION_ERROR');
    expect((await attempt('no key in the vault', config, {})).error?.code).toBe('INTERNAL_ERROR');
    expect((await attempt('another capability', config, credentials, 'VERIFICATION.PAN')).error?.code).toBe(
      'VALIDATION_ERROR',
    );
  });
});

describe('P1-05 bureau adapter: configuration and health', () => {
  it('P1-05 validateConfig accepts a good configuration and says what is wrong with a bad one', () => {
    const adapter = new BureauAdapter();

    expect(
      adapter.validateConfig({
        apiEndpoint: 'https://bureau.example.test/x',
        timeoutMs: 5000,
        unitCostAmount: '45.00',
      }),
    ).toEqual({ valid: true });
    expect(adapter.validateConfig({})).toEqual({ valid: true });
    for (const bad of [
      null,
      'x',
      { timeoutMs: 50 },
      { timeoutMs: 120_000 },
      { timeoutMs: 1.5 },
      { unitCostAmount: '45' },
      { unitCostAmount: 45 },
      { unitCostAmount: '-1.00' },
      { apiEndpoint: 'ftp://x' },
      { apiEndpoint: 'not a url' },
    ]) {
      expect(adapter.validateConfig(bad).valid, JSON.stringify(bad)).toBe(false);
    }
  });

  it('P1-05 the health check reports whether the vault gave a key and never calls the bureau', async () => {
    const { adapter, sent } = setup([report()]);

    const ok = await adapter.checkHealth(config, { apiKey: API_KEY });
    const missing = await adapter.checkHealth(config, {});

    expect(ok.healthy).toBe(true);
    expect(missing).toMatchObject({ healthy: false, statusCode: 401 });
    expect(sent).toHaveLength(0);
    expect(JSON.stringify(ok)).not.toContain(API_KEY);
  });
});

describe('P1-05 the registry, the descriptor, the mock and the call-log masking', () => {
  it('P1-05 the registry serves BUREAU.SOFT_PULL through the real adapter and the mock, and the descriptor names both', () => {
    const registry = new IntegrationRegistry();

    expect(registry.getAdapter(BUREAU_PROVIDER_ID)?.supportedCapabilities).toEqual(['BUREAU.SOFT_PULL']);
    expect(registry.getAdapter('MOCK')?.supportedCapabilities).toContain('BUREAU.SOFT_PULL');
    const descriptor = STANDARD_CAPABILITY_DESCRIPTORS.find((d) => d.capability === 'BUREAU.SOFT_PULL');
    expect(descriptor?.supportedProviders).toEqual([BUREAU_PROVIDER_ID, 'MOCK']);
    expect(registry.getAdapter(BUREAU_PROVIDER_ID)?.simulated).toBeUndefined();
    expect(registry.isSimulated(registry.getAdapter('MOCK')!)).toBe(true);
  });

  it('P1-05 the mock returns a simulated report and never echoes the PAN, date of birth or name it was given', async () => {
    const res = await new MockTestAdapter().execute<unknown, BureauPullOutput>(
      'BUREAU.SOFT_PULL',
      input,
      {},
      credentials,
      context,
    );

    expect(res.success).toBe(true);
    expect(res.data).toMatchObject({ outcome: 'SCORED', summary: { score: 742 }, unitCost: null });
    expect(res.data?.vendorRef).toMatch(/^MOCK_BUREAU_/);
    noPersonalData(res);
  });

  it('P1-05 production refuses the mock and the development vault for a bureau pull before any call is made', async () => {
    const registry = new IntegrationRegistry(undefined, { nodeEnv: () => 'production' });
    const connection = (provider: string) =>
      ({
        id: 'itc_1',
        tenantId: 'ten_demo_01',
        provider,
        capability: 'BUREAU.SOFT_PULL',
        environment: 'PRODUCTION',
        credentialRef: 'vault://tenants/ten_demo_01/production/crif/credentials',
        config: {},
        status: 'ACTIVE',
      }) as never;

    await expect(
      registry.executeOperation(connection('MOCK'), 'BUREAU.SOFT_PULL', input, { correlationId: 'c1' }),
    ).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      message: expect.stringContaining('simulated'),
    });
    await expect(
      registry.executeOperation(connection(BUREAU_PROVIDER_ID), 'BUREAU.SOFT_PULL', input, {
        correlationId: 'c1',
      }),
    ).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      message: expect.stringContaining('development vault'),
    });
  });

  it('P1-05 the call-log masking hides a date of birth by its key and still masks a PAN, and leaves other values alone', () => {
    const masked = JSON.stringify(
      sanitizeProviderPayload({
        dateOfBirth: DOB,
        dob: DOB,
        date_of_birth: DOB,
        pan: PAN,
        bureau: 'CIBIL',
        clientData: { caseId: 'idem_1' },
      }),
    );

    expect(masked).not.toContain(DOB);
    expect(masked).not.toContain(PAN);
    expect(masked).toContain('QXZKW****L');
    expect(masked).toContain('CIBIL');
    expect(masked).toContain('idem_1');
  });
});
