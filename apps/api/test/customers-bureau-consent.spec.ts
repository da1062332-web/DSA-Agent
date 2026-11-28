// apps/api/test/customers-bureau-consent.spec.ts — P1-05 (guest work in the customers lane, review: Bhushan). API-CUST-004 for the purpose
// BUREAU_PULL: a consent to pull a credit-bureau report, for ONE bureau named by purposeTarget. The earlier purposes are covered by
// customers.spec.ts, which stays unchanged; the cases here that touch them only prove that adding BUREAU_PULL changed nothing for them.
import { CREDIT_BUREAUS, type RequestContext, type Tx, type TxRunner } from '@dsa/contracts';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryCustomerRepository } from '../src/modules/crm/customers/repository';
import { CreateConsentSchema } from '../src/modules/crm/customers/types';
import { createTestApp, fakeAuth, testPrincipal } from './support/fake-auth';

const inMemoryTxRunner: TxRunner = {
  async withTenantTx<T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const tx = {} as any;
    tx.tenantId = ctx.principal.tenantId;
    return fn(tx as Tx);
  },
};

const principal = testPrincipal({
  tenantId: 'ten_01JTESTTENANTA0000000000000',
  grants: [
    { code: 'customer.create', scope: 'TENANT', branchIds: [] },
    { code: 'customer.read', scope: 'TENANT', branchIds: [] },
    { code: 'consent.record', scope: 'TENANT', branchIds: [] },
  ],
});

const base = { noticeVersion: 'NV-2026.1', channel: 'IN_PERSON' as const };

describe('P1-05 API-CUST-004: the schema of a BUREAU_PULL consent', () => {
  it('P1-05 each of the four bureaus is accepted as the target', () => {
    expect(CREDIT_BUREAUS).toEqual(['CIBIL', 'CRIF', 'EXPERIAN', 'EQUIFAX']);
    for (const bureau of CREDIT_BUREAUS) {
      const r = CreateConsentSchema.safeParse({ ...base, purpose: 'BUREAU_PULL', purposeTarget: bureau });

      expect(r.success).toBe(true);
      if (r.success) expect(r.data.purposeTarget).toBe(bureau);
    }
  });

  it('P1-05 a BUREAU_PULL consent without a target, with an empty one, or with something that is not a bureau is refused on purposeTarget', () => {
    for (const purposeTarget of [
      undefined,
      '',
      ' ',
      'TRANSUNION',
      'cibil',
      ' CIBIL',
      'CIBIL ',
      'LENDER_HDFC_01',
      'CIBIL,CRIF',
    ]) {
      const r = CreateConsentSchema.safeParse({ ...base, purpose: 'BUREAU_PULL', purposeTarget });

      expect(r.success, `target ${JSON.stringify(purposeTarget)}`).toBe(false);
      if (!r.success) {
        expect(r.error.issues).toHaveLength(1);
        expect(r.error.issues[0]?.path).toEqual(['purposeTarget']);
        // Fixed text: the value that was sent is not echoed.
        expect(r.error.issues[0]?.message).toContain('CIBIL, CRIF, EXPERIAN, EQUIFAX');
        if (typeof purposeTarget === 'string' && purposeTarget.trim()) {
          expect(r.error.issues[0]?.message).not.toContain(purposeTarget);
        }
      }
    }
  });

  it('P1-05 a target that is not text is refused too', () => {
    for (const purposeTarget of [1, true, ['CIBIL'], { bureau: 'CIBIL' }]) {
      expect(CreateConsentSchema.safeParse({ ...base, purpose: 'BUREAU_PULL', purposeTarget }).success).toBe(
        false,
      );
    }
  });

  it('P1-05 the five earlier purposes behave as they did: SHARE_WITH_LENDER and VERIFICATION_CHECK need a target (any text), the others take none', () => {
    for (const purpose of ['SHARE_WITH_LENDER', 'VERIFICATION_CHECK'] as const) {
      expect(CreateConsentSchema.safeParse({ ...base, purpose }).success).toBe(false);
      expect(
        CreateConsentSchema.safeParse({ ...base, purpose, purposeTarget: 'lender_HDFC_001' }).success,
      ).toBe(true);
      // The bureau list does not apply to them.
      expect(CreateConsentSchema.safeParse({ ...base, purpose, purposeTarget: 'TRANSUNION' }).success).toBe(
        true,
      );
    }
    for (const purpose of ['CONTACT', 'LOAN_PROCESSING', 'MARKETING'] as const) {
      expect(CreateConsentSchema.safeParse({ ...base, purpose }).success).toBe(true);
    }
  });

  it('P1-05 a purpose that is not in the list is still refused', () => {
    expect(
      CreateConsentSchema.safeParse({ ...base, purpose: 'BUREAU_SOFT_PULL', purposeTarget: 'CIBIL' }).success,
    ).toBe(false);
  });
});

