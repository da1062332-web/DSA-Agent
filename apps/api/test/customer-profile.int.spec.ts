// TEST-CUST-P102-INT customer profile, encrypted identity, reveal and addresses (task P1-02) against a real database (migration 0110), with
// the production wiring. Synthetic data only: the PANs below are made-up values in the valid format.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startIsolationEnv, type IsolationEnv } from '../../../tests/isolation/harness';
import type { PermissionCode } from '@dsa/contracts';

let env: IsolationEnv;
const C1 = 'cust_p102_one';
const C2 = 'cust_p102_two';
const STAFF: PermissionCode[] = ['customer.read', 'customer.update'];
const key = (l: string) => `p102_${l}_${Math.random().toString(36).slice(2, 10)}`;
const PAN = 'ZZZPZ9999Z';

beforeAll(async () => {
  env = await startIsolationEnv();
  const a = env.A;
  for (const [id, name] of [
    [C1, 'Synthetic One'],
    [C2, 'Synthetic Two'],
  ]) {
    await env.admin.query(
      `insert into app.customer (id, tenant_id, party_type, full_name, home_branch_id, created_by, updated_by)
       values ($1, $2, 'INDIVIDUAL', $3, $4, $5, $5)`,
      [id, a.tenantId, name, a.branchId, a.userIds[0]],
    );
  }
}, 240_000);
afterAll(async () => {
  await env?.stop();
});

