// MOD-APP creation (API-APP-001), parties (API-APP-006), ownership (API-APP-011) and transitions T-APP-04, 08 and 09 against a
// real database (M-071), with the production wiring. Synthetic data only.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startIsolationEnv, type IsolationEnv } from '../../../tests/isolation/harness';
import type { PermissionCode } from '@dsa/contracts';

let env: IsolationEnv;
const PRIMARY = 'cust_apc_int_1';
const CO = 'cust_apc_int_2';
const ENTITY = 'cust_apc_int_3';
const PV = 'prv_apc_int_1';

beforeAll(async () => {
  env = await startIsolationEnv();
  const a = env.A;
  for (const [id, type, name] of [
    [PRIMARY, 'INDIVIDUAL', 'Primary Applicant'],
    [CO, 'INDIVIDUAL', 'Co Applicant'],
    [ENTITY, 'ENTITY', 'Entity Applicant Pvt Ltd'],
  ]) {
    await env.admin.query(
      `insert into app.customer (id, tenant_id, party_type, full_name, home_branch_id, created_by, updated_by)
       values ($1, $2, $3, $4, $5, $6, $6)`,
      [id, a.tenantId, type, name, a.branchId, a.userIds[0]],
    );
  }
  await env.admin.query(
    `insert into app.lender (id, tenant_id, name, lender_type, created_by, updated_by)
     values ('lnd_apc_int_1', $1, 'Party Lender', 'NBFC', $2, $2)`,
    [a.tenantId, a.userIds[0]],
  );
  await env.admin.query(
    `insert into app.loan_product (id, tenant_id, lender_id, name, category, applicant_types, secured, status, created_by, updated_by)
     values ('prd_apc_int_1', $1, 'lnd_apc_int_1', 'Party Product', 'PL', '{SALARIED}', false, 'ACTIVE', $2, $2)`,
    [a.tenantId, a.userIds[0]],
  );
  await env.admin.query(
    `insert into app.loan_product_version (id, tenant_id, product_id, version_no, effective_from, amount_min, amount_max,
                                           currency, tenure_min_months, tenure_max_months, created_by)
     values ($1, $2, 'prd_apc_int_1', 1, '2026-01-01T00:00:00Z', 50000, 1000000, 'INR', 12, 60, $3)`,
    [PV, a.tenantId, a.userIds[0]],
  );
}, 240_000);
afterAll(async () => {
  await env?.stop();
});

const STAFF: PermissionCode[] = [
  'application.create',
  'application.read',
  'application.update',
  'application.review',
  'application.assign',
  'application.withdraw',
  'application.reopen',
];
const key = (l: string) => `apc_${l}_${Math.random().toString(36).slice(2, 10)}`;
const create = (body: Record<string, unknown>, codes = STAFF) =>
  request(env.appAs(env.A, codes))
    .post('/v1/applications')
    .set('Idempotency-Key', key('create'))
    .send({
      customerId: PRIMARY,
      branchId: env.A.branchId,
      productCategory: 'PL',
      requestedAmount: { amount: '300000.00', currency: 'INR' },
      applicantType: 'SALARIED',
      ...body,
    });