describe('P1-05 API-CUST-004: recording a BUREAU_PULL consent over HTTP', () => {
  let repository: InMemoryCustomerRepository;
  let customerId: string;

  const getApp = () =>
    createTestApp({
      auth: fakeAuth(principal),
      deps: { txRunner: inMemoryTxRunner, customerRepository: repository },
    });

  const record = (body: Record<string, unknown>, key: string) =>
    request(getApp()).post(`/v1/customers/${customerId}/consents`).set('Idempotency-Key', key).send(body);

  beforeEach(async () => {
    repository = new InMemoryCustomerRepository();
    const res = await request(getApp())
      .post('/v1/customers')
      .set('Idempotency-Key', 'idem_p105_cust')
      .send({
        partyType: 'INDIVIDUAL',
        fullName: 'Rahul Sharma',
        homeBranchId: 'br_01JTESTBRANCH00000000000001',
      });
    customerId = res.body.id;
  });

  it('P1-05 records a BUREAU_PULL consent for each bureau: 201, the bureau as target, ACTIVE, with the audit and outbox rows', async () => {
    for (const [i, bureau] of CREDIT_BUREAUS.entries()) {
      const res = await record(
        { ...base, purpose: 'BUREAU_PULL', purposeTarget: bureau },
        `idem_p105_ok_${i}`,
      );

      expect(res.status).toBe(201);
      expect(res.body.id).toMatch(/^cnst_/);
      expect(res.body.purpose).toBe('BUREAU_PULL');
      expect(res.body.purposeTarget).toBe(bureau);
      expect(res.body.status).toBe('ACTIVE');
      expect(res.body.subjectId).toBe(customerId);
    }
    expect(repository.outboxEvents.filter((e) => e.event_type === 'consent.granted')).toHaveLength(4);
    expect(repository.auditEvents.filter((e) => e.action === 'consent.granted')).toHaveLength(4);
  });

  it('P1-05 a BUREAU_PULL consent without a bureau, or with one that is not a bureau, is 422 VALIDATION_ERROR on purposeTarget and echoes nothing', async () => {
    for (const [i, purposeTarget] of [undefined, '', 'TRANSUNION'].entries()) {
      const res = await record({ ...base, purpose: 'BUREAU_PULL', purposeTarget }, `idem_p105_bad_${i}`);

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details).toEqual([expect.objectContaining({ field: 'purposeTarget' })]);
      expect(JSON.stringify(res.body)).not.toContain('TRANSUNION');
    }
    // Nothing was recorded.
    expect(repository.outboxEvents.filter((e) => e.event_type === 'consent.granted')).toHaveLength(0);
  });

  it('P1-05 the consent is listed with its bureau, next to the consents of other purposes', async () => {
    await record({ ...base, purpose: 'CONTACT' }, 'idem_p105_l1');
    await record({ ...base, purpose: 'BUREAU_PULL', purposeTarget: 'CIBIL' }, 'idem_p105_l2');

    const res = await request(getApp()).get(`/v1/customers/${customerId}/consents`);

    expect(res.status).toBe(200);
    const bureau = res.body.data.filter((c: { purpose: string }) => c.purpose === 'BUREAU_PULL');
    expect(bureau).toHaveLength(1);
    expect(bureau[0].purposeTarget).toBe('CIBIL');
    expect(res.body.data.some((c: { purpose: string }) => c.purpose === 'CONTACT')).toBe(true);
  });

  it('P1-05 the same request with the same key is replayed, not recorded twice', async () => {
    const body = { ...base, purpose: 'BUREAU_PULL', purposeTarget: 'EQUIFAX' };
    const first = await record(body, 'idem_p105_replay');
    const second = await record(body, 'idem_p105_replay');

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body.id).toBe(first.body.id);
    expect(repository.outboxEvents.filter((e) => e.event_type === 'consent.granted')).toHaveLength(1);
  });

  it('P1-05 the same key with another bureau is 422 IDEMPOTENCY_KEY_REUSED', async () => {
    await record({ ...base, purpose: 'BUREAU_PULL', purposeTarget: 'CIBIL' }, 'idem_p105_reuse');
    const res = await record({ ...base, purpose: 'BUREAU_PULL', purposeTarget: 'CRIF' }, 'idem_p105_reuse');

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('P1-05 without consent.record the consent is not recorded (403), as for every purpose', async () => {
    const app = createTestApp({
      auth: fakeAuth(
        testPrincipal({
          tenantId: principal.tenantId,
          grants: [{ code: 'customer.read', scope: 'TENANT', branchIds: [] }],
        }),
      ),
      deps: { txRunner: inMemoryTxRunner, customerRepository: repository },
    });
    const res = await request(app)
      .post(`/v1/customers/${customerId}/consents`)
      .set('Idempotency-Key', 'idem_p105_403')
      .send({ ...base, purpose: 'BUREAU_PULL', purposeTarget: 'CIBIL' });

    expect(res.status).toBe(403);
  });

  it('P1-05 a BUREAU_PULL consent can be withdrawn like any other', async () => {
    const made = await record({ ...base, purpose: 'BUREAU_PULL', purposeTarget: 'CRIF' }, 'idem_p105_w1');
    const res = await request(getApp())
      .post(`/v1/consents/${made.body.id}/withdrawal`)
      .set('Idempotency-Key', 'idem_p105_w2')
      .send({ withdrawalReason: 'Customer asked' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('WITHDRAWN');
    expect(res.body.purposeTarget).toBe('CRIF');
  });
});
