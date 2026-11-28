// apps/api/test/verification-bank-outcome.spec.ts — P1-06, THE MONEY RULE of the bank penny drop. Which adapter answers mean "the Rs 1
// may have been sent" (stored as INCONCLUSIVE / OUTCOME_UNKNOWN, the Idempotency-Key is used up) and which prove nothing was sent (thrown,
// nothing stored, the same key can be retried). The real KarzaAdapter produces every answer from a fake fetch, so an adapter change that
// this classification does not know about fails here. No database and no network. The end-to-end run is in verification-kyc-check.int.spec.ts.
import { describe, expect, it } from 'vitest';
import { bankOutcomeIsUnknown } from '../src/modules/integrations/kyc-port';
import {
  KarzaAdapter,
  type FetchLike,
  type KarzaConfig,
  type KycCheckOutput,
} from '../src/modules/integrations/providers/karza-adapter';
import { checkTypeIsListed } from '../src/modules/origination/verifications/verification-service';

const ACCOUNT = '918273645019';
const IFSC = 'HDFC0001234';
const config: KarzaConfig = { apiEndpoint: 'https://kyc.example.test/v3/bank', timeoutMs: 2_000 };

type Reply = { status: number; body: string } | Error;
const json = (status: number, body: unknown): Reply => ({ status, body: JSON.stringify(body) });
const vendor = (statusCode: string, result: Record<string, unknown> = {}): Reply =>
  json(200, { request_id: 'req_bank_unit', 'status-code': statusCode, result });
const dropped = (code: string): Reply => Object.assign(new TypeError('fetch failed'), { cause: { code } });

/** One penny drop through the real adapter. `calls` counts the requests that would have left the machine. */
async function bankCall(
  reply: Reply,
  options: {
    input?: unknown;
    config?: KarzaConfig;
    credentials?: { apiKey?: string };
  } = {},
) {
  let calls = 0;
  const fetchImpl: FetchLike = async () => {
    calls++;
    if (reply instanceof Error) throw reply;
    return { status: reply.status, text: async () => reply.body };
  };
  const adapter = new KarzaAdapter({ fetchImpl, sleep: async () => {}, retryDelayMs: 0 });
  const result = await adapter.execute<unknown, KycCheckOutput>(
    'VERIFICATION.BANK',
    options.input ?? { accountNumber: ACCOUNT, ifsc: IFSC },
    options.config ?? config,
    options.credentials ?? { apiKey: 'unit-test-key' },
    { correlationId: 'idem_unit_0001', tenantId: 'ten_demo_01', environment: 'SANDBOX' },
  );
  return { result, calls };
}

