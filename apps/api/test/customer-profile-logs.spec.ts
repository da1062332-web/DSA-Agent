// TEST-CUST-P102-LOG a PAN or date of birth sent to the P1-02 endpoints never reaches the logs (task P1-02, Contracts §12). The API runs
// with a real pino request logger writing to memory, and console.error is captured, while requests carry a PAN and a date of birth
// through every outcome: a server error, a validation error, a refused reveal and a permission refusal. Synthetic values only.
import { Writable } from 'node:stream';
import type { RequestContext, Tx, TxRunner } from '@dsa/contracts';
import pino from 'pino';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { InMemoryCustomerRepository } from '../src/modules/crm/customers/repository';
import { fakeAuth, testDeps, testPrincipal } from './support/fake-auth';

const PAN = 'ZZZPZ9999Z';
const DOB = '1990-01-31';
const TENANT = 'ten_01JTESTTENANTA0000000000000';

// Raw SQL on this transaction fails, so the identity save takes the 500 path and the error handler logs it.
const inMemoryTxRunner: TxRunner = {
  async withTenantTx<T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return fn({ tenantId: ctx.principal.tenantId } as unknown as Tx);
  },
};

describe('TEST-CUST-P102-LOG identity data never reaches the logs', () => {
  let lines: string[];
  let consoleErrors: unknown[][];
  let mfaBefore: string | undefined;

  beforeEach(() => {
    lines = [];
    consoleErrors = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      consoleErrors.push(args);
    });
    mfaBefore = process.env.SUPABASE_MFA_ENABLED;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    if (mfaBefore === undefined) delete process.env.SUPABASE_MFA_ENABLED;
    else process.env.SUPABASE_MFA_ENABLED = mfaBefore;
  });

  function appFor(codes: string[]) {
    const sink = new Writable({
      write(chunk, _enc, done) {
        lines.push(String(chunk));
        done();
      },
    });
    const logger = pino({ level: 'debug' }, sink);
    const principal = testPrincipal({
      tenantId: TENANT,
      grants: codes.map((code) => ({ code: code as never, scope: 'TENANT' as const, branchIds: [] })),
    });
    return createApp({
      deps: testDeps({ txRunner: inMemoryTxRunner, customerRepository: new InMemoryCustomerRepository() }),
      corsAllowedOrigins: [],
      auth: fakeAuth(principal),
      logger,
    });
  }

  const everything = () => lines.join('\n') + '\n' + JSON.stringify(consoleErrors);

  it('TEST-CUST-P102-LOG-01 no PAN or date of birth in any log line, whatever the outcome', async () => {
    const app = appFor(['customer.create', 'customer.read', 'customer.update', 'customer.reveal_sensitive']);
    const created = await request(app)
      .post('/v1/customers')
      .set('Idempotency-Key', 'idem-p102-log-0001')
      .send({
        partyType: 'INDIVIDUAL',
        fullName: 'Synthetic Person',
        homeBranchId: 'br_01JTESTBRANCH00000000000001',
      });
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    // A server error while saving a valid PAN and date of birth (500, logged with a stack).
    const failed = await request(app)
      .put(`/v1/customers/${id}/identity`)
      .set('If-Match', '"0"')
      .send({ pan: PAN, dateOfBirth: DOB });
    expect(failed.status).toBe(500);
    // Validation errors that carry a PAN: an Aadhaar key, a PAN in free text, a malformed PAN.
    const aadhaar = await request(app)
      .put(`/v1/customers/${id}/identity`)
      .set('If-Match', '"0"')
      .send({ pan: PAN, aadhaar: '1234 5678 9012' });
    expect(aadhaar.status).toBe(422);
    const freeText = await request(app)
      .post(`/v1/customers/${id}/reveal`)
      .send({ field: 'PAN', reason: `lender asked about ${PAN}` });
    expect(freeText.status).toBe(422);
    const profile = await request(app)
      .put(`/v1/customers/${id}/profile`)
      .set('If-Match', '"0"')
      .send({ pan: PAN });
    expect(profile.status).toBe(422);
    // A reveal refused because the project has no second factor.
    process.env.SUPABASE_MFA_ENABLED = 'false';
    const refused = await request(app)
      .post(`/v1/customers/${id}/reveal`)
      .send({ field: 'PAN', reason: 'lender query 4471' });
    expect(refused.status).toBe(403);

    expect(lines.length).toBeGreaterThanOrEqual(5);
    const text = everything();
    expect(text).not.toContain(PAN);
    expect(text.toLowerCase()).not.toContain(PAN.toLowerCase());
    expect(text).not.toContain(DOB);
    expect(text).not.toContain('1234 5678 9012');
  });

  it('TEST-CUST-P102-LOG-02 the error responses do not echo the PAN either', async () => {
    const app = appFor(['customer.read', 'customer.update']);
    const res = await request(app)
      .put('/v1/customers/cust_unknown/identity')
      .set('If-Match', '"0"')
      .send({ pan: 'ZZZPZ9999' });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).not.toContain('ZZZPZ9999');
  });
});
