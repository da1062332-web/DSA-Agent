// Connector access on the internal API (MOD-CON) against a real database: a relationship manager sees and changes only the connectors it
// owns; bank details and agreement terms are read only by the roles that manage or approve them; the picker reads a minimal lookup; the
// relationship owner must be an active staff member of the tenant; a change of owner needs a reason and is audited; a connector portal
// login is refused the internal API but keeps its portal, and the portal stays inside the connector it is linked to. Synthetic data only.
import crypto from 'node:crypto';
import type { PermissionCode, Principal } from '@dsa/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createTxRunner } from '../src/kernel-min/tx-runner';
import { createPrincipalResolver } from '@dsa/kernel';
import { createProductionDeps } from '../src/wiring';
import { startIsolationEnv, type IsolationEnv } from '../../../tests/isolation/harness';
import { fakeAuth, testPrincipal } from './support/fake-auth';

let env: IsolationEnv;
const CON_A = 'con_acc_a'; // owned by relationship manager one
const CON_B = 'con_acc_b'; // owned by relationship manager two
const CON_D = 'con_acc_d'; // DRAFT, owned by manager one
const CON_E = 'con_acc_e'; // owned by manager two; its owner is changed in the owner tests
// User ids in the format the API validates (usr_ + 26 characters), since they also travel in request bodies as owners.
const userId = (suffix: string) => `usr_${'0'.repeat(23)}${suffix}`;
const MGR_ONE = userId('AC1'); // staff, relationship manager of CON_A and CON_D
const MGR_TWO = userId('AC2'); // staff, relationship manager of CON_B and CON_E
const MGR_B = userId('BX1'); // staff in the other tenant
const BRANCH_OK = `br_${'0'.repeat(23)}AB1`; // a branch id in the format the API validates
const PORTAL = userId('AP1'); // connector login linked to CON_A
const PORTAL_DRAFT = userId('AP2'); // connector login linked to the DRAFT connector
const PORTAL_SUSPENDED = userId('AP3'); // connector login, suspended
const SUSPENDED = userId('AS1'); // staff account, suspended
const CON_X = 'con_acc_x'; // in BRANCH_OK, owned by MGR_ONE: outside the branch of the branch-manager tests
const PAYABLE_B = 'cpay_acc_b'; // a commission payable of CON_B

let seq = 0;
const key = (label: string) => `acc_${label}_${Math.random().toString(36).slice(2, 10)}_${seq++}`;
const h = (s: string) => crypto.createHash('sha256').update(s).digest();