describe('TEST-APP-PTY-INT applications, parties and ownership', () => {
  let appId = '';
  let version = 0;

  it('TEST-APP-PTY-INT-01 API-APP-001 creates a draft with its primary party, history, outbox and audit; a replay returns it', async () => {
    const k = key('replay');
    const send = () =>
      request(env.appAs(env.A, STAFF))
        .post('/v1/applications')
        .set('Idempotency-Key', k)
        .send({
          customerId: PRIMARY,
          branchId: env.A.branchId,
          productCategory: 'PL',
          requestedAmount: { amount: '300000.00', currency: 'INR' },
          applicantType: 'SALARIED',
        });
    const res = await send();
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      status: 'DRAFT',
      customerId: PRIMARY,
      leadId: null,
      salesOwnerId: env.A.userIds[0],
    });
    expect(res.headers.etag).toBe(`"${res.body.version}"`);
    appId = res.body.id;
    version = res.body.version;

    const again = await send();
    expect(again.status).toBe(201);
    expect(again.body.id).toBe(appId);
    expect(again.headers['idempotent-replayed']).toBe('true');

    const parties = await env.admin.query(
      `select role, customer_id from app.application_party where application_id = $1`,
      [appId],
    );
    expect(parties.rows).toEqual([{ role: 'PRIMARY', customer_id: PRIMARY }]);
    const history = await env.admin.query(
      `select transition_code, reason_code from app.application_status_history where application_id = $1`,
      [appId],
    );
    expect(history.rows).toEqual([{ transition_code: 'CREATE', reason_code: 'DIRECT' }]);
    const evt = await env.admin.query(
      `select count(*)::int as n from app.outbox_event where subject_id = $1 and event_type = 'application.created'`,
      [appId],
    );
    expect(evt.rows[0].n).toBe(1);
    const aud = await env.admin.query(
      `select count(*)::int as n from app.audit_event where entity_id = $1 and action = 'application.created'`,
      [appId],
    );
    expect(aud.rows[0].n).toBe(1);
  });

  it('TEST-APP-PTY-INT-02 API-APP-001 refuses an unknown customer (404), a mismatched applicant type or an owner outside the branch (422), and no create code (403)', async () => {
    const unknown = await create({ customerId: 'cust_missing_1' });
    expect(unknown.status).toBe(404);
    const mismatch = await create({ customerId: ENTITY });
    expect(mismatch.status).toBe(422);
    expect(mismatch.body.error.details[0].issue).toBe('PARTY_TYPE_MISMATCH');
    const otherTenantBranch = await create({ branchId: env.B.branchId });
    expect(otherTenantBranch.status).toBe(422); // the sales owner does not work in that branch
    const noCode = await create({}, ['application.read']);
    expect(noCode.status).toBe(403);
  });

  it('TEST-APP-PTY-INT-03 API-APP-006 adds a co-applicant, refuses a duplicate, and removes it without deleting the row', async () => {
    const app = env.appAs(env.A, STAFF);
    const stale = await request(app)
      .post(`/v1/applications/${appId}/parties`)
      .set('Idempotency-Key', key('stale'))
      .set('If-Match', `"${version + 5}"`)
      .send({ action: 'ADD', customerId: CO, role: 'CO_APPLICANT' });
    expect(stale.status).toBe(409);

    const add = await request(app)
      .post(`/v1/applications/${appId}/parties`)
      .set('Idempotency-Key', key('add'))
      .set('If-Match', `"${version}"`)
      .send({ action: 'ADD', customerId: CO, role: 'CO_APPLICANT', relationshipToPrimary: 'SPOUSE' });
    expect(add.status, JSON.stringify(add.body)).toBe(200);
    expect(add.body.parties).toHaveLength(2);
    expect(add.body.version).toBeGreaterThan(version);
    version = add.body.version;
    const co = add.body.parties.find((p: { role: string }) => p.role === 'CO_APPLICANT');
    expect(co).toMatchObject({ customerId: CO, relationshipToPrimary: 'SPOUSE', removedAt: null });

    const dup = await request(app)
      .post(`/v1/applications/${appId}/parties`)
      .set('Idempotency-Key', key('dup'))
      .set('If-Match', `"${version}"`)
      .send({ action: 'ADD', customerId: CO, role: 'GUARANTOR' });
    expect(dup.status).toBe(422);

    const primary = add.body.parties.find((p: { role: string }) => p.role === 'PRIMARY');
    const removePrimary = await request(app)
      .post(`/v1/applications/${appId}/parties`)
      .set('Idempotency-Key', key('rmp'))
      .set('If-Match', `"${version}"`)
      .send({ action: 'REMOVE', partyId: primary.id });
    expect(removePrimary.status).toBe(409);

    const remove = await request(app)
      .post(`/v1/applications/${appId}/parties`)
      .set('Idempotency-Key', key('rm'))
      .set('If-Match', `"${version}"`)
      .send({ action: 'REMOVE', partyId: co.id });
    expect(remove.status, JSON.stringify(remove.body)).toBe(200);
    version = remove.body.version;
    const row = await env.admin.query(
      `select removed_at, removed_by from app.application_party where id = $1`,
      [co.id],
    );
    expect(row.rows[0].removed_by).toBe(env.A.userIds[0]);

    // The row is append-only: it cannot be deleted, nor changed again.
    await expect(
      env.admin.query(`delete from app.application_party where id = $1`, [co.id]),
    ).rejects.toThrow();

    const list = await request(app).get(`/v1/applications/${appId}/parties`);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(2);
    expect(list.headers.etag).toBe(`"${version}"`);

    // A removed co-applicant may be added again.
    const readd = await request(app)
      .post(`/v1/applications/${appId}/parties`)
      .set('Idempotency-Key', key('readd'))
      .set('If-Match', `"${version}"`)
      .send({ action: 'ADD', customerId: CO, role: 'GUARANTOR' });
    expect(readd.status, JSON.stringify(readd.body)).toBe(200);
    version = readd.body.version;
  });

  it('TEST-APP-PTY-INT-04 API-APP-011 assigns an ops owner and queue with a reason; an unknown user is 422', async () => {
    const app = env.appAs(env.A, STAFF);
    const bad = await request(app)
      .post(`/v1/applications/${appId}/assignments`)
      .set('Idempotency-Key', key('bad'))
      .set('If-Match', `"${version}"`)
      .send({ opsOwnerUserId: 'usr_missing_1', reason: 'Ops handover' });
    expect(bad.status).toBe(422);
    const res = await request(app)
      .post(`/v1/applications/${appId}/assignments`)
      .set('Idempotency-Key', key('assign'))
      .set('If-Match', `"${version}"`)
      .send({ opsOwnerUserId: env.A.userIds[1], opsQueueId: env.A.queueId, reason: 'Ops handover' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ opsOwnerId: env.A.userIds[1], opsQueueId: env.A.queueId });
    version = res.body.version;
    const aud = await env.admin.query(
      `select reason from app.audit_event where entity_id = $1 and action = 'application.assigned'`,
      [appId],
    );
    expect(aud.rows).toHaveLength(1);
  });

  it('TEST-APP-PTY-INT-05 T-APP-08 withdraws with a reason, T-APP-09 reopens as a draft; both are in the history', async () => {
    const app = env.appAs(env.A, STAFF);
    const draft = await request(app)
      .post(`/v1/applications/${appId}/transitions`)
      .set('Idempotency-Key', key('wd-draft'))
      .set('If-Match', `"${version}"`)
      .send({ transitionCode: 'T-APP-08', reason: 'Customer no longer needs the loan' });
    expect(draft.status).toBe(409); // a draft is cancelled, not withdrawn
    const start = await request(app)
      .post(`/v1/applications/${appId}/transitions`)
      .set('Idempotency-Key', key('t01'))
      .set('If-Match', `"${version}"`)
      .send({ transitionCode: 'T-APP-01', productVersionId: PV });
    expect(start.status, JSON.stringify(start.body)).toBe(200);
    // The removed co-applicant gets no checklist; the primary and the guarantor do.
    const parties = await env.admin.query(
      `select p.role, count(c.id)::int as n from app.application_party p
         left join app.checklist_item c on c.party_id = p.id
        where p.application_id = $1 group by p.id, p.role, p.removed_at order by p.role, p.removed_at nulls first`,
      [appId],
    );
    expect(parties.rows.map((r) => [r.role, r.n > 0])).toEqual([
      ['CO_APPLICANT', false],
      ['GUARANTOR', true],
      ['PRIMARY', true],
    ]);
    version = start.body.version;
    const withdraw = await request(app)
      .post(`/v1/applications/${appId}/transitions`)
      .set('Idempotency-Key', key('wd'))
      .set('If-Match', `"${version}"`)
      .send({ transitionCode: 'T-APP-08', reason: 'Customer no longer needs the loan' });
    expect(withdraw.status, JSON.stringify(withdraw.body)).toBe(200);
    expect(withdraw.body.status).toBe('WITHDRAWN');

    const pii = await request(app)
      .post(`/v1/applications/${appId}/transitions`)
      .set('Idempotency-Key', key('pii'))
      .set('If-Match', `"${withdraw.body.version}"`)
      .send({ transitionCode: 'T-APP-09', reason: 'Reopen for ABCDE1234F' });
    expect(pii.status).toBe(422);

    const reopen = await request(app)
      .post(`/v1/applications/${appId}/transitions`)
      .set('Idempotency-Key', key('ro'))
      .set('If-Match', `"${withdraw.body.version}"`)
      .send({ transitionCode: 'T-APP-09', reason: 'Customer came back' });
    expect(reopen.status, JSON.stringify(reopen.body)).toBe(200);
    expect(reopen.body.status).toBe('DRAFT');
    const history = await env.admin.query(
      `select transition_code, to_status, reason_code from app.application_status_history
        where application_id = $1 and transition_code in ('T-APP-08', 'T-APP-09') order by occurred_at`,
      [appId],
    );
    expect(history.rows).toEqual([
      {
        transition_code: 'T-APP-08',
        to_status: 'WITHDRAWN',
        reason_code: 'Customer no longer needs the loan',
      },
      { transition_code: 'T-APP-09', to_status: 'DRAFT', reason_code: 'Customer came back' },
    ]);
  });

  it('TEST-APP-PTY-INT-06 T-APP-04 is refused while mandatory documents are outstanding, and allowed once they are done', async () => {
    const a = env.A;
    const id = 'app_apc_int_rev';
    await env.admin.query(
      `insert into app.loan_application (id, tenant_id, branch_id, customer_id, product_category, requested_amount,
                                         product_version_id, applicant_type, status, sales_owner_id, created_by, updated_by)
       values ($1, $2, $3, $4, 'PL', 300000, $6, 'SALARIED', 'UNDER_REVIEW', $5, $5, $5)`,
      [id, a.tenantId, a.branchId, PRIMARY, a.userIds[0], PV],
    );
    await env.admin.query(
      `insert into app.application_party (id, tenant_id, application_id, customer_id, role, party_type, created_by)
       values ('pty_apc_int_rev', $1, $2, $3, 'PRIMARY', 'INDIVIDUAL', $4)`,
      [a.tenantId, id, PRIMARY, a.userIds[0]],
    );
    await env.admin.query(
      `insert into app.checklist_item (id, tenant_id, application_id, party_id, document_type_code, mandatory,
                                       source_decision_id, created_by, updated_by)
       values ('chk_apc_int_rev', $1, $2, 'pty_apc_int_rev', 'PAN_CARD', true, 'dr_apc_int', $3, $3)`,
      [a.tenantId, id, a.userIds[0]],
    );
    const app = env.appAs(a, STAFF);
    const send = (v: number) =>
      request(app)
        .post(`/v1/applications/${id}/transitions`)
        .set('Idempotency-Key', key('rev'))
        .set('If-Match', `"${v}"`)
        .send({ transitionCode: 'T-APP-04' });
    const early = await send(0);
    expect(early.status).toBe(422);
    expect(early.body.error.code).toBe('COMPLETENESS_FAILED');

    await env.admin.query(`update app.checklist_item set status = 'WAIVED' where id = 'chk_apc_int_rev'`);
    const ready = await send(0);
    expect(ready.status, JSON.stringify(ready.body)).toBe(200);
    expect(ready.body.status).toBe('READY_FOR_SUBMISSION');
  });

  it('TEST-APP-PTY-INT-07 another tenant sees none of it (404)', async () => {
    const b = env.appAs(env.B, STAFF);
    expect((await request(b).get(`/v1/applications/${appId}/parties`)).status).toBe(404);
    const assign = await request(b)
      .post(`/v1/applications/${appId}/assignments`)
      .set('Idempotency-Key', key('x'))
      .set('If-Match', '"0"')
      .send({ opsOwnerUserId: env.B.userIds[1], reason: 'Not mine' });
    expect(assign.status).toBe(404);
  });
});