describe('P1-06 the money rule: a bank check whose outcome is unknown is stored, never thrown', () => {
  const unknown: [string, Reply][] = [
    ['a timeout', Object.assign(new Error('timed out'), { name: 'TimeoutError' })],
    ['a connection dropped by the other side (ECONNRESET)', dropped('ECONNRESET')],
    ['a socket closed in the middle of the answer (UND_ERR_SOCKET)', dropped('UND_ERR_SOCKET')],
    [
      'a refused connection (the adapter cannot tell it from a drop, so it is treated as unknown)',
      dropped('ECONNREFUSED'),
    ],
    ['an error with no cause at all', new Error('boom')],
    ['HTTP 500', json(500, {})],
    ['HTTP 502', json(502, {})],
    ['HTTP 503', json(503, {})],
    ['HTTP 504', json(504, {})],
    ['HTTP 408', json(408, {})],
    ['an HTTP status nobody listed (409)', json(409, {})],
    ['an HTTP status nobody listed (418)', json(418, {})],
    ['HTTP 200 whose body is not JSON', { status: 200, body: 'upstream gateway timeout' }],
    ['HTTP 200 with an empty body', { status: 200, body: '' }],
    ['HTTP 200 with a JSON array instead of an object', json(200, [1, 2, 3])],
    ['a status-code the adapter does not know (999)', vendor('999')],
    [
      'a positive answer that does not say whether the Rs 1 went through',
      vendor('101', { accountName: 'RAVI KUMAR SHARMA' }),
    ],
  ];
  it.each(unknown)(
    'P1-06 %s: the Rs 1 may have been sent, so the outcome is unknown',
    async (_label, reply) => {
      const { result, calls } = await bankCall(reply);

      expect(calls).toBe(1);
      expect(result.success).toBe(false);
      expect(result.data).toBeDefined();
      expect(bankOutcomeIsUnknown(result)).toBe(true);
      // What is stored needs the masked account, which the adapter put into the error result, and never the account itself.
      expect(result.data?.identifierMasked).toBe('********5019');
      expect(JSON.stringify(result)).not.toContain(ACCOUNT);
    },
  );

  const notSent: [string, Reply][] = [
    ['HTTP 429 (rate limit)', json(429, {})],
    ['HTTP 400', json(400, {})],
    ['HTTP 422', json(422, {})],
    ['HTTP 404 (the endpoint is wrong)', json(404, {})],
    ['HTTP 401 (key refused)', json(401, {})],
    ['HTTP 403 (key refused)', json(403, {})],
    ['the vendor saying its source is busy (104)', vendor('104')],
    ['the vendor saying its source is unavailable (108)', vendor('108')],
  ];
  it.each(notSent)(
    'P1-06 %s: the request was refused before anything was done, so it is thrown',
    async (_label, reply) => {
      const { result, calls } = await bankCall(reply);

      expect(calls).toBe(1);
      expect(result.success).toBe(false);
      expect(bankOutcomeIsUnknown(result)).toBe(false);
    },
  );

  it('P1-06 an adapter that refuses before it calls the vendor (bad input, no endpoint, no key) sends nothing and is thrown', async () => {
    const refused: [string, Parameters<typeof bankCall>[1]][] = [
      ['an IFSC of the wrong shape', { input: { accountNumber: ACCOUNT, ifsc: 'HDFC1001234' } }],
      ['an account number of 8 digits', { input: { accountNumber: '12345678', ifsc: IFSC } }],
      ['no endpoint on the connection', { config: { timeoutMs: 2_000 } }],
      ['an endpoint that is not https', { config: { apiEndpoint: 'http://kyc.example.test/v3/bank' } }],
      ['no key in the vault', { credentials: {} }],
    ];
    for (const [label, options] of refused) {
      const { result, calls } = await bankCall(vendor('101', { bankTxnStatus: true }), options);
      expect(calls, label).toBe(0);
      expect(result.success, label).toBe(false);
      expect(result.data, label).toBeUndefined();
      expect(bankOutcomeIsUnknown(result), label).toBe(false);
    }
  });

  it('P1-06 a decision of the bank is not an error: verified, rejected, not found, not supported and a failed credit are all returned', async () => {
    const decisions: [string, Reply, string][] = [
      [
        'the Rs 1 credit went through',
        vendor('101', { bankTxnStatus: true, accountName: 'RAVI KUMAR SHARMA' }),
        'VERIFIED',
      ],
      ['an invalid account (102)', vendor('102'), 'MISMATCH'],
      ['an account the bank does not know (103)', vendor('103'), 'MISMATCH'],
      ['a bank that does not support the check (107)', vendor('107'), 'FAILED'],
      ['the Rs 1 credit failed', vendor('101', { bankTxnStatus: false }), 'FAILED'],
    ];
    for (const [label, reply, outcome] of decisions) {
      const { result } = await bankCall(reply);
      expect(result.success, label).toBe(true);
      expect(result.data?.outcome, label).toBe(outcome);
      expect(bankOutcomeIsUnknown(result), label).toBe(false);
    }
  });
});

describe('P1-06 the pre-flight check that the database can store a bank check', () => {
  const nine =
    "CHECK ((check_type = ANY (ARRAY['PAN'::text, 'GST'::text, 'CIN'::text, 'ITR'::text, 'BANK_STATEMENT'::text, 'BUREAU'::text, 'IDENTITY_DOCUMENT'::text, 'EMPLOYMENT'::text, 'ADDRESS'::text])))";
  const ten = nine.replace("'ADDRESS'::text]", "'ADDRESS'::text, 'BANK_ACCOUNT'::text]");

  it('P1-06 a list without BANK_ACCOUNT refuses the check, a list with it accepts it, and BANK_STATEMENT does not stand in for it', () => {
    expect(checkTypeIsListed([nine], 'BANK_ACCOUNT')).toBe(false);
    expect(checkTypeIsListed([ten], 'BANK_ACCOUNT')).toBe(true);
    expect(checkTypeIsListed([nine], 'BANK_STATEMENT')).toBe(true);
  });

  it('P1-06 every CHECK on the column must list it, and no CHECK at all means no restriction', () => {
    expect(checkTypeIsListed([ten, nine], 'BANK_ACCOUNT')).toBe(false);
    expect(checkTypeIsListed([ten, ten], 'BANK_ACCOUNT')).toBe(true);
    expect(checkTypeIsListed([], 'BANK_ACCOUNT')).toBe(true);
  });
});