beforeAll(async () => {
  env = await startIsolationEnv();
  const a = env.A;
  const q = (text: string, values: unknown[]) => env.admin.query(text, values);

  const connector = (id: string, owner: string, status: string, n: number) =>
    q(
      `insert into app.connector (id, tenant_id, connector_type, legal_name, contact_person, mobile_e164, mobile_hash, email, email_hash,
                                  encrypted_pan, pan_hash, pan_masked, primary_branch_id, relationship_owner_user_id, status,
                                  created_by, updated_by)
       values ($1, $2, 'INDIVIDUAL', $3, 'Synthetic Contact', $4, $5, $6, $7, $8, $9, 'XXXXX1234X', $10, $11, $12, 'iso', 'iso')`,
      [
        id,
        a.tenantId,
        `Synthetic Partner ${n}`,
        `+91987650040${n}`,
        h(`m-${id}`),
        `${id}@acc.example.com`,
        h(`e-${id}`),
        Buffer.from('synthetic'),
        h(`p-${id}`),
        a.branchId,
        owner,
        status,
      ],
    );
  await q(
    `insert into app.app_user (id, tenant_id, idp_subject, email, display_name, primary_branch_id, created_by, updated_by)
     values ($1, $2, 'sub-acc-mgr-1', 'mgr1@acc.example.com', 'Manager One', $3, 'iso', 'iso'),
            ($4, $2, 'sub-acc-mgr-2', 'mgr2@acc.example.com', 'Manager Two', $3, 'iso', 'iso')`,
    [MGR_ONE, a.tenantId, a.branchId, MGR_TWO],
  );
  await q(
    `insert into app.app_user (id, tenant_id, idp_subject, email, display_name, primary_branch_id, created_by, updated_by)
     values ($1, $2, 'sub-acc-mgr-b', 'mgrb@acc.example.com', 'Manager B', $3, 'iso', 'iso')`,
    [MGR_B, env.B.tenantId, env.B.branchId],
  );
  await q(
    `insert into app.branch (id, tenant_id, organisation_id, code, name, created_by, updated_by)
     values ($1, $2, $3, 'ACC01', 'Accounts Branch', 'iso', 'iso')`,
    [BRANCH_OK, a.tenantId, a.orgId],
  );
  await connector(CON_A, MGR_ONE, 'ACTIVE', 1);
  await connector(CON_B, MGR_TWO, 'ACTIVE', 2);
  await connector(CON_D, MGR_ONE, 'DRAFT', 3);
  await connector(CON_E, MGR_TWO, 'ACTIVE', 4);
  await q(
    `insert into app.connector (id, tenant_id, connector_type, legal_name, contact_person, mobile_e164, mobile_hash, email, email_hash,
                                encrypted_pan, pan_hash, pan_masked, primary_branch_id, relationship_owner_user_id, status,
                                created_by, updated_by)
     values ($1, $2, 'INDIVIDUAL', 'Synthetic Partner X', 'Synthetic Contact', '+919876500405', $3, $4, $5, $6, $7, 'XXXXX1234X', $8,
             $9, 'ACTIVE', 'iso', 'iso')`,
    [
      CON_X,
      a.tenantId,
      h('m-x'),
      'con_x@acc.example.com',
      h('e-x'),
      Buffer.from('synthetic'),
      h('p-x'),
      BRANCH_OK,
      MGR_ONE,
    ],
  );
  await q(
    `insert into app.app_user (id, tenant_id, idp_subject, email, display_name, user_type, primary_branch_id, connector_id,
                               created_by, updated_by)
     values ($1, $2, 'sub-acc-portal-s', 'portal-s@acc.example.com', 'Suspended Partner Login', 'CONNECTOR', $3, $4, 'iso', 'iso')`,
    [PORTAL_SUSPENDED, a.tenantId, a.branchId, CON_A],
  );
  await q(`update app.app_user set status = 'SUSPENDED' where id = $1`, [PORTAL_SUSPENDED]);

  await q(
    `insert into app.app_user (id, tenant_id, idp_subject, email, display_name, user_type, primary_branch_id, connector_id, created_by, updated_by)
     values ($1, $2, 'sub-acc-portal', 'portal@acc.example.com', 'Partner Login', 'CONNECTOR', $3, $4, 'iso', 'iso'),
            ($5, $2, 'sub-acc-portal-d', 'portal-d@acc.example.com', 'Partner Login Draft', 'CONNECTOR', $3, $6, 'iso', 'iso')`,
    [PORTAL, a.tenantId, a.branchId, CON_A, PORTAL_DRAFT, CON_D],
  );
  await q(
    `insert into app.app_user (id, tenant_id, idp_subject, email, display_name, primary_branch_id, status, created_by, updated_by)
     values ($1, $2, 'sub-acc-suspended', 'suspended@acc.example.com', 'Suspended Staff', $3, 'SUSPENDED', 'iso', 'iso')`,
    [SUSPENDED, a.tenantId, a.branchId],
  );
  // A payable of CON_B, inserted with the foreign-key triggers off (the commission chain is not needed for this test).
  await q('set session_replication_role = replica', []);
  await q(
    `insert into app.commission_payable (id, tenant_id, calculation_id, connector_id, share_rate, amount, state, created_by, updated_by)
     values ($1, $2, 'ccal_acc_b', $3, 0.5, 1000.00, 'ELIGIBLE', 'iso', 'iso')`,
    [PAYABLE_B, a.tenantId, CON_B],
  );
  // A referral (lead) of CON_B, for the portal isolation test.
  await q(
    `insert into app.lead (id, tenant_id, branch_id, full_name, mobile_e164, mobile_hash, product_category, source, connector_id,
                           owner_user_id, created_by, updated_by)
     values ('lead_acc_b', $1, $2, 'Partner B Referral', '+919876500499', decode('000000000000000000000000000000b1', 'hex'),
             'PL', 'REFERRAL', $3, $4, 'iso', 'iso')`,
    [a.tenantId, a.branchId, CON_B, MGR_TWO],
  );
  await q('set session_replication_role = origin', []);
}, 240_000);

