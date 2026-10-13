// Empanelment deactivate, reactivate and terminate, and contact removal, against a real database (owner: Dev 3).
// History is kept: empanelments are never deleted, and contacts are soft-removed (removed_at).
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTxRunner } from '../src/kernel-min/tx-runner';
import { assertLenderOpenForCases } from '../src/modules/origination/catalogue/gates';
import { testPrincipal } from './support/fake-auth';
import { ALL_ADMIN, startIsolationEnv, type IsolationEnv } from '../../../tests/isolation/harness';

let env: IsolationEnv;
beforeAll(async () => {
  env = await startIsolationEnv();
}, 180_000);
afterAll(async () => {
  await env?.stop();
});

const etag = (res: request.Response) => res.headers.etag as string;
const today = () => new Date().toISOString().slice(0, 10);

async function lenderWithEmpanelment(app: ReturnType<IsolationEnv['appAs']>, name: string) {
  const slug = name
    .split('')
    .filter((ch) => /[a-z0-9]/i.test(ch))
    .join('')
    .toLowerCase();
  const lender = await request(app)
    .post('/v1/lenders')
    .set('Idempotency-Key', `life-${slug}-l`)
    .send({ name, lenderType: 'NBFC' });
  const emp = await request(app)
    .post(`/v1/lenders/${lender.body.id}/empanelments`)
    .set('Idempotency-Key', `life-${slug}-e`)
    .send({
      dsaCode: `DSA-${name.replace(/\W/g, '').toUpperCase().slice(0, 12)}`,
      validFrom: '2026-01-01',
      permittedCategories: ['PL'],
    });
  return { lender: lender.body.id as string, emp };
}

