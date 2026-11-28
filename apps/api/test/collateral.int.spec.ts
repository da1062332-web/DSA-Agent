// TEST-APP-COL-INT property collateral (task P1-03, migration 0111) and the co-applicant relationship rule against a real database,
// with the production wiring. Synthetic data only.
import type { PermissionCode } from '@dsa/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startIsolationEnv, type IsolationEnv } from '../../../tests/isolation/harness';

let env: IsolationEnv;
const PRIMARY = 'cust_col_int_1';
const SPOUSE = 'cust_col_int_2';
const SIBLING = 'cust_col_int_3';
const FIRM = 'cust_col_int_4';
const SECOND = 'cust_col_int_5';
const B_CUST = 'cust_col_int_b1';

const STAFF: PermissionCode[] = ['application.create', 'application.read', 'application.update'];
const key = (l: string) => `col_${l}_${Math.random().toString(36).slice(2, 10)}`;
const BODY = {
  propertyType: 'RESIDENTIAL_FLAT',
  addressLine1: 'Flat 12, Shanti Heights, Baner Road',
  city: 'Pune',
  state: 'Maharashtra',
  pincode: '411045',
  estimatedMarketValue: { amount: '5000000.00', currency: 'INR' },
  ownershipType: 'FREEHOLD',
};

beforeAll(async () => {
  env = await startIsolationEnv();
  const a = env.A;
  for (const [id, type, name] of [
    [PRIMARY, 'INDIVIDUAL', 'Primary Borrower'],
    [SPOUSE, 'INDIVIDUAL', 'Spouse Borrower'],
    [SIBLING, 'INDIVIDUAL', 'Sibling Borrower'],
    [FIRM, 'ENTITY', 'Synthetic Traders LLP'],
    [SECOND, 'INDIVIDUAL', 'Second Spouse Borrower'],
  ]) {
    await env.admin.query(
      `insert into app.customer (id, tenant_id, party_type, full_name, home_branch_id, created_by, updated_by)
       values ($1, $2, $3, $4, $5, $6, $6)`,
      [id, a.tenantId, type, name, a.branchId, a.userIds[0]],
    );
  }
  await env.admin.query(
    `insert into app.customer (id, tenant_id, party_type, full_name, home_branch_id, created_by, updated_by)
     values ($1, $2, 'INDIVIDUAL', 'Other Tenant Borrower', $3, $4, $4)`,
    [B_CUST, env.B.tenantId, env.B.branchId, env.B.userIds[0]],
  );
}, 240_000);
afterAll(async () => {
  await env?.stop();
});

