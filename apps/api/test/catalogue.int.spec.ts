// MOD-LND Lenders against a real database (owner: Dev 3). Each run gets a throwaway PostgreSQL 16 container with
// every migration applied, connected as dsa_api, so row-level security applies as in production.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { assertLenderOpenForCases } from '../src/modules/origination/catalogue/gates';
import { createTxRunner } from '../src/kernel-min/tx-runner';
import { testPrincipal } from './support/fake-auth';
import { ALL_ADMIN, startIsolationEnv, type IsolationEnv } from '../../../tests/isolation/harness';

let env: IsolationEnv;
beforeAll(async () => {
  env = await startIsolationEnv();
}, 180_000);
afterAll(async () => {
  await env?.stop();
});

const key = (n: string) => `lnd-int-${n}-000001`;
const etag = (res: request.Response) => res.headers.etag as string;

describe('TEST-LND-INT lenders and empanelments against the database', () => {
  it('TEST-LND-INT-01 creates a lender; the same Idempotency-Key replays the original', async () => {
    const a = env.appAs(env.A, ALL_ADMIN);
    const body = { name: 'Bajaj Finance', lenderType: 'NBFC', regulatorRef: 'RBI-NBFC-001' };
    const first = await request(a).post('/v1/lenders').set('Idempotency-Key', key('replay')).send(body);
    expect(first.status).toBe(201);
    expect(first.body.status).toBe('ACTIVE');
    expect(first.body.version).toBe(0);

    const again = await request(a).post('/v1/lenders').set('Idempotency-Key', key('replay')).send(body);
    expect(again.status).toBe(201);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(again.body.id).toBe(first.body.id);
  });

  it('TEST-LND-INT-02 a duplicate lender name in the same tenant is 409', async () => {
    const a = env.appAs(env.A, ALL_ADMIN);
    const res = await request(a)
      .post('/v1/lenders')
      .set('Idempotency-Key', key('dup'))
      .send({ name: 'Bajaj Finance', lenderType: 'BANK' });
    expect(res.status).toBe(409);
  });

  it('TEST-LND-INT-03 tenant B cannot see, change or list tenant A lenders (404, not 403)', async () => {
    const aAdmin = env.appAs(env.A, ALL_ADMIN);
    const created = await request(aAdmin)
      .post('/v1/lenders')
      .set('Idempotency-Key', key('iso'))
      .send({ name: 'Isolated Lender Co', lenderType: 'HFC' });
    const id = created.body.id as string;

    const b = env.appAs(env.B, ALL_ADMIN);
    expect((await request(b).get(`/v1/lenders/${id}`)).status).toBe(404);
    expect(
      (await request(b).patch(`/v1/lenders/${id}`).set('If-Match', '"0"').send({ name: 'Hijacked' })).status,
    ).toBe(404);
    const list = await request(b).get('/v1/lenders');
    expect(list.body.data.map((l: { id: string }) => l.id)).not.toContain(id);
  });

  it('TEST-LND-INT-04 a stale If-Match is 409 and changes nothing', async () => {
    const a = env.appAs(env.A, ALL_ADMIN);
    const created = await request(a)
      .post('/v1/lenders')
      .set('Idempotency-Key', key('stale'))
      .send({ name: 'Stale Lender Co', lenderType: 'NBFC' });
    const ok = await request(a)
      .patch(`/v1/lenders/${created.body.id}`)
      .set('If-Match', etag(created))
      .send({ name: 'Stale Lender Ltd' });
    expect(ok.status).toBe(200);
    expect(ok.body.version).toBe(1);

    const stale = await request(a)
      .patch(`/v1/lenders/${created.body.id}`)
      .set('If-Match', etag(created))
      .send({ name: 'Too Late' });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    const now = await request(a).get(`/v1/lenders/${created.body.id}`);
    expect(now.body.name).toBe('Stale Lender Ltd');
  });

  it('TEST-LND-INT-05 pausing needs a reason and is audited; the reason is stored', async () => {
    const a = env.appAs(env.A, ALL_ADMIN);
    const created = await request(a)
      .post('/v1/lenders')
      .set('Idempotency-Key', key('pause'))
      .send({ name: 'Pausable Finance', lenderType: 'NBFC' });
    const paused = await request(a)
      .patch(`/v1/lenders/${created.body.id}`)
      .set('If-Match', etag(created))
      .send({ status: 'PAUSED', statusReason: 'RBI inspection pending' });
    expect(paused.status).toBe(200);
    expect(paused.body.status).toBe('PAUSED');
    expect(paused.body.statusReason).toBe('RBI inspection pending');

    const audit = await env.admin.query(
      `select action, reason from app.audit_event where entity_id = $1 order by occurred_at`,
      [created.body.id],
    );
    expect(audit.rows.map((r) => r.action)).toEqual(['lender.created', 'lender.status_changed']);
    expect(audit.rows[1].reason).toBe('RBI inspection pending');
  });

  it('TEST-LND-INT-06 empanelment: created with validity and categories; duplicate DSA code is 409', async () => {
    const a = env.appAs(env.A, ALL_ADMIN);
    const lender = await request(a)
      .post('/v1/lenders')
      .set('Idempotency-Key', key('emp-lender'))
      .send({ name: 'Empanel Finance', lenderType: 'NBFC' });
    const body = {
      dsaCode: 'DSA-001',
      validFrom: '2026-01-01',
      validTo: '2026-12-31',
      permittedCategories: ['PL', 'BL'],
    };
    const emp = await request(a)
      .post(`/v1/lenders/${lender.body.id}/empanelments`)
      .set('Idempotency-Key', key('emp-1'))
      .send(body);
    expect(emp.status).toBe(201);
    expect(emp.body.validFrom).toBe('2026-01-01');
    expect(emp.body.validTo).toBe('2026-12-31');
    expect(emp.body.permittedCategories).toEqual(['PL', 'BL']);

    const dup = await request(a)
      .post(`/v1/lenders/${lender.body.id}/empanelments`)
      .set('Idempotency-Key', key('emp-2'))
      .send(body);
    expect(dup.status).toBe(409);
  });

  it('TEST-LND-INT-07 empanelment end date can move, but not before the start date', async () => {
    const a = env.appAs(env.A, ALL_ADMIN);
    const lender = await request(a)
      .post('/v1/lenders')
      .set('Idempotency-Key', key('move-lender'))
      .send({ name: 'Moving Finance', lenderType: 'NBFC' });
    const emp = await request(a)
      .post(`/v1/lenders/${lender.body.id}/empanelments`)
      .set('Idempotency-Key', key('move-emp'))
      .send({
        dsaCode: 'DSA-MOVE',
        validFrom: '2026-01-01',
        validTo: '2026-06-30',
        permittedCategories: ['PL'],
      });

    const bad = await request(a)
      .patch(`/v1/empanelments/${emp.body.id}`)
      .set('If-Match', etag(emp))
      .send({ validTo: '2025-12-31' });
    expect(bad.status).toBe(422);

    const ok = await request(a)
      .patch(`/v1/empanelments/${emp.body.id}`)
      .set('If-Match', etag(emp))
      .send({ validTo: '2026-12-31' });
    expect(ok.status).toBe(200);
    expect(ok.body.validTo).toBe('2026-12-31');
    expect(ok.body.version).toBe(1); // one update, one version bump
  });

  it('TEST-LND-INT-08 the case gate: paused lender and missing empanelment are refused, a valid one passes', async () => {
    const a = env.appAs(env.A, ALL_ADMIN);
    const lender = await request(a)
      .post('/v1/lenders')
      .set('Idempotency-Key', key('gate-lender'))
      .send({ name: 'Gate Finance', lenderType: 'NBFC' });
    const id = lender.body.id as string;
    await request(a)
      .post(`/v1/lenders/${id}/empanelments`)
      .set('Idempotency-Key', key('gate-emp'))
      .send({
        dsaCode: 'DSA-GATE',
        validFrom: '2026-01-01',
        validTo: '2026-12-31',
        permittedCategories: ['PL'],
      });

    const runner = createTxRunner(env.db);
    const ctx = {
      principal: testPrincipal({ tenantId: env.A.tenantId, id: env.A.userIds[0] }),
      correlationId: 'gate-test-0001',
      now: new Date(),
    };
    const gate = (input: { category: string; on: string }) =>
      runner.withTenantTx(ctx, (tx) => assertLenderOpenForCases(tx, { lenderId: id, ...input }));

    await expect(gate({ category: 'PL', on: '2026-06-15' })).resolves.toBeUndefined();
    await expect(gate({ category: 'BL', on: '2026-06-15' })).rejects.toMatchObject({
      code: 'EMPANELMENT_INACTIVE',
    });
    await expect(gate({ category: 'PL', on: '2027-01-15' })).rejects.toMatchObject({
      code: 'EMPANELMENT_INACTIVE',
    });

    await request(a)
      .patch(`/v1/lenders/${id}`)
      .set('If-Match', etag(lender))
      .send({ status: 'PAUSED', statusReason: 'Under review' });
    await expect(gate({ category: 'PL', on: '2026-06-15' })).rejects.toMatchObject({ code: 'LENDER_PAUSED' });
  });
});