afterAll(async () => {
  await env?.stop();
});

const grant = (code: PermissionCode) => ({ code, scope: 'TENANT' as const, branchIds: [] });

/** The API as a principal with these grants, in the test tenant. Overrides set the user type or the id. */
const as = (overrides: Partial<Principal>) =>
  createApp({
    deps: createProductionDeps(createTxRunner(env.db)),
    corsAllowedOrigins: [],
    auth: fakeAuth(
      testPrincipal({
        tenantId: env.A.tenantId,
        primaryBranchId: env.A.branchId,
        authTime: new Date().toISOString(),
        ...overrides,
      }),
    ),
  });

const relationshipManager = (id: string) => as({ id, grants: [grant('connector.read')] });
const manager = () => as({ id: MGR_TWO, grants: [grant('connector.manage'), grant('connector.read')] });
const ids = (body: { items: Array<{ id: string }> }) => body.items.map((c) => c.id);

const connectorVersion = async (id: string) =>
  Number(
    (await env.admin.query('SELECT lock_version FROM app.connector WHERE id = $1', [id])).rows[0]
      .lock_version,
  );

describe('relationship manager scope (TEST-ACC-SCOPE)', () => {
  it('TEST-ACC-SCOPE-01 a relationship manager lists only the connectors it owns', async () => {
    const res = await request(relationshipManager(MGR_ONE)).get('/v1/connectors?limit=100');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(ids(res.body)).toEqual(expect.arrayContaining([CON_A, CON_D]));
    expect(ids(res.body)).not.toContain(CON_B);
  });

  it('TEST-ACC-SCOPE-02 a relationship manager opens its own connector, and another manager’s connector is not found', async () => {
    expect((await request(relationshipManager(MGR_ONE)).get(`/v1/connectors/${CON_A}`)).status).toBe(200);
    expect((await request(relationshipManager(MGR_ONE)).get(`/v1/connectors/${CON_B}`)).status).toBe(404);
  });

  it('TEST-ACC-SCOPE-03 a relationship manager cannot read bank details or agreement terms, or change a connector, even its own', async () => {
    const rm = relationshipManager(MGR_ONE);
    expect((await request(rm).get(`/v1/connectors/${CON_A}/bank-accounts`)).status).toBe(403);
    expect((await request(rm).get(`/v1/connectors/${CON_A}/agreements`)).status).toBe(403);
    const patch = await request(rm)
      .patch(`/v1/connectors/${CON_A}`)
      .set('If-Match', `"${await connectorVersion(CON_A)}"`)
      .send({ legalName: 'Renamed Partner' });
    expect(patch.status).toBe(403);
  });

  it('TEST-ACC-SCOPE-04 tenant management sees every connector and reads bank details and agreements', async () => {
    const m = manager();
    const list = await request(m).get('/v1/connectors?limit=100');
    expect(ids(list.body)).toEqual(expect.arrayContaining([CON_A, CON_B]));
    expect((await request(m).get(`/v1/connectors/${CON_B}`)).status).toBe(200);
    expect((await request(m).get(`/v1/connectors/${CON_B}/bank-accounts`)).status).toBe(200);
    expect((await request(m).get(`/v1/connectors/${CON_B}/agreements`)).status).toBe(200);
  });

  it('TEST-ACC-SCOPE-05 a bank-change approver reads bank details but not agreements, and has no directory', async () => {
    const approver = as({ id: MGR_TWO, grants: [grant('connector.bank_change_approve')] });
    expect((await request(approver).get(`/v1/connectors/${CON_B}/bank-accounts`)).status).toBe(200);
    expect((await request(approver).get(`/v1/connectors/${CON_B}/agreements`)).status).toBe(403);
    expect((await request(approver).get('/v1/connectors')).status).toBe(403);
  });

  it('TEST-ACC-SCOPE-06 the picker reads a minimal lookup for the whole tenant: no PAN, mobile, e-mail or bank data', async () => {
    const leadUser = as({ id: MGR_TWO, grants: [grant('lead.create')] });
    const res = await request(leadUser).get('/v1/connectors/lookup?status=ACTIVE');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(ids(res.body)).toEqual(expect.arrayContaining([CON_A, CON_B]));
    expect(ids(res.body)).not.toContain(CON_D);
    for (const item of res.body.items) {
      expect(Object.keys(item).sort()).toEqual(['id', 'legalName', 'primaryBranchId', 'status']);
    }
  });

  it('TEST-ACC-SCOPE-07 the lookup is refused to a principal with no connector, lead, finance or share permission', async () => {
    const other = as({ id: MGR_TWO, grants: [grant('task.read')] });
    expect((await request(other).get('/v1/connectors/lookup')).status).toBe(403);
  });

  it('TEST-ACC-SCOPE-08 a branch manager sees the connectors of its branch and its own, and no connector of another branch', async () => {
    const branchManager = as({
      id: MGR_TWO,
      grants: [
        { code: 'connector.manage', scope: 'BRANCH', branchIds: [env.A.branchId] },
        { code: 'connector.read', scope: 'BRANCH', branchIds: [env.A.branchId] },
      ],
    });
    const list = await request(branchManager).get('/v1/connectors?limit=100');
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(ids(list.body)).toEqual(expect.arrayContaining([CON_A, CON_B]));
    expect(ids(list.body)).not.toContain(CON_X);
    expect((await request(branchManager).get(`/v1/connectors/${CON_X}`)).status).toBe(404);
    expect((await request(branchManager).get(`/v1/connectors/${CON_X}/bank-accounts`)).status).toBe(404);
    const patch = await request(branchManager)
      .patch(`/v1/connectors/${CON_X}`)
      .set('If-Match', `"${await connectorVersion(CON_X)}"`)
      .send({ legalName: 'Renamed From Another Branch' });
    expect(patch.status).toBe(404);
    expect((await request(branchManager).get(`/v1/connectors/${CON_A}/bank-accounts`)).status).toBe(200);
  });

  it('TEST-ACC-SCOPE-09 a bank-change approver reads bank details of any connector in the tenant, as it approves them tenant-wide', async () => {
    const approver = as({ id: MGR_TWO, grants: [grant('connector.bank_change_approve')] });
    expect((await request(approver).get(`/v1/connectors/${CON_X}/bank-accounts`)).status).toBe(200);
  });
});