async function createApp(tenant: IsolationEnv['A'], customerId: string, applicantType = 'SALARIED') {
  const res = await request(env.appAs(tenant, STAFF))
    .post('/v1/applications')
    .set('Idempotency-Key', key('app'))
    .send({
      customerId,
      branchId: tenant.branchId,
      productCategory: 'HL',
      requestedAmount: { amount: '3750000.00', currency: 'INR' },
      applicantType,
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { id: res.body.id as string, version: res.body.version as number };
}

describe('TEST-APP-COL-INT collateral', () => {
  let appId = '';
  let colId = '';
  let colVersion = 0;

  it('TEST-APP-COL-INT-01 a property valued ₹50,00,000 is stored as 500000000 paise and served as INR money', async () => {
    appId = (await createApp(env.A, PRIMARY)).id;
    const app = env.appAs(env.A, STAFF);
    const k = key('add');
    const add = await request(app)
      .post(`/v1/applications/${appId}/collateral`)
      .set('Idempotency-Key', k)
      .send(BODY);
    expect(add.status, JSON.stringify(add.body)).toBe(201);
    expect(add.body).toMatchObject({
      applicationId: appId,
      propertyType: 'RESIDENTIAL_FLAT',
      estimatedMarketValue: { amount: '5000000.00', currency: 'INR' },
      ownershipType: 'FREEHOLD',
      occupancyType: null,
      appraisalDate: null,
      lockVersion: 0,
    });
    expect(add.body.id).toMatch(/^acol_/);
    expect(add.headers.etag).toBe('"0"');
    colId = add.body.id;

    const row = await env.admin.query(
      `select estimated_market_value_paise::text as paise, tenant_id from app.application_collateral where id = $1`,
      [colId],
    );
    expect(row.rows[0]).toEqual({ paise: '500000000', tenant_id: env.A.tenantId });

    // A replay with the same key returns the same item and adds nothing.
    const replay = await request(app)
      .post(`/v1/applications/${appId}/collateral`)
      .set('Idempotency-Key', k)
      .send(BODY);
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(colId);
    expect(replay.headers['idempotent-replayed']).toBe('true');

    const list = await request(app).get(`/v1/applications/${appId}/collateral`);
    expect(list.status).toBe(200);
    expect(list.body.data.map((c: { id: string }) => c.id)).toEqual([colId]);

    // Audit and outbox are written with the item, and neither carries the address or the value.
    const aud = await env.admin.query(
      `select after::text as after from app.audit_event where entity_id = $1 and action = 'application.collateral_added'`,
      [appId],
    );
    expect(aud.rows).toHaveLength(1);
    expect(aud.rows[0].after).not.toMatch(/Shanti|5000000|500000000/);
    const evt = await env.admin.query(
      `select payload::text as payload from app.outbox_event where subject_id = $1 and event_type = 'application.collateral_added'`,
      [appId],
    );
    expect(evt.rows).toHaveLength(1);
    expect(evt.rows[0].payload).not.toMatch(/Shanti|5000000/);
  });

  it('TEST-APP-COL-INT-02 an edit needs the current If-Match; a stale one is 409 and changes nothing', async () => {
    const app = env.appAs(env.A, STAFF);
    const stale = await request(app)
      .patch(`/v1/applications/${appId}/collateral/${colId}`)
      .set('If-Match', '"7"')
      .send({ city: 'Mumbai' });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');

    const edit = await request(app)
      .patch(`/v1/applications/${appId}/collateral/${colId}`)
      .set('If-Match', `"${colVersion}"`)
      .send({
        estimatedMarketValue: { amount: '5250000.50', currency: 'INR' },
        occupancyType: 'SELF_OCCUPIED',
        appraisalDate: '2026-11-20',
      });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    expect(edit.body).toMatchObject({
      city: 'Pune',
      estimatedMarketValue: { amount: '5250000.50', currency: 'INR' },
      occupancyType: 'SELF_OCCUPIED',
      appraisalDate: '2026-11-20',
      lockVersion: 1,
    });
    expect(edit.headers.etag).toBe('"1"');
    colVersion = 1;
    const row = await env.admin.query(
      `select estimated_market_value_paise::text as paise, appraisal_date::text as d from app.application_collateral where id = $1`,
      [colId],
    );
    expect(row.rows[0]).toEqual({ paise: '525000050', d: '2026-11-20' });

    // Clearing an optional field keeps the others.
    const clear = await request(app)
      .patch(`/v1/applications/${appId}/collateral/${colId}`)
      .set('If-Match', `"${colVersion}"`)
      .send({ occupancyType: null });
    expect(clear.status).toBe(200);
    expect(clear.body).toMatchObject({ occupancyType: null, appraisalDate: '2026-11-20', lockVersion: 2 });
    colVersion = 2;
  });

  it('TEST-APP-COL-INT-03 an appraisal date after today is refused', async () => {
    const res = await request(env.appAs(env.A, STAFF))
      .post(`/v1/applications/${appId}/collateral`)
      .set('Idempotency-Key', key('future'))
      .send({ ...BODY, appraisalDate: '2099-01-01' });
    expect(res.status).toBe(422);
    expect(res.body.error.details[0]).toMatchObject({ field: 'appraisalDate', issue: 'IN_FUTURE' });
  });

  it('TEST-APP-COL-INT-04 removing is a soft delete: the row stays, the list and further edits no longer see it', async () => {
    const app = env.appAs(env.A, STAFF);
    const stale = await request(app)
      .delete(`/v1/applications/${appId}/collateral/${colId}`)
      .set('If-Match', '"0"');
    expect(stale.status).toBe(409);
    const del = await request(app)
      .delete(`/v1/applications/${appId}/collateral/${colId}`)
      .set('If-Match', `"${colVersion}"`);
    expect(del.status).toBe(204);
    const row = await env.admin.query(
      `select removed_at, removed_by from app.application_collateral where id = $1`,
      [colId],
    );
    expect(row.rows[0].removed_by).toBe(env.A.userIds[0]);
    expect(row.rows[0].removed_at).not.toBeNull();
    const list = await request(app).get(`/v1/applications/${appId}/collateral`);
    expect(list.body.data).toEqual([]);
    const again = await request(app)
      .patch(`/v1/applications/${appId}/collateral/${colId}`)
      .set('If-Match', `"${colVersion + 1}"`)
      .send({ city: 'Mumbai' });
    expect(again.status).toBe(404);
    // dsa_app has no DELETE grant: the API cannot hard-delete a row even by mistake.
    const grants = await env.admin.query(
      `select privilege_type from information_schema.role_table_grants
        where table_schema = 'app' and table_name = 'application_collateral' and grantee = 'dsa_app' order by 1`,
    );
    expect(grants.rows.map((r) => r.privilege_type)).toEqual(['INSERT', 'SELECT', 'UPDATE']);
  });

  it('TEST-APP-COL-INT-05 a collateral id on another application is 404, and nothing changes once the file has left the editable states', async () => {
    const app = env.appAs(env.A, STAFF);
    const other = await createApp(env.A, SIBLING);
    const add = await request(app)
      .post(`/v1/applications/${other.id}/collateral`)
      .set('Idempotency-Key', key('other'))
      .send({ ...BODY, propertyType: 'COMMERCIAL', ownershipType: 'LEASEHOLD' });
    expect(add.status).toBe(201);
    const cross = await request(app)
      .patch(`/v1/applications/${appId}/collateral/${add.body.id}`)
      .set('If-Match', '"0"')
      .send({ city: 'Mumbai' });
    expect(cross.status).toBe(404);

    // The same rule refuses SUBMITTED and later states; CANCELLED needs no product version, so the fixture can set it directly.
    await env.admin.query(
      `update app.loan_application set status = 'CANCELLED', cancel_reason = 'CREATED_IN_ERROR' where id = $1`,
      [other.id],
    );
    const locked = await request(app)
      .patch(`/v1/applications/${other.id}/collateral/${add.body.id}`)
      .set('If-Match', '"0"')
      .send({ city: 'Mumbai' });
    expect(locked.status).toBe(409);
    expect(locked.body.error.code).toBe('INVALID_STATE');
    const addLocked = await request(app)
      .post(`/v1/applications/${other.id}/collateral`)
      .set('Idempotency-Key', key('locked'))
      .send(BODY);
    expect(addLocked.status).toBe(409);
    // Reading is still allowed.
    const list = await request(app).get(`/v1/applications/${other.id}/collateral`);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
  });

  it('TEST-APP-COL-INT-06 tenant B cannot list, add, edit or remove tenant A collateral (404), even with every permission', async () => {
    const a = env.appAs(env.A, STAFF);
    const add = await request(a)
      .post(`/v1/applications/${appId}/collateral`)
      .set('Idempotency-Key', key('iso'))
      .send(BODY);
    expect(add.status).toBe(201);
    const b = env.appAs(env.B, STAFF);
    expect((await request(b).get(`/v1/applications/${appId}/collateral`)).status).toBe(404);
    const bAdd = await request(b)
      .post(`/v1/applications/${appId}/collateral`)
      .set('Idempotency-Key', key('iso-b'))
      .send(BODY);
    expect(bAdd.status).toBe(404);
    const bEdit = await request(b)
      .patch(`/v1/applications/${appId}/collateral/${add.body.id}`)
      .set('If-Match', '"0"')
      .send({ city: 'Mumbai' });
    expect(bEdit.status).toBe(404);
    const bDel = await request(b)
      .delete(`/v1/applications/${appId}/collateral/${add.body.id}`)
      .set('If-Match', '"0"');
    expect(bDel.status).toBe(404);
    const row = await env.admin.query(
      `select city, removed_at, lock_version from app.application_collateral where id = $1`,
      [add.body.id],
    );
    expect(row.rows[0]).toMatchObject({ city: 'Pune', removed_at: null, lock_version: 0 });
  });
});

describe('TEST-APP-COL-INT co-applicant relationships (P1-03)', () => {
  const addParty = (appId: string, version: number, body: Record<string, unknown>) =>
    request(env.appAs(env.A, STAFF))
      .post(`/v1/applications/${appId}/parties`)
      .set('Idempotency-Key', key('pty'))
      .set('If-Match', `"${version}"`)
      .send({ action: 'ADD', ...body });

  it('TEST-APP-COL-INT-07 a co-applicant without a relationship is 422 REQUIRED; a guarantor may leave it out', async () => {
    const created = await createApp(env.A, PRIMARY);
    const id = created.id;
    let version = created.version;
    const missing = await addParty(id, version, { customerId: SPOUSE, role: 'CO_APPLICANT' });
    expect(missing.status).toBe(422);
    expect(missing.body.error.details[0]).toMatchObject({
      field: 'relationshipToPrimary',
      issue: 'REQUIRED',
    });
    const guarantor = await addParty(id, version, { customerId: SIBLING, role: 'GUARANTOR' });
    expect(guarantor.status, JSON.stringify(guarantor.body)).toBe(200);
    version = guarantor.body.version;

    const spouse = await addParty(id, version, {
      customerId: SPOUSE,
      role: 'CO_APPLICANT',
      relationshipToPrimary: 'SPOUSE',
    });
    expect(spouse.status, JSON.stringify(spouse.body)).toBe(200);
    version = spouse.body.version;
    // A second live spouse is refused.
    const second = await addParty(id, version, {
      customerId: SECOND,
      role: 'CO_APPLICANT',
      relationshipToPrimary: 'SPOUSE',
    });
    expect(second.status).toBe(422);
    expect(second.body.error.details[0]).toMatchObject({
      field: 'relationshipToPrimary',
      issue: 'DUPLICATE',
    });
  });

  it('TEST-APP-COL-INT-08 family ties need two individuals; a director needs a company applicant', async () => {
    const individual = await createApp(env.A, PRIMARY);
    const firmAsSibling = await addParty(individual.id, individual.version, {
      customerId: FIRM,
      role: 'CO_APPLICANT',
      relationshipToPrimary: 'SIBLING',
    });
    expect(firmAsSibling.status).toBe(422);
    expect(firmAsSibling.body.error.details[0].issue).toBe('FAMILY_NEEDS_INDIVIDUALS');
    const director = await addParty(individual.id, individual.version, {
      customerId: SPOUSE,
      role: 'CO_APPLICANT',
      relationshipToPrimary: 'DIRECTOR',
    });
    expect(director.body.error.details[0].issue).toBe('DIRECTOR_NEEDS_ENTITY');

    const company = await createApp(env.A, FIRM, 'NON_INDIVIDUAL');
    const ok = await addParty(company.id, company.version, {
      customerId: SPOUSE,
      role: 'CO_APPLICANT',
      relationshipToPrimary: 'DIRECTOR',
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.parties.find((p: { customerId: string }) => p.customerId === SPOUSE)).toMatchObject({
      role: 'CO_APPLICANT',
      relationshipToPrimary: 'DIRECTOR',
    });
  });

  it('TEST-APP-COL-INT-09 a stale version or another tenant still answers 409 or 404 before the relationship check', async () => {
    const { id, version } = await createApp(env.A, PRIMARY);
    const stale = await addParty(id, version + 3, { customerId: SPOUSE, role: 'CO_APPLICANT' });
    expect(stale.status).toBe(409);
    const b = await request(env.appAs(env.B, STAFF))
      .post(`/v1/applications/${id}/parties`)
      .set('Idempotency-Key', key('pty-b'))
      .set('If-Match', `"${version}"`)
      .send({ action: 'ADD', customerId: B_CUST, role: 'CO_APPLICANT' });
    expect(b.status).toBe(404);
  });
});