describe('TEST-CUST-P102-INT customer profile and identity', () => {
  it('TEST-CUST-P102-INT-01 profile: first save needs If-Match 0, a stale version is 409, money comes back as strings', async () => {
    const app = env.appAs(env.A, STAFF);
    const empty = await request(app).get(`/v1/customers/${C1}/profile`);
    expect(empty.status).toBe(200);
    expect(empty.headers.etag).toBe('"0"');
    const saved = await request(app)
      .put(`/v1/customers/${C1}/profile`)
      .set('If-Match', '"0"')
      .send({
        employmentType: 'SALARIED',
        employerName: 'Synthetic Systems',
        monthlyIncome: { amount: '60000.00', currency: 'INR' },
      });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.monthlyIncome).toEqual({ amount: '60000.00', currency: 'INR' });
    expect(saved.body.lockVersion).toBe(1);
    const stale = await request(app)
      .put(`/v1/customers/${C1}/profile`)
      .set('If-Match', '"0"')
      .send({ vintageMonths: 12 });
    expect(stale.status).toBe(409);
    const kept = await request(app)
      .put(`/v1/customers/${C1}/profile`)
      .set('If-Match', '"1"')
      .send({ vintageMonths: 12 });
    expect(kept.body.employerName).toBe('Synthetic Systems');
    expect(kept.body.vintageMonths).toBe(12);
  });

  it('TEST-CUST-P102-INT-02 identity: PAN and DOB stored encrypted, returned masked, never in clear in the table, the audit or the outbox', async () => {
    const app = env.appAs(env.A, STAFF);
    const res = await request(app)
      .put(`/v1/customers/${C1}/identity`)
      .set('If-Match', '"0"')
      .send({ pan: PAN.toLowerCase(), dateOfBirth: '1990-01-31' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.panMasked).toBe('ZZZPZ****Z');
    expect(res.body.birthYear).toBe(1990);
    expect(res.body.lockVersion).toBe(1);
    const stale = await request(app)
      .put(`/v1/customers/${C1}/identity`)
      .set('If-Match', '"0"')
      .send({ pan: PAN });
    expect(stale.status).toBe(409);
    expect(JSON.stringify(res.body)).not.toContain(PAN);
    expect(JSON.stringify(res.body)).not.toContain('1990-01-31');
    const stored = await env.admin.query(
      `select encode(pan_ciphertext, 'escape') as pan, encode(dob_ciphertext, 'escape') as dob from app.customer_identity where customer_id = $1`,
      [C1],
    );
    expect(JSON.stringify(stored.rows)).not.toContain(PAN);
    expect(JSON.stringify(stored.rows)).not.toContain('1990-01-31');
    const trail = await env.admin.query(
      `select (select coalesce(json_agg(a), '[]') from app.audit_event a where a.entity_id = $1)::text as audit,
              (select coalesce(json_agg(o), '[]') from app.outbox_event o where o.subject_id = $1)::text as outbox`,
      [C1],
    );
    expect(trail.rows[0].audit).not.toContain(PAN);
    expect(trail.rows[0].outbox).not.toContain(PAN);
  });

  it('TEST-CUST-P102-INT-03 the same PAN on a second customer is saved and flagged, never merged', async () => {
    const app = env.appAs(env.A, STAFF);
    const res = await request(app)
      .put(`/v1/customers/${C2}/identity`)
      .set('If-Match', '"0"')
      .send({ pan: PAN });
    expect(res.status).toBe(200);
    expect(res.body.possibleDuplicatePan).toBe(true);
    const both = await env.admin.query(`select status from app.customer where id in ($1, $2)`, [C1, C2]);
    expect(both.rows.every((r: { status: string }) => r.status === 'ACTIVE')).toBe(true);
  });

  it('TEST-CUST-P102-INT-04 reveal: with the permission and a fresh step-up the clear PAN comes back once, no-store, audited with the reason', async () => {
    const before = process.env.SUPABASE_MFA_ENABLED;
    process.env.SUPABASE_MFA_ENABLED = 'true';
    try {
      // The harness principal has just passed the authenticator check (authTime = now), so the step-up is fresh.
      const app = env.appAs(env.A, ['customer.read', 'customer.reveal_sensitive']);
      const res = await request(app)
        .post(`/v1/customers/${C1}/reveal`)
        .send({ field: 'PAN', reason: 'lender query 4471' });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.value).toBe(PAN);
      expect(res.headers['cache-control']).toContain('no-store');
      const audit = await env.admin.query(
        `select reason from app.audit_event where entity_id = $1 and action = 'customer.sensitive_revealed'`,
        [C1],
      );
      expect(audit.rows[0]?.reason).toBe('lender query 4471');
    } finally {
      if (before === undefined) delete process.env.SUPABASE_MFA_ENABLED;
      else process.env.SUPABASE_MFA_ENABLED = before;
    }
  });

  it('TEST-CUST-P102-INT-05 addresses: one live address per type; edit with If-Match; removal frees the type', async () => {
    const app = env.appAs(env.A, STAFF);
    const body = {
      addressType: 'CURRENT',
      line1: 'Flat 4, Shanti Nagar',
      city: 'Pune',
      state: 'Maharashtra',
      pincode: '411001',
    };
    const created = await request(app)
      .post(`/v1/customers/${C1}/addresses`)
      .set('Idempotency-Key', key('a1'))
      .send(body);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const dup = await request(app)
      .post(`/v1/customers/${C1}/addresses`)
      .set('Idempotency-Key', key('a2'))
      .send(body);
    expect(dup.status).toBe(422);
    const edited = await request(app)
      .patch(`/v1/customers/${C1}/addresses/${created.body.id}`)
      .set('If-Match', '"0"')
      .send({ city: 'Pimpri' });
    expect(edited.status).toBe(200);
    expect(edited.body.city).toBe('Pimpri');
    const removed = await request(app)
      .delete(`/v1/customers/${C1}/addresses/${created.body.id}`)
      .set('If-Match', '"1"');
    expect(removed.status).toBe(204);
    const again = await request(app)
      .post(`/v1/customers/${C1}/addresses`)
      .set('Idempotency-Key', key('a3'))
      .send(body);
    expect(again.status).toBe(201);
  });

  it('TEST-CUST-P102-INT-06 another tenant gets 404 on every path', async () => {
    const appB = env.appAs(env.B, [...STAFF, 'customer.reveal_sensitive']);
    for (const res of [
      await request(appB).get(`/v1/customers/${C1}/profile`),
      await request(appB).get(`/v1/customers/${C1}/identity`),
      await request(appB).get(`/v1/customers/${C1}/addresses`),
      await request(appB).put(`/v1/customers/${C1}/identity`).set('If-Match', '"1"').send({ pan: PAN }),
    ]) {
      expect(res.status).toBe(404);
    }
  });
});