describe('relationship owner (TEST-ACC-OWNER)', () => {
  const create = (owner: string) =>
    request(manager()).post('/v1/connectors').set('Idempotency-Key', key('create')).send({
      connectorType: 'INDIVIDUAL',
      legalName: 'Synthetic Create Partner',
      contactPerson: 'Synthetic Contact',
      mobileE164: '+919876509901',
      email: 'create@acc.example.com',
      pan: 'ABCDE1234F',
      primaryBranchId: BRANCH_OK,
      relationshipOwnerUserId: owner,
    });

  it('TEST-ACC-OWNER-01 the owner must be an active internal staff member of this tenant', async () => {
    const connectorLogin = await create(PORTAL);
    expect(connectorLogin.status).toBe(422);
    expect(connectorLogin.body.error.details[0].issue).toBe('NOT_INTERNAL_STAFF');

    const suspended = await create(SUSPENDED);
    expect(suspended.status).toBe(422);
    expect(suspended.body.error.details[0].issue).toBe('OWNER_NOT_ACTIVE');

    const otherTenant = await create(MGR_B);
    expect(otherTenant.status).toBe(422);
    expect(otherTenant.body.error.details[0].issue).toBe('NOT_FOUND');

    const valid = await create(MGR_TWO);
    expect(valid.status, JSON.stringify(valid.body)).toBe(201);
    expect(valid.body.relationshipOwnerUserId).toBe(MGR_TWO);
  });

  it('TEST-ACC-OWNER-02 changing the relationship manager needs a reason, and the change is audited', async () => {
    const version = await connectorVersion(CON_E);
    const noReason = await request(manager())
      .patch(`/v1/connectors/${CON_E}`)
      .set('If-Match', `"${version}"`)
      .send({ relationshipOwnerUserId: MGR_ONE });
    expect(noReason.status).toBe(422);
    expect(noReason.body.error.details[0].issue).toBe('REASON_REQUIRED');

    const changed = await request(manager())
      .patch(`/v1/connectors/${CON_E}`)
      .set('If-Match', `"${version}"`)
      .send({
        relationshipOwnerUserId: MGR_ONE,
        ownerChangeReason: 'Partner moved to the other relationship team',
      });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    expect(changed.body.relationshipOwnerUserId).toBe(MGR_ONE);
    const stored = await env.admin.query(
      'SELECT relationship_owner_user_id FROM app.connector WHERE id = $1',
      [CON_E],
    );
    expect(stored.rows[0].relationship_owner_user_id).toBe(MGR_ONE);

    const audit = await env.admin.query(
      `SELECT count(*)::int AS n FROM app.audit_event WHERE action = 'connector.owner_changed' AND entity_id = $1`,
      [CON_E],
    );
    expect(audit.rows[0].n).toBe(1);
  });

  it('TEST-ACC-OWNER-03 saving a connector without changing its owner needs no reason', async () => {
    const version = await connectorVersion(CON_E);
    const same = await request(manager())
      .patch(`/v1/connectors/${CON_E}`)
      .set('If-Match', `"${version}"`)
      .send({ relationshipOwnerUserId: MGR_ONE, legalName: 'Synthetic Partner Four' });
    expect(same.status, JSON.stringify(same.body)).toBe(200);
  });
});