describe('TEST-LND-LIFE empanelment lifecycle and contact removal', () => {
  it('TEST-LND-LIFE-01 deactivate needs a reason, then is audited and blocks new cases', async () => {
    const a = env.appAs(env.A, ALL_ADMIN);
    const { lender, emp } = await lenderWithEmpanelment(a, 'Deactivate Co');

    const noReason = await request(a)
      .patch(`/v1/empanelments/${emp.body.id}`)
      .set('If-Match', etag(emp))
      .send({ status: 'SUSPENDED' });
    expect(noReason.status).toBe(422);

    const off = await request(a)
      .patch(`/v1/empanelments/${emp.body.id}`)
      .set('If-Match', etag(emp))
      .send({ status: 'SUSPENDED', reason: 'Audit pending' });
    expect(off.status).toBe(200);
    expect(off.body.status).toBe('SUSPENDED');

    const audit = await env.admin.query(
      `select action, reason from app.audit_event where entity_id = $1 order by occurred_at desc limit 1`,
      [emp.body.id],
    );
    expect(audit.rows[0]).toEqual({ action: 'empanelment.deactivated', reason: 'Audit pending' });

    const gate = createTxRunner(env.db);
    const ctx = {
      principal: testPrincipal({ tenantId: env.A.tenantId }),
      correlationId: 'life-gate-01',
      now: new Date(),
    };
    await expect(
      gate.withTenantTx(ctx, (tx) =>
        assertLenderOpenForCases(tx, { lenderId: lender, category: 'PL', on: '2026-06-15' }),
      ),
    ).rejects.toMatchObject({ code: 'EMPANELMENT_INACTIVE' });
  });

  it('TEST-LND-LIFE-02 reactivating a suspended empanelment restores it and is audited', async () => {
    const a = env.appAs(env.A, ALL_ADMIN);
    const { emp } = await lenderWithEmpanelment(a, 'Reactivate Co');
    const off = await request(a)
      .patch(`/v1/empanelments/${emp.body.id}`)
      .set('If-Match', etag(emp))
      .send({ status: 'SUSPENDED', reason: 'Temporary hold' });
    const on = await request(a)
      .patch(`/v1/empanelments/${emp.body.id}`)
      .set('If-Match', etag(off))
      .send({ status: 'ACTIVE' });
    expect(on.status).toBe(200);
    expect(on.body.status).toBe('ACTIVE');
    const audit = await env.admin.query(
      `select action from app.audit_event where entity_id = $1 order by occurred_at desc limit 1`,
      [emp.body.id],
    );
    expect(audit.rows[0]!.action).toBe('empanelment.reactivated');
  });

  it('TEST-LND-LIFE-03 terminate ends the empanelment today, is final, and keeps the row', async () => {
    const a = env.appAs(env.A, ALL_ADMIN);
    const { emp } = await lenderWithEmpanelment(a, 'Terminate Co');

    const noReason = await request(a)
      .patch(`/v1/empanelments/${emp.body.id}`)
      .set('If-Match', etag(emp))
      .send({ status: 'EXPIRED' });
    expect(noReason.status).toBe(422);

    const term = await request(a)
      .patch(`/v1/empanelments/${emp.body.id}`)
      .set('If-Match', etag(emp))
      .send({ status: 'EXPIRED', reason: 'DSA agreement ended' });
    expect(term.status).toBe(200);
    expect(term.body.status).toBe('EXPIRED');
    expect(term.body.validTo).toBe(today());

    const back = await request(a)
      .patch(`/v1/empanelments/${emp.body.id}`)
      .set('If-Match', etag(term))
      .send({ status: 'ACTIVE' });
    expect(back.status).toBe(409);
    expect(back.body.error.code).toBe('INVALID_TRANSITION');

    const rows = await env.admin.query(`select count(*)::int as n from app.empanelment where id = $1`, [
      emp.body.id,
    ]);
    expect(rows.rows[0]!.n).toBe(1);
    const audit = await env.admin.query(
      `select action, reason from app.audit_event where entity_id = $1 order by occurred_at desc limit 1`,
      [emp.body.id],
    );
    expect(audit.rows[0]).toEqual({ action: 'empanelment.terminated', reason: 'DSA agreement ended' });
  });

  it('TEST-LND-LIFE-04 removing a contact keeps its row, hides it, and audits without personal data', async () => {
    const a = env.appAs(env.A, ALL_ADMIN);
    const lender = await request(a)
      .post('/v1/lenders')
      .set('Idempotency-Key', 'life-con-l')
      .send({ name: 'Contact Remove Co', lenderType: 'BANK' });
    const put = await request(a)
      .put(`/v1/lenders/${lender.body.id}/contacts`)
      .set('If-Match', etag(lender))
      .send({
        contacts: [
          { name: 'Keep Me', escalationLevel: 1 },
          {
            name: 'Remove Me Person',
            email: 'remove.me@lender.example.com',
            phone: '+919811100011',
            escalationLevel: 2,
          },
        ],
      });
    const target = put.body.data.find((c: { name: string }) => c.name === 'Remove Me Person');

    const del = await request(a)
      .delete(`/v1/lenders/${lender.body.id}/contacts/${target.id}`)
      .set('If-Match', etag(put));
    expect(del.status).toBe(200);
    expect(del.body.removedId).toBe(target.id);

    const current = await request(a).get(`/v1/lenders/${lender.body.id}/contacts`);
    expect(current.body.data.map((c: { name: string }) => c.name)).toEqual(['Keep Me']);

    const row = await env.admin.query(
      `select removed_at is not null as closed from app.lender_contact where id = $1`,
      [target.id],
    );
    expect(row.rows[0]!.closed).toBe(true);

    const audit = await env.admin.query(
      `select action, before::text as b, after::text as a from app.audit_event where entity_id = $1 and action = 'lender.contact_removed'`,
      [lender.body.id],
    );
    expect(audit.rows).toHaveLength(1);
    const text = `${audit.rows[0]!.b} ${audit.rows[0]!.a}`;
    expect(text).not.toContain('remove.me@lender.example.com');
    expect(text).not.toContain('+919811100011');
    expect(text).not.toContain('Remove Me Person');
  });

  it('TEST-LND-LIFE-05 a stale version, an unknown contact and a foreign lender contact are refused', async () => {
    const a = env.appAs(env.A, ALL_ADMIN);
    const lender = await request(a)
      .post('/v1/lenders')
      .set('Idempotency-Key', 'life-con-l2')
      .send({ name: 'Refuse Remove Co', lenderType: 'HFC' });
    const put = await request(a)
      .put(`/v1/lenders/${lender.body.id}/contacts`)
      .set('If-Match', etag(lender))
      .send({ contacts: [{ name: 'Only Person', escalationLevel: 1 }] });
    const contactId = put.body.data[0].id as string;

    const stale = await request(a)
      .delete(`/v1/lenders/${lender.body.id}/contacts/${contactId}`)
      .set('If-Match', etag(lender));
    expect(stale.status).toBe(409);

    const unknown = await request(a)
      .delete(`/v1/lenders/${lender.body.id}/contacts/lct_01NOTAREALCONTACT0000000`)
      .set('If-Match', etag(put));
    expect(unknown.status).toBe(404);

    const other = await request(a)
      .post('/v1/lenders')
      .set('Idempotency-Key', 'life-con-other')
      .send({ name: 'Other Co', lenderType: 'SFB' });
    const foreign = await request(a)
      .delete(`/v1/lenders/${other.body.id}/contacts/${contactId}`)
      .set('If-Match', etag(other));
    expect(foreign.status).toBe(404);
  });

  it('TEST-LND-LIFE-06 without config.manage nothing can be deactivated, terminated or removed', async () => {
    const a = env.appAs(env.A, ALL_ADMIN);
    const viewer = env.appAs(env.A, []);
    const { emp } = await lenderWithEmpanelment(a, 'Viewer Co');
    const off = await request(viewer)
      .patch(`/v1/empanelments/${emp.body.id}`)
      .set('If-Match', etag(emp))
      .send({ status: 'SUSPENDED', reason: 'nope' });
    expect(off.status).toBe(403);

    const lender = await request(a)
      .post('/v1/lenders')
      .set('Idempotency-Key', 'life-viewer-l')
      .send({ name: 'Viewer Contacts Co', lenderType: 'NBFC' });
    const put = await request(a)
      .put(`/v1/lenders/${lender.body.id}/contacts`)
      .set('If-Match', etag(lender))
      .send({ contacts: [{ name: 'Guarded', escalationLevel: 1 }] });
    const del = await request(viewer)
      .delete(`/v1/lenders/${lender.body.id}/contacts/${put.body.data[0].id}`)
      .set('If-Match', etag(put));
    expect(del.status).toBe(403);
  });
});
