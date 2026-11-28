// apps/api/test/customers-bureau-consent.int.spec.ts
// P1-05 (guest work in the customers lane, review: Bhushan): recording a BUREAU_PULL consent (API-CUST-004) through the real route, service and
// repository on a real PostgreSQL, and the whole journey the Bureau card depends on: record the consent, pull a report with it (a fake bureau
// inside the real BureauAdapter), withdraw it, and see the next pull refused. Connects as dsa_api (NOBYPASSRLS). Needs Docker (npm run test:int).
import { type Database, type PullCreditReport, type RequestContext } from '@dsa/contracts';
import { FakeUserDirectoryPort } from '@dsa/contracts/fakes';
import { createAuditPort, createAuthz, createIdGenerator } from '@dsa/kernel';
import { sql, type Kysely } from 'kysely';
import request from 'supertest';
import { ulid } from 'ulid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/kernel-min/db';
import { createTxRunner } from '../src/kernel-min/tx-runner';
import { createConsentPort, createPartyPort } from '../src/modules/crm/customers/consent-port';
import { createBureauPullPort } from '../src/modules/integrations/bureau-port';
import { IntegrationRegistry } from '../src/modules/integrations/integration-registry';
import { BUREAU_PROVIDER_ID, BureauAdapter } from '../src/modules/integrations/providers/bureau-adapter';
import type { FetchLike } from '../src/modules/integrations/providers/vendor-http';
import { DevelopmentVaultAdapter } from '../src/modules/integrations/vault-port';
import { CreditReportService } from '../src/modules/origination/verifications/credit-report-service';
import { createTestApp, fakeAuth, testPrincipal } from './support/fake-auth';
import { resolveLocalTestDatabaseUrl } from './support/test-db-url';

const dbUrl = resolveLocalTestDatabaseUrl('DATABASE_URL');
const adminUrl = resolveLocalTestDatabaseUrl('VERIFY_DATABASE_URL');
const describeLivePg = dbUrl && adminUrl ? describe : describe.skip;

const TENANT = 'ten_demo_01';
const USER = 'usr_demo_01';
const BRANCH = 'br_demo_01';
const CREDENTIAL_REF = `vault://tenants/${TENANT}/sandbox/crif/credentials`;
const ENDPOINT = 'https://bureau.example.test/v1/pull';
// Synthetic values that no other spec uses.
const PAN = 'HXQWN6417K';
const DOB = '1979-03-14';
const NAME = 'Lakshmi Narasimhan Iyer';

const base = { noticeVersion: 'NV-2026.1', channel: 'IN_PERSON' as const };
const staff = testPrincipal({
  id: USER,
  tenantId: TENANT,
  primaryBranchId: BRANCH,
  grants: [
    { code: 'customer.read', scope: 'TENANT', branchIds: [] },
    { code: 'consent.record', scope: 'TENANT', branchIds: [] },
  ],
});
const puller = {
  kind: 'USER' as const,
  id: USER,
  tenantId: TENANT,
  primaryBranchId: BRANCH,
  managedTeamMemberIds: [],
  queueIds: [],
  grants: [
    { code: 'credit_report.pull' as const, scope: 'TENANT' as const, branchIds: [] },
    { code: 'credit_report.read' as const, scope: 'TENANT' as const, branchIds: [] },
  ],
  authTime: null,
};
const newCtx = (): RequestContext => ({
  principal: puller,
  correlationId: `corr_cbc_${ulid()}`,
  now: new Date(),
});
const pullRequest = (bureau: PullCreditReport['bureau'] = 'CIBIL'): PullCreditReport => ({
  bureau,
  name: NAME,
  pan: PAN,
  dateOfBirth: DOB,
});

/** The bureau: always answers with a scored report, and counts the calls. */
function fakeBureau() {
  const calls: unknown[] = [];
  const fetchImpl: FetchLike = async (_url, init) => {
    calls.push(JSON.parse(init.body));
    const body = {
      request_id: 'req_cbc_1',
      'status-code': '101',
      result: {
        score: 731,
        activeAccounts: 2,
        totalEmi: 9200,
        maxDpd12m: 0,
        enquiries6m: 1,
        reportDate: '2026-11-28',
      },
    };
    return { status: 200, text: async () => JSON.stringify(body) };
  };
  return { calls, fetchImpl };
}