describe('optimistic locking, the response and contact masking (TEST-ACC-LOCK)', () => {
  it('TEST-ACC-LOCK-01 two writers that read the same version: one is saved, the other is refused, and the first change is not lost', async () => {
    const version = await connectorVersion(CON_E);
    const write = (legalName: string) =>
      request(manager()).patch(`/v1/connectors/${CON_E}`).set('If-Match', `"${version}"`).send({ legalName });
    const [a, b] = await Promise.all([write('Synthetic Partner Alpha'), write('Synthetic Partner Beta')]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const saved = a.status === 200 ? a : b;
    const refused = a.status === 409 ? a : b;
    expect(refused.body.error.code).toBe('VERSION_CONFLICT');
    const stored = await env.admin.query('SELECT legal_name, lock_version FROM app.connector WHERE id = $1', [
      CON_E,
    ]);
    expect(stored.rows[0].legal_name).toBe(saved.body.legalName);
    expect(Number(stored.rows[0].lock_version)).toBe(version + 1);
  });

  it('TEST-ACC-LOCK-02 a status change answers with the new status and the next version, not the state from before it', async () => {
    const version = await connectorVersion(CON_E);
    const res = await request(manager())
      .post(`/v1/connectors/${CON_E}/status`)
      .set('If-Match', `"${version}"`)
      .set('Idempotency-Key', key('status'))
      .send({ targetStatus: 'SUSPENDED', reason: 'Synthetic suspension for the test' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe('SUSPENDED');
    expect(res.body.lockVersion).toBe(version + 1);
  });

  it('TEST-ACC-MASK-01 a relationship manager reads its connector’s mobile and e-mail masked; tenant management reads them in full', async () => {
    const full = await request(manager()).get(`/v1/connectors/${CON_A}`);
    expect(full.body.mobileE164).toBe('+919876500401');
    expect(full.body.email).toBe(`${CON_A}@acc.example.com`);
    const masked = await request(relationshipManager(MGR_ONE)).get(`/v1/connectors/${CON_A}`);
    expect(masked.status).toBe(200);
    expect(masked.body.mobileE164).not.toContain('9876500401');
    expect(masked.body.email).toMatch(/^c\*\*\*@acc\.example\.com$/);
  });
});

describe('connector portal login on the internal and portal APIs (TEST-ACC-PORTAL)', () => {
  it('TEST-ACC-PORTAL-01 a connector login is refused the internal API, and may still read its own profile', async () => {
    const login = as({ id: PORTAL, kind: 'USER', userType: 'CONNECTOR', grants: [] });
    const refused = await request(login).get('/v1/connectors');
    expect(refused.status).toBe(403);
    expect(refused.body.error.details[0].issue).toBe('CONNECTOR_IDENTITY_NOT_ALLOWED');
    const me = await request(login).get('/v1/me');
    expect(me.status).not.toBe(403);
    expect(me.status).toBeLessThan(500);
  });

  it('TEST-ACC-PORTAL-02 the portal still serves the connector the login is linked to', async () => {
    const portal = as({ id: PORTAL, kind: 'USER', userType: 'CONNECTOR', grants: [] });
    const res = await request(portal).get('/portal/v1/referrals');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('TEST-ACC-PORTAL-03 changing the id in a portal request does not reach another connector’s data', async () => {
    const portal = as({ id: PORTAL, kind: 'USER', userType: 'CONNECTOR', grants: [] });
    const res = await request(portal)
      .post('/portal/v1/disputes')
      .set('Idempotency-Key', key('dispute'))
      .send({ subjectType: 'STATEMENT_LINE', subjectId: PAYABLE_B, reason: 'Synthetic dispute reason' });
    expect(res.status).toBe(404);
    const written = await env.admin.query(
      `SELECT count(*)::int AS n FROM app.dispute WHERE subject_id = $1`,
      [PAYABLE_B],
    );
    expect(written.rows[0].n).toBe(0);
  });

  it('TEST-ACC-PORTAL-04 a login whose connector is not active gets no portal access', async () => {
    const draft = as({ id: PORTAL_DRAFT, kind: 'USER', userType: 'CONNECTOR', grants: [] });
    expect((await request(draft).get('/portal/v1/referrals')).status).toBe(403);
  });

  it('TEST-ACC-PORTAL-05 a connector login sees none of another connector’s referrals or commissions, whatever id it asks for', async () => {
    const portal = as({ id: PORTAL, kind: 'USER', userType: 'CONNECTOR', grants: [] });
    const referrals = await request(portal).get('/portal/v1/referrals');
    expect(referrals.status).toBe(200);
    expect(JSON.stringify(referrals.body)).not.toContain('lead_acc_b');

    const statements = await request(portal).get('/portal/v1/statements');
    expect(statements.status, JSON.stringify(statements.body)).toBe(200);
    expect(JSON.stringify(statements.body)).not.toContain(PAYABLE_B);

    const payout = await request(portal)
      .post('/portal/v1/payout-requests')
      .set('Idempotency-Key', key('payout'))
      .send({ payableIds: [PAYABLE_B] });
    expect([200, 201]).not.toContain(payout.status);
    const paid = await env.admin.query(
      'SELECT count(*)::int AS n FROM app.payout_line WHERE payable_id = $1',
      [PAYABLE_B],
    );
    expect(paid.rows[0].n).toBe(0);
  });

  it('TEST-ACC-PORTAL-06 the resolver gives an active connector login its user type, and refuses a suspended one on every request', async () => {
    const resolver = createPrincipalResolver(createTxRunner(env.db));
    const at = { correlationId: 'corr_acc_portal', now: new Date() };
    const token = (subject: string, email: string) => ({
      subject,
      tenantId: env.A.tenantId,
      aal: 'aal1' as const,
      mfaVerifiedAt: null,
      email,
    });
    const active = await resolver.resolve(token('sub-acc-portal', 'portal@acc.example.com'), at);
    expect(active).toMatchObject({ id: PORTAL, userType: 'CONNECTOR', grants: [] });
    await expect(
      resolver.resolve(token('sub-acc-portal-s', 'portal-s@acc.example.com'), at),
    ).rejects.toThrow();
  });
});
