// MOD-LND contacts and the completed lender fields, against a real database (owner: Dev 3).
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_ADMIN, startIsolationEnv, type IsolationEnv } from '../../../tests/isolation/harness';

let env: IsolationEnv;
beforeAll(async () => {
  env = await startIsolationEnv();
}, 180_000);
afterAll(async () => {
  await env?.stop();
});

const contact = (name: string, level = 1, extra: Record<string, unknown> = {}) => ({
  name,
  role: 'Relationship manager',
  email: `${name.toLowerCase().replace(/\s+/g, '.')}@lender.example.com`,
  phone: '+919876500001',
  channel: 'EMAIL',
  escalationLevel: level,
  ...extra,
});

describe('TEST-LND-CON contacts and lender fields', () => {
  it('TEST-LND-CON-01 new lender fields round-trip: global ref, permitted geos, agreement document', async () => {
    const a = env.appAs(env.A, ALL_ADMIN);
    const lender = await request(a)
      .post('/v1/lenders')
      .set('Idempotency-Key', 'con-lender-01')
      .send({ name: 'Fields Finance', lenderType: 'NBFC', globalLenderRef: 'GLOBAL-LN-77' });
    expect(lender.status).toBe(201);
    expect(lender.body.globalLenderRef).toBe('GLOBAL-LN-77');

    const emp = await request(a)
      .post(`/v1/lenders/${lender.body.id}/empanelments`)
      .set('Idempotency-Key', 'con-emp-01')
      .send({
        dsaCode: 'DSA-GEO',
        validFrom: '2026-01-01',
        permittedCategories: ['PL'],
        permittedGeos: ['MH-MUM', 'MH-PUN'],
        agreementDocumentId: 'doc_agreement_1',
      });
    expect(emp.status).toBe(201);
    expect(emp.body.permittedGeos).toEqual(['MH-MUM', 'MH-PUN']);
    expect(emp.body.agreementDocumentId).toBe('doc_agreement_1');
  });

  it('TEST-LND-CON-02 PUT replaces the list and keeps the old contacts as history', async () => {
    const a = env.appAs(env.A, ALL_ADMIN);
    const lender = await request(a)
      .post('/v1/lenders')
      .set('Idempotency-Key', 'con-lender-02')
      .send({ name: 'History Finance', lenderType: 'HFC' });
    const id = lender.body.id as string;

    const first = await request(a)
      .put(`/v1/lenders/${id}/contacts`)
      .set('If-Match', lender.headers.etag as string)
      .send({ contacts: [contact('Asha Rao', 1), contact('Vikram Shah', 2)] });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.data).toHaveLength(2);

    // The lender version moved with the replacement, so the old ETag is now stale.
    const stale = await request(a)
      .put(`/v1/lenders/${id}/contacts`)
      .set('If-Match', lender.headers.etag as string)
      .send({ contacts: [] });
    expect(stale.status).toBe(409);

    const second = await request(a)
      .put(`/v1/lenders/${id}/contacts`)
      .set('If-Match', first.headers.etag as string)
      .send({ contacts: [contact('Meera Iyer', 1)] });
    expect(second.status, JSON.stringify(second.body)).toBe(200);

    const current = await request(a).get(`/v1/lenders/${id}/contacts`);
    expect(current.body.data.map((c: { name: string }) => c.name)).toEqual(['Meera Iyer']);

    const history = await env.admin.query(
      `select name, removed_at is not null as closed from app.lender_contact where lender_id = $1 order by name`,
      [id],
    );
    expect(history.rows.map((r) => [r.name, r.closed])).toEqual([
      ['Asha Rao', true],
      ['Meera Iyer', false],
      ['Vikram Shah', true],
    ]);
  });

  it('TEST-LND-CON-03 contact details never reach the audit log; only counts do', async () => {
    const a = env.appAs(env.A, ALL_ADMIN);
    const lender = await request(a)
      .post('/v1/lenders')
      .set('Idempotency-Key', 'con-lender-03')
      .send({ name: 'Private Finance', lenderType: 'NBFC' });
    await request(a)
      .put(`/v1/lenders/${lender.body.id}/contacts`)
      .set('If-Match', lender.headers.etag as string)
      .send({
        contacts: [
          contact('Secret Person', 1, { email: 'secret.person@lender.example.com', phone: '+919811122233' }),
        ],
      });

    const audit = await env.admin.query(
      `select before::text as b, after::text as a from app.audit_event where entity_id = $1 and action = 'lender.contacts_replaced'`,
      [lender.body.id],
    );
    expect(audit.rows).toHaveLength(1);
    const text = `${audit.rows[0]!.b} ${audit.rows[0]!.a}`;
    expect(text).not.toContain('secret.person@lender.example.com');
    expect(text).not.toContain('+919811122233');
    expect(text).not.toContain('Secret Person');
  });

  it('TEST-LND-CON-04 a contact with an escalation level outside 1–3 is refused', async () => {
    const a = env.appAs(env.A, ALL_ADMIN);
    const lender = await request(a)
      .post('/v1/lenders')
      .set('Idempotency-Key', 'con-lender-04')
      .send({ name: 'Level Finance', lenderType: 'BANK' });
    const res = await request(a)
      .put(`/v1/lenders/${lender.body.id}/contacts`)
      .set('If-Match', lender.headers.etag as string)
      .send({ contacts: [contact('Too High', 4)] });
    expect(res.status).toBe(422);
  });
});