describeLivePg('P1-05 BUREAU_PULL consent: live PostgreSQL', () => {
  let db: Kysely<Database>;
  let admin: Kysely<Database>;
  let txRunner: ReturnType<typeof createTxRunner>;

  const app = () => createTestApp({ auth: fakeAuth(staff), deps: { txRunner } });
  const key = () => `cbc_${ulid()}`;
  const record = (customerId: string, body: Record<string, unknown>, idem = key()) =>
    request(app())
      .post(`/v1/customers/${customerId}/consents`)
      .set('Idempotency-Key', idem)
      .send({ ...base, ...body });
  const withdraw = (consentId: string) =>
    request(app())
      .post(`/v1/consents/${consentId}/withdrawal`)
      .set('Idempotency-Key', key())
      .send({ withdrawalReason: 'Customer asked' });

  async function seedCustomer(): Promise<string> {
    const id = `cust_cbc_${ulid()}`;
    await sql`
      INSERT INTO app.customer (id, tenant_id, party_type, full_name, home_branch_id, created_by, updated_by)
      VALUES (${id}, ${TENANT}, 'INDIVIDUAL', 'Synthetic Consent Customer', ${BRANCH}, ${USER}, ${USER})`.execute(
      admin,
    );
    return id;
  }

  const consentRows = async (customerId: string) =>
    (
      await sql<{
        id: string;
        purpose: string;
        purpose_target: string | null;
        status: string;
        channel: string;
      }>`
        SELECT id, purpose, purpose_target, status, channel FROM app.consent_record
         WHERE subject_id = ${customerId} ORDER BY created_at, id`.execute(admin)
    ).rows;
  const idempotencyRows = async (idem: string) =>
    (
      await sql`SELECT 1 FROM app.idempotency_key WHERE key = ${idem} AND tenant_id = ${TENANT}`.execute(
        admin,
      )
    ).rows;
  const eventCount = async (table: 'audit_event' | 'outbox_event', customerId: string) => {
    const r =
      table === 'audit_event'
        ? await sql<{ n: number }>`
            SELECT count(*)::int AS n FROM app.audit_event a
              JOIN app.consent_record c ON c.id = a.entity_id
             WHERE c.subject_id = ${customerId} AND a.action = 'consent.granted'`.execute(admin)
        : await sql<{ n: number }>`
            SELECT count(*)::int AS n FROM app.outbox_event
             WHERE subject_id = ${customerId} AND event_type = 'consent.granted'`.execute(admin);
    return r.rows[0]?.n ?? 0;
  };

  const buildPuller = () => {
    const bureau = fakeBureau();
    const vault = new DevelopmentVaultAdapter();
    vault.setSecret(CREDENTIAL_REF, { apiKey: 'mock_crif_api_key_cbc_55555' });
    const registry = new IntegrationRegistry(vault, { nodeEnv: () => 'test' });
    registry.registerAdapter(
      new BureauAdapter({ fetchImpl: bureau.fetchImpl, sleep: async () => {}, retryDelayMs: 0 }),
    );
    const ids = createIdGenerator();
    const service = new CreditReportService({
      txRunner,
      authz: createAuthz(),
      audit: createAuditPort(ids),
      ids,
      userDirectory: new FakeUserDirectoryPort(),
      bureauPort: createBureauPullPort({ registry }),
      consentPort: createConsentPort(),
      partyPort: createPartyPort(),
      documentLinkSecret: 'k'.repeat(48),
    });
    return { service, bureau };
  };

  beforeAll(async () => {
    if (!dbUrl || !adminUrl) return;
    db = createDb(dbUrl, { poolMax: 6 });
    txRunner = createTxRunner(db);
    admin = createDb(adminUrl, { poolMax: 2 });
    await sql`
      INSERT INTO app.integration_connection (id, tenant_id, provider, capability, environment, credential_ref, config, status, created_by, updated_by)
      VALUES (${`itc_${ulid()}`}, ${TENANT}, ${BUREAU_PROVIDER_ID}, 'BUREAU.SOFT_PULL', 'SANDBOX', ${CREDENTIAL_REF},
              ${JSON.stringify({ apiEndpoint: ENDPOINT, unitCostAmount: '45.00' })}::jsonb, 'ACTIVE', ${USER}, ${USER})
      ON CONFLICT (tenant_id, provider, capability)
      DO UPDATE SET status = 'ACTIVE', environment = 'SANDBOX', config = EXCLUDED.config, credential_ref = EXCLUDED.credential_ref`.execute(
      admin,
    );
  });

  afterAll(async () => {
    await db?.destroy();
    await admin?.destroy();
  });

  // ── recording ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
  it('P1-05 a BUREAU_PULL consent is recorded for a bureau: 201, stored ACTIVE with the bureau as its target, listed, with its audit and outbox rows', async () => {
    const customerId = await seedCustomer();

    const res = await record(customerId, { purpose: 'BUREAU_PULL', purposeTarget: 'CIBIL' });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      purpose: 'BUREAU_PULL',
      purposeTarget: 'CIBIL',
      status: 'ACTIVE',
      subjectId: customerId,
    });
    expect(await consentRows(customerId)).toEqual([
      {
        id: res.body.id,
        purpose: 'BUREAU_PULL',
        purpose_target: 'CIBIL',
        status: 'ACTIVE',
        channel: 'IN_PERSON',
      },
    ]);
    const list = await request(app()).get(`/v1/customers/${customerId}/consents`);
    expect(list.status).toBe(200);
    expect(list.body.data).toEqual([
      expect.objectContaining({ id: res.body.id, purpose: 'BUREAU_PULL', purposeTarget: 'CIBIL' }),
    ]);
    expect(await eventCount('audit_event', customerId)).toBe(1);
    expect(await eventCount('outbox_event', customerId)).toBe(1);
  });

  it('P1-05 a BUREAU_PULL consent without a bureau, or with one that is not a bureau, is 422 and nothing is stored', async () => {
    const customerId = await seedCustomer();

    for (const purposeTarget of [undefined, '', 'TRANSUNION']) {
      const idem = key();
      const res = await record(customerId, { purpose: 'BUREAU_PULL', purposeTarget }, idem);

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(JSON.stringify(res.body)).not.toContain('TRANSUNION');
      expect(await idempotencyRows(idem)).toHaveLength(0);
    }
    expect(await consentRows(customerId)).toEqual([]);
  });

  it('P1-05 a second ACTIVE consent for the same bureau is refused 409 INVALID_STATE (UNIQUE_VIOLATION), nothing is stored and the key is not used up; another bureau is accepted', async () => {
    const customerId = await seedCustomer();
    const first = await record(customerId, { purpose: 'BUREAU_PULL', purposeTarget: 'CIBIL' });
    expect(first.status).toBe(201);

    const idem = key();
    const again = await record(customerId, { purpose: 'BUREAU_PULL', purposeTarget: 'CIBIL' }, idem);

    // The answer the Bureau card and the consents page have to put into words (customers/consent-form.ts).
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('INVALID_STATE');
    expect(again.body.error.details).toEqual([expect.objectContaining({ issue: 'UNIQUE_VIOLATION' })]);
    expect(await consentRows(customerId)).toHaveLength(1);
    expect(await idempotencyRows(idem)).toHaveLength(0);

    const other = await record(customerId, { purpose: 'BUREAU_PULL', purposeTarget: 'CRIF' });
    expect(other.status).toBe(201);
    expect((await consentRows(customerId)).map((r) => r.purpose_target).sort()).toEqual(['CIBIL', 'CRIF']);
  });

  it('P1-05 after the consent is withdrawn the same bureau can be recorded again', async () => {
    const customerId = await seedCustomer();
    const first = await record(customerId, { purpose: 'BUREAU_PULL', purposeTarget: 'EXPERIAN' });

    const out = await withdraw(first.body.id);
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    expect(out.body).toMatchObject({ status: 'WITHDRAWN', purposeTarget: 'EXPERIAN' });
    const again = await record(customerId, { purpose: 'BUREAU_PULL', purposeTarget: 'EXPERIAN' });

    expect(again.status).toBe(201);
    expect((await consentRows(customerId)).map((r) => r.status).sort()).toEqual(['ACTIVE', 'WITHDRAWN']);
  });

  it('P1-05 a consent that is past its expiry but still ACTIVE in the register blocks a new one for the bureau until it is withdrawn', async () => {
    const customerId = await seedCustomer();
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const first = await record(customerId, {
      purpose: 'BUREAU_PULL',
      purposeTarget: 'EQUIFAX',
      expiresAt: past,
    });
    expect(first.status).toBe(201);

    const blocked = await record(customerId, { purpose: 'BUREAU_PULL', purposeTarget: 'EQUIFAX' });
    expect(blocked.status).toBe(409);
    expect((await withdraw(first.body.id)).status).toBe(200);
    expect((await record(customerId, { purpose: 'BUREAU_PULL', purposeTarget: 'EQUIFAX' })).status).toBe(201);
  });

  it('P1-05 the earlier purposes are recorded as before on the real database: a lender consent with its target, a contact consent with none', async () => {
    const customerId = await seedCustomer();

    expect(
      (await record(customerId, { purpose: 'SHARE_WITH_LENDER', purposeTarget: 'lender_cbc_1' })).status,
    ).toBe(201);
    expect((await record(customerId, { purpose: 'CONTACT' })).status).toBe(201);
    expect((await record(customerId, { purpose: 'SHARE_WITH_LENDER' })).status).toBe(422);
    expect((await consentRows(customerId)).map((r) => [r.purpose, r.purpose_target]).sort()).toEqual([
      ['CONTACT', null],
      ['SHARE_WITH_LENDER', 'lender_cbc_1'],
    ]);
  });

  // ── the journey ────────────────────────────────────────────────────────────────────────────────────────────────────────────
  it('P1-05 the journey: record the consent, pull with it (the report stores that consent), withdraw it, and the next pull is 422 CONSENT_REQUIRED', async () => {
    const customerId = await seedCustomer();
    const { service, bureau } = buildPuller();

    // Without a consent there is nothing to pull with.
    await expect(service.pull(newCtx(), customerId, pullRequest(), key())).rejects.toMatchObject({
      code: 'CONSENT_REQUIRED',
    });
    expect(bureau.calls).toHaveLength(0);

    const made = await record(customerId, { purpose: 'BUREAU_PULL', purposeTarget: 'CIBIL' });
    expect(made.status).toBe(201);

    const pulled = await service.pull(newCtx(), customerId, pullRequest(), key());
    expect(pulled.cached).toBe(false);
    expect(pulled.report).toMatchObject({
      customerId,
      bureau: 'CIBIL',
      outcome: 'SCORED',
      score: 731,
      consentRecordId: made.body.id,
    });
    expect(bureau.calls).toHaveLength(1);

    expect((await withdraw(made.body.id)).status).toBe(200);

    // The consent is checked before the 24-hour cache: the report just pulled is not returned either.
    await expect(service.pull(newCtx(), customerId, pullRequest(), key())).rejects.toMatchObject({
      code: 'CONSENT_REQUIRED',
      details: [{ field: 'bureau', issue: 'BUREAU_CONSENT_REQUIRED' }],
    });
    expect(bureau.calls).toHaveLength(1);
  });

  it('P1-05 the journey: a consent for one bureau does not let another bureau be pulled, and recording the right one does', async () => {
    const customerId = await seedCustomer();
    const { service, bureau } = buildPuller();
    await record(customerId, { purpose: 'BUREAU_PULL', purposeTarget: 'EXPERIAN' });

    await expect(service.pull(newCtx(), customerId, pullRequest('CIBIL'), key())).rejects.toMatchObject({
      code: 'CONSENT_REQUIRED',
    });
    expect(bureau.calls).toHaveLength(0);

    const cibil = await record(customerId, { purpose: 'BUREAU_PULL', purposeTarget: 'CIBIL' });
    const { report } = await service.pull(newCtx(), customerId, pullRequest('CIBIL'), key());

    expect(report.consentRecordId).toBe(cibil.body.id);
    expect(bureau.calls).toHaveLength(1);
  });
});
