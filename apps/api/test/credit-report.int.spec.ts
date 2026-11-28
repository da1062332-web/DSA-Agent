// apps/api/test/credit-report.int.spec.ts
// P1-05: the credit-bureau soft pull (API-CRP-001 to 003) against a real PostgreSQL. The bureau is a fake fetch inside a real BureauAdapter,
// reached through the real BureauPullPort, the real IntegrationRegistry, and the real customer, consent and party ports; nothing leaves the
// machine. Connects as dsa_api (NOBYPASSRLS). Needs Docker (npm run test:int).
import { type Database, type PullCreditReport, type RequestContext } from '@dsa/contracts';
import { FakeUserDirectoryPort } from '@dsa/contracts/fakes';
import { createAuditPort, createAuthz, createIdGenerator, requestHash } from '@dsa/kernel';
import { sql, type Kysely } from 'kysely';
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
import { resolveLocalTestDatabaseUrl } from './support/test-db-url';

const dbUrl = resolveLocalTestDatabaseUrl('DATABASE_URL');
const adminUrl = resolveLocalTestDatabaseUrl('VERIFY_DATABASE_URL');
const describeLivePg = dbUrl && adminUrl ? describe : describe.skip;

const TENANT = 'ten_demo_01';
const USER = 'usr_demo_01';
const BRANCH = 'br_demo_01';
const CREDENTIAL_REF = `vault://tenants/${TENANT}/sandbox/crif/credentials`;
const VAULT_KEY = 'mock_crif_api_key_int_77777';
const ENDPOINT = 'https://bureau.example.test/v1/pull';
// Synthetic values that no other spec uses, so the leak scan below cannot be fooled by another spec's rows.
const PAN = 'JQXWV5182D';
const DOB = '1973-12-09';
const NAME = 'Meenakshi Raghunathan Pillai';
const HOUR = 3_600_000;

type Reply = { status: number; body: unknown } | Error;
const answer = (status: number, body: unknown): Reply => ({ status, body });
const timeout = (): Reply => Object.assign(new Error('timed out'), { name: 'TimeoutError' });
const dropped = (): Reply => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
const scored = (result: Record<string, unknown> = {}) =>
  answer(200, {
    request_id: 'req_crp_int_1',
    'status-code': '101',
    result: {
      score: 742,
      activeAccounts: 3,
      totalEmi: 18400,
      maxDpd12m: 0,
      enquiries6m: 1,
      reportDate: '2026-11-28',
      ...result,
    },
  });
const vendorCode = (code: string, result: Record<string, unknown> = {}) =>
  answer(200, { request_id: 'req_crp_int_x', 'status-code': code, result });

interface VendorCall {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** The bureau: answers from a script (the last reply repeats), records every call, can take its time. */
function fakeBureau(replies: Reply[], delayMs = 0) {
  const calls: VendorCall[] = [];
  const queue = [...replies];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) as Record<string, unknown> });
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const next = (queue.length > 1 ? queue.shift() : queue[0]) ?? answer(500, {});
    if (next instanceof Error) throw next;
    return {
      status: next.status,
      text: async () => (typeof next.body === 'string' ? next.body : JSON.stringify(next.body)),
    };
  };
  return { calls, fetchImpl };
}

const grant = (
  code: 'credit_report.pull' | 'credit_report.read',
  scope: 'TENANT' | 'BRANCH' = 'TENANT',
  branchIds: string[] = [],
) => ({
  code,
  scope,
  branchIds,
});
const principalOf = (grants: ReturnType<typeof grant>[]) => ({
  kind: 'USER' as const,
  id: USER,
  tenantId: TENANT,
  primaryBranchId: BRANCH,
  managedTeamMemberIds: [],
  queueIds: [],
  grants,
  authTime: null,
});
const everyone = principalOf([grant('credit_report.pull'), grant('credit_report.read')]);
const newCtx = (now: Date = new Date(), principal = everyone): RequestContext => ({
  principal,
  correlationId: `corr_crp_${ulid()}`,
  now,
});
const newKey = () => `crp_int_${ulid()}`;
const request = (extra: Partial<PullCreditReport> = {}): PullCreditReport => ({
  bureau: 'CIBIL',
  name: NAME,
  pan: PAN,
  dateOfBirth: DOB,
  ...extra,
});

describeLivePg('P1-05 credit reports: live PostgreSQL', () => {
  let db: Kysely<Database>;
  let admin: Kysely<Database>;
  let txRunner: ReturnType<typeof createTxRunner>;

  const build = (
    replies: Reply[],
    opts: { delayMs?: number; nodeEnv?: string; withBureauPort?: boolean } = {},
  ) => {
    const bureau = fakeBureau(replies, opts.delayMs);
    const vault = new DevelopmentVaultAdapter();
    vault.setSecret(CREDENTIAL_REF, { apiKey: VAULT_KEY });
    const registry = new IntegrationRegistry(vault, { nodeEnv: () => opts.nodeEnv ?? 'test' });
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
      ...(opts.withBureauPort === false ? {} : { bureauPort: createBureauPullPort({ registry }) }),
      consentPort: createConsentPort(),
      partyPort: createPartyPort(),
      documentLinkSecret: 'k'.repeat(48),
    });
    return { service, bureau };
  };

  async function seedCustomer(branch = BRANCH): Promise<string> {
    const id = `cust_crp_${ulid()}`;
    await sql`
      INSERT INTO app.customer (id, tenant_id, party_type, full_name, home_branch_id, created_by, updated_by)
      VALUES (${id}, ${TENANT}, 'INDIVIDUAL', 'Synthetic Bureau Customer', ${branch}, ${USER}, ${USER})`.execute(
      admin,
    );
    return id;
  }

  /** A bureau consent of a customer (or of a lead). The defaults are a live consent for CIBIL. */
  async function seedConsent(
    subjectId: string,
    opts: {
      bureau?: string;
      status?: string;
      expiresAt?: Date | null;
      subjectType?: 'CUSTOMER' | 'LEAD';
    } = {},
  ): Promise<string> {
    const id = `cnst_${ulid()}`;
    const status = opts.status ?? 'ACTIVE';
    await sql`
      INSERT INTO app.consent_record (id, tenant_id, subject_type, subject_id, purpose, purpose_target, notice_version, channel,
                                      captured_by, captured_at, status, expires_at, withdrawn_at, withdrawn_by)
      VALUES (${id}, ${TENANT}, ${opts.subjectType ?? 'CUSTOMER'}, ${subjectId}, 'BUREAU_PULL', ${opts.bureau ?? 'CIBIL'}, 'V1', 'OTP',
              ${USER}, now(), ${status}, ${opts.expiresAt ?? null},
              ${status === 'WITHDRAWN' ? new Date() : null}, ${status === 'WITHDRAWN' ? USER : null})`.execute(
      admin,
    );
    return id;
  }

  /** A customer with a live CIBIL consent: the usual starting point. */
  async function seedReady(): Promise<{ customerId: string; consentId: string }> {
    const customerId = await seedCustomer();
    return { customerId, consentId: await seedConsent(customerId) };
  }

  const reportRows = async (customerId: string) =>
    (
      await sql<Record<string, unknown>>`
        SELECT * FROM app.credit_report WHERE customer_id = ${customerId} ORDER BY pulled_at, id`.execute(
        admin,
      )
    ).rows;
  const idempotencyRows = async (key: string) =>
    (
      await sql<{
        request_hash: string;
      }>`SELECT request_hash FROM app.idempotency_key WHERE key = ${key} AND tenant_id = ${TENANT}`.execute(
        admin,
      )
    ).rows;
  const caseIdsOf = (calls: VendorCall[]) =>
    calls.map((c) => (c.body.clientData as { caseId: string }).caseId);
  const setConnection = (patch: {
    status?: string;
    environment?: string;
    config?: Record<string, unknown>;
  }) =>
    sql`UPDATE app.integration_connection
           SET status = COALESCE(${patch.status ?? null}, status),
               environment = COALESCE(${patch.environment ?? null}, environment),
               config = COALESCE(${patch.config ? JSON.stringify(patch.config) : null}::jsonb, config)
         WHERE tenant_id = ${TENANT} AND provider = ${BUREAU_PROVIDER_ID} AND capability = 'BUREAU.SOFT_PULL'`.execute(
      admin,
    );
  const DEFAULT_CONFIG = { apiEndpoint: ENDPOINT, unitCostAmount: '45.00' };

  beforeAll(async () => {
    if (!dbUrl || !adminUrl) return;
    db = createDb(dbUrl, { poolMax: 6 });
    txRunner = createTxRunner(db);
    admin = createDb(adminUrl, { poolMax: 2 });
    await sql`
      INSERT INTO app.integration_connection (id, tenant_id, provider, capability, environment, credential_ref, config, status, created_by, updated_by)
      VALUES (${`itc_${ulid()}`}, ${TENANT}, ${BUREAU_PROVIDER_ID}, 'BUREAU.SOFT_PULL', 'SANDBOX', ${CREDENTIAL_REF},
              ${JSON.stringify(DEFAULT_CONFIG)}::jsonb, 'ACTIVE', ${USER}, ${USER})
      ON CONFLICT (tenant_id, provider, capability)
      DO UPDATE SET status = 'ACTIVE', environment = 'SANDBOX', config = EXCLUDED.config, credential_ref = EXCLUDED.credential_ref`.execute(
      admin,
    );
  });

  afterAll(async () => {
    await db?.destroy();
    await admin?.destroy();
  });

  // ── a report ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
  it('P1-05 a scored report is stored as a summary and returned, and the bureau got the PAN, date of birth and name once', async () => {
    const { customerId, consentId } = await seedReady();
    const { service, bureau } = build([scored()]);
    const ctx = newCtx();

    const { report, cached, isReplayed } = await service.pull(ctx, customerId, request(), newKey());

    expect(cached).toBe(false);
    expect(isReplayed).toBe(false);
    expect(report).toMatchObject({
      tenantId: TENANT,
      customerId,
      consentRecordId: consentId,
      bureau: 'CIBIL',
      provider: BUREAU_PROVIDER_ID,
      outcome: 'SCORED',
      reportDate: '2026-11-28',
      score: 742,
      activeAccounts: 3,
      monthlyEmi: { amount: '18400.00', currency: 'INR' },
      maxDpd12m: 0,
      enquiries6m: 1,
      vendorRef: 'req_crp_int_1',
      cost: { amount: '45.00', currency: 'INR' },
      pulledBy: USER,
      pulledAt: ctx.now.toISOString(),
      lockVersion: 0,
    });
    expect(report.id).toMatch(/^crp_/);
    const rows = await reportRows(customerId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: report.id, outcome: 'SCORED', score: 742, bureau: 'CIBIL' });
    // The bureau received everything once, with the consent flag; the key came from the vault, in a header.
    expect(bureau.calls).toHaveLength(1);
    expect(bureau.calls[0]?.url).toBe(ENDPOINT);
    expect(bureau.calls[0]?.body).toMatchObject({
      bureau: 'CIBIL',
      name: NAME,
      pan: PAN,
      dob: DOB,
      consent: 'Y',
    });
    expect(bureau.calls[0]?.headers['x-api-key']).toBe(VAULT_KEY);
    for (const typed of [PAN, DOB, NAME, VAULT_KEY]) expect(JSON.stringify(report)).not.toContain(typed);
  });

  it('P1-05 an audit event is written in the same transaction, with the bureau, outcome, vendor reference and cost and no PAN, date of birth or name', async () => {
    const { customerId, consentId } = await seedReady();
    const { report } = await build([scored()]).service.pull(newCtx(), customerId, request(), newKey());

    const audit = await sql<{ action: string; after: Record<string, unknown> }>`
      SELECT action, after FROM app.audit_event WHERE entity_id = ${report.id}`.execute(admin);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.action).toBe('credit_report.pulled');
    expect(audit.rows[0]?.after).toMatchObject({
      customerId,
      bureau: 'CIBIL',
      provider: BUREAU_PROVIDER_ID,
      outcome: 'SCORED',
      vendorRef: 'req_crp_int_1',
      cost: { amount: '45.00', currency: 'INR' },
      consentRecordId: consentId,
    });
    for (const typed of [PAN, DOB, NAME]) expect(JSON.stringify(audit.rows[0]?.after)).not.toContain(typed);
  });

  it('P1-05 a report of no history is stored with no score at all (never 0), and the date of the request stands in when the bureau gives none', async () => {
    const { customerId } = await seedReady();
    const now = new Date('2026-12-15T10:30:00.000Z');

    const { report } = await build([vendorCode('103')]).service.pull(
      newCtx(now),
      customerId,
      request(),
      newKey(),
    );

    expect(report).toMatchObject({
      outcome: 'NO_HISTORY',
      score: null,
      activeAccounts: null,
      monthlyEmi: null,
      maxDpd12m: null,
      enquiries6m: null,
      reportDate: '2026-12-15',
    });
    const rows = await reportRows(customerId);
    expect(rows[0]).toMatchObject({ outcome: 'NO_HISTORY', score: null });
  });

  it('P1-05 with no unit cost configured the cost is null: it is never invented', async () => {
    const { customerId } = await seedReady();
    await setConnection({ config: { apiEndpoint: ENDPOINT } });
    try {
      const { report } = await build([scored()]).service.pull(newCtx(), customerId, request(), newKey());

      expect(report.cost).toBeNull();
      expect((await reportRows(customerId))[0]).toMatchObject({ cost_amount: null, cost_currency: null });
    } finally {
      await setConnection({ config: DEFAULT_CONFIG });
    }
  });

  // ── the 24-hour cache ──────────────────────────────────────────────────────────────────────────────────────────────────────
  it('P1-05 a second request with a NEW key under 24 hours returns the first report: the bureau is called once and no row is added', async () => {
    const { customerId } = await seedReady();
    const { service, bureau } = build([scored()]);
    const t0 = new Date();

    const first = await service.pull(newCtx(t0), customerId, request(), newKey());
    const second = await service.pull(
      newCtx(new Date(t0.getTime() + 23 * HOUR)),
      customerId,
      request(),
      newKey(),
    );

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.isReplayed).toBe(false);
    expect(second.report).toEqual(first.report);
    expect(bureau.calls).toHaveLength(1);
    expect(await reportRows(customerId)).toHaveLength(1);
  });

  it('P1-05 at 24 hours and a minute the cache has run out: the bureau is called again and a second report is stored', async () => {
    const { customerId } = await seedReady();
    const { service, bureau } = build([scored(), scored({ score: 760, reportDate: '2026-11-29' })]);
    const t0 = new Date();

    await service.pull(newCtx(t0), customerId, request(), newKey());
    const later = await service.pull(
      newCtx(new Date(t0.getTime() + 24 * HOUR + 60_000)),
      customerId,
      request(),
      newKey(),
    );

    expect(later.cached).toBe(false);
    expect(later.report.score).toBe(760);
    expect(bureau.calls).toHaveLength(2);
    expect(await reportRows(customerId)).toHaveLength(2);
  });

  it('P1-05 the cache is per bureau: a CIBIL report does not stand in for a CRIF one, and each needs its own consent', async () => {
    const { customerId } = await seedReady();
    await seedConsent(customerId, { bureau: 'CRIF' });
    const { service, bureau } = build([scored(), scored({ score: 700 })]);

    const cibil = await service.pull(newCtx(), customerId, request({ bureau: 'CIBIL' }), newKey());
    const crif = await service.pull(newCtx(), customerId, request({ bureau: 'CRIF' }), newKey());

    expect(cibil.report.bureau).toBe('CIBIL');
    expect(crif.report.bureau).toBe('CRIF');
    expect(crif.cached).toBe(false);
    expect(bureau.calls).toHaveLength(2);
    expect(await reportRows(customerId)).toHaveLength(2);
  });

  it('P1-05 the same key twice calls the bureau once and replays the same report (200, replayed)', async () => {
    const { customerId } = await seedReady();
    const { service, bureau } = build([scored()]);
    const key = newKey();

    const first = await service.pull(newCtx(), customerId, request(), key);
    const second = await service.pull(newCtx(), customerId, request(), key);

    expect(first.isReplayed).toBe(false);
    expect(second.isReplayed).toBe(true);
    expect(second.report).toEqual(first.report);
    expect(bureau.calls).toHaveLength(1);
    expect(await reportRows(customerId)).toHaveLength(1);
  });

  it('P1-05 a replay of a request that was answered from the cache is still a cache answer and still a replay', async () => {
    const { customerId } = await seedReady();
    const { service } = build([scored()]);
    await service.pull(newCtx(), customerId, request(), newKey());
    const key = newKey();

    const hit = await service.pull(newCtx(), customerId, request(), key);
    const again = await service.pull(newCtx(), customerId, request(), key);

    expect(hit.cached).toBe(true);
    expect(again).toMatchObject({ cached: true, isReplayed: true });
    expect(again.report).toEqual(hit.report);
  });

  it('P1-05 the same key with a different request is refused (422 IDEMPOTENCY_KEY_REUSED): another PAN, name, date of birth, bureau or customer', async () => {
    const { customerId } = await seedReady();
    const other = await seedReady();
    await seedConsent(customerId, { bureau: 'CRIF' });
    const { service, bureau } = build([scored()]);
    const key = newKey();
    await service.pull(newCtx(), customerId, request(), key);

    const changes: [string, string, Partial<PullCreditReport>][] = [
      ['another PAN', customerId, { pan: 'ABCDE1234F' }],
      ['another name', customerId, { name: 'Someone Else Entirely' }],
      ['another date of birth', customerId, { dateOfBirth: '1980-01-01' }],
      ['another bureau', customerId, { bureau: 'CRIF' }],
      ['another customer', other.customerId, {}],
    ];
    for (const [label, customer, change] of changes) {
      await expect(service.pull(newCtx(), customer, request(change), key), label).rejects.toMatchObject({
        code: 'IDEMPOTENCY_KEY_REUSED',
      });
    }
    expect(bureau.calls).toHaveLength(1);
  });

  it('P1-05 two concurrent requests with the same key call the bureau once (the second waits, then replays)', async () => {
    const { customerId } = await seedReady();
    const { service, bureau } = build([scored()], { delayMs: 400 });
    const key = newKey();

    const [a, b] = await Promise.all([
      service.pull(newCtx(), customerId, request(), key),
      service.pull(newCtx(), customerId, request(), key),
    ]);

    expect(bureau.calls).toHaveLength(1);
    expect([a.isReplayed, b.isReplayed].sort()).toEqual([false, true]);
    expect(a.report.id).toBe(b.report.id);
    expect(await reportRows(customerId)).toHaveLength(1);
  });

  it('P1-05 two concurrent requests with DIFFERENT keys call the bureau once: the second waits for the lock, then finds the first report in the cache', async () => {
    const { customerId } = await seedReady();
    const { service, bureau } = build([scored()], { delayMs: 400 });

    const [a, b] = await Promise.all([
      service.pull(newCtx(), customerId, request(), newKey()),
      service.pull(newCtx(), customerId, request(), newKey()),
    ]);

    expect(bureau.calls).toHaveLength(1);
    expect([a.cached, b.cached].sort()).toEqual([false, true]);
    expect(a.report.id).toBe(b.report.id);
    expect(await reportRows(customerId)).toHaveLength(1);
  });

  it('P1-05 the idempotency row holds keyed hashes, not the plain SHA-256 of a request that carries a PAN', async () => {
    const { customerId } = await seedReady();
    const key = newKey();
    await build([scored()]).service.pull(newCtx(), customerId, request(), key);

    const rows = await idempotencyRows(key);
    expect(rows).toHaveLength(1);
    const plain = requestHash({
      key,
      method: 'POST',
      path: `/v1/customers/${customerId}/credit-reports`,
      body: { customerId, ...request() },
    });
    expect(rows[0]?.request_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]?.request_hash).not.toBe(plain);
  });

  // ── consent: refused before the bureau is called ───────────────────────────────────────────────────────────────────────────
  it('P1-05 no consent, a consent for another bureau, an expired one and a withdrawn one are 422 CONSENT_REQUIRED and the bureau is never called', async () => {
    const none = await seedCustomer();
    const otherBureau = await seedCustomer();
    await seedConsent(otherBureau, { bureau: 'CRIF' });
    const expired = await seedCustomer();
    await seedConsent(expired, { expiresAt: new Date(Date.now() - 86_400_000) });
    const withdrawn = await seedCustomer();
    await seedConsent(withdrawn, { status: 'WITHDRAWN' });
    const lapsed = await seedCustomer();
    await seedConsent(lapsed, { status: 'EXPIRED' });
    const { service, bureau } = build([scored()]);

    for (const [label, customerId] of [
      ['no consent', none],
      ['a consent for another bureau', otherBureau],
      ['an expired consent', expired],
      ['a withdrawn consent', withdrawn],
      ['a consent that is not active', lapsed],
    ] as const) {
      await expect(service.pull(newCtx(), customerId, request(), newKey()), label).rejects.toMatchObject({
        code: 'CONSENT_REQUIRED',
        details: [{ field: 'bureau', issue: 'BUREAU_CONSENT_REQUIRED' }],
      });
      expect(await reportRows(customerId), label).toHaveLength(0);
    }
    expect(bureau.calls).toHaveLength(0);
  });

  it('P1-05 the consent gate runs before the cache: once the consent is withdrawn a report under 24 hours old is no longer returned', async () => {
    const { customerId, consentId } = await seedReady();
    const { service, bureau } = build([scored()]);
    await service.pull(newCtx(), customerId, request(), newKey());

    await sql`UPDATE app.consent_record SET status = 'WITHDRAWN', withdrawn_at = now(), withdrawn_by = ${USER} WHERE id = ${consentId}`.execute(
      admin,
    );

    await expect(service.pull(newCtx(), customerId, request(), newKey())).rejects.toMatchObject({
      code: 'CONSENT_REQUIRED',
    });
    expect(bureau.calls).toHaveLength(1);
  });

  it('P1-05 a consent given to a lead that became the customer counts, and its id is the one stored', async () => {
    const customerId = await seedCustomer();
    const leadId = `lead_crp_${ulid()}`;
    const mobile = `+9198${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
    await sql`
      INSERT INTO app.lead (id, tenant_id, branch_id, full_name, mobile_e164, mobile_hash, product_category, source, state, customer_id,
                            application_id, qual_applicant_type, qual_requested_amount, owner_user_id, created_by, updated_by)
      VALUES (${leadId}, ${TENANT}, ${BRANCH}, 'Converted Lead', ${mobile}, decode(md5(${leadId}), 'hex'),
              'PL', 'PHONE', 'CONVERTED', ${customerId}, ${`app_crp_${ulid()}`}, 'SALARIED', 300000, ${USER}, ${USER}, ${USER})`.execute(
      admin,
    );
    const consentId = await seedConsent(leadId, { subjectType: 'LEAD' });

    const { report } = await build([scored()]).service.pull(newCtx(), customerId, request(), newKey());

    expect(report.consentRecordId).toBe(consentId);
  });

  // ── vendor errors: nothing is stored, the same key can be retried ──────────────────────────────────────────────────────────
  it('P1-05 a timeout, a dropped connection, a 429, a 503, a refused key and an unreadable answer store nothing, are never a score, and the same key then succeeds with the same case id', async () => {
    const cases: [string, Reply, string, boolean][] = [
      ['a timeout', timeout(), 'DEPENDENCY_UNAVAILABLE', true],
      ['a dropped connection', dropped(), 'DEPENDENCY_UNAVAILABLE', true],
      ['HTTP 429', answer(429, {}), 'RATE_LIMITED', true],
      ['HTTP 503', answer(503, {}), 'DEPENDENCY_UNAVAILABLE', true],
      ['HTTP 401', answer(401, {}), 'INTERNAL_ERROR', false],
      ['an answer that is not JSON', answer(200, 'gateway timeout'), 'INTERNAL_ERROR', false],
      ['an unknown status-code', vendorCode('999'), 'INTERNAL_ERROR', false],
      ['a report without a score', scored({ score: undefined }), 'INTERNAL_ERROR', false],
      ['the source being busy (104)', vendorCode('104'), 'DEPENDENCY_UNAVAILABLE', true],
      ['the bureau not accepting the details (102)', vendorCode('102'), 'VALIDATION_ERROR', false],
    ];
    for (const [label, reply, code, retryable] of cases) {
      const { customerId } = await seedReady();
      const { service, bureau } = build([reply, scored()]);
      const key = newKey();

      await expect(service.pull(newCtx(), customerId, request(), key), label).rejects.toMatchObject({
        code,
        retryable,
      });
      expect(await reportRows(customerId), label).toHaveLength(0);
      expect(await idempotencyRows(key), label).toHaveLength(0);

      const retry = await service.pull(newCtx(), customerId, request(), key);
      expect(retry.report.score, label).toBe(742);
      expect(retry.isReplayed, label).toBe(false);
      const caseIds = caseIdsOf(bureau.calls);
      expect(caseIds, label).toHaveLength(2);
      expect(caseIds[0], label).toBe(caseIds[1]);
      expect(caseIds[0], label).toMatch(/^idem_[0-9a-f]{20}$/);
    }
  });

  it('P1-05 with no ACTIVE connection the answer is 422 NO_ACTIVE_CONNECTION and the bureau is not called; production uses production connections only', async () => {
    const { customerId } = await seedReady();
    const { service, bureau } = build([scored()]);
    await setConnection({ status: 'INACTIVE' });
    try {
      await expect(service.pull(newCtx(), customerId, request(), newKey())).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        details: [{ field: 'bureau', issue: 'NO_ACTIVE_CONNECTION' }],
      });
    } finally {
      await setConnection({ status: 'ACTIVE' });
    }
    // Production does not use the sandbox connection, and a production one cannot use the development vault.
    const production = build([scored()], { nodeEnv: 'production' });
    await expect(production.service.pull(newCtx(), customerId, request(), newKey())).rejects.toMatchObject({
      details: [{ field: 'bureau', issue: 'NO_ACTIVE_CONNECTION' }],
    });
    await setConnection({ environment: 'PRODUCTION' });
    try {
      await expect(production.service.pull(newCtx(), customerId, request(), newKey())).rejects.toMatchObject({
        code: 'INTERNAL_ERROR',
        message: expect.stringContaining('development vault'),
      });
    } finally {
      await setConnection({ environment: 'SANDBOX' });
    }
    expect(bureau.calls).toHaveLength(0);
    expect(production.bureau.calls).toHaveLength(0);
    expect(await reportRows(customerId)).toHaveLength(0);
  });

  // ── who may pull, and for whom ─────────────────────────────────────────────────────────────────────────────────────────────
  it('P1-05 a user without credit_report.pull gets 403 and a server without a bureau port gets 503; neither calls the bureau', async () => {
    const { customerId } = await seedReady();
    const { service, bureau } = build([scored()]);

    await expect(
      service.pull(
        newCtx(new Date(), principalOf([grant('credit_report.read')])),
        customerId,
        request(),
        newKey(),
      ),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      build([scored()], { withBureauPort: false }).service.pull(newCtx(), customerId, request(), newKey()),
    ).rejects.toMatchObject({
      code: 'DEPENDENCY_UNAVAILABLE',
    });
    expect(bureau.calls).toHaveLength(0);
    expect(await reportRows(customerId)).toHaveLength(0);
  });

  it('P1-05 an unknown customer and a customer outside the caller branch scope are 404, never 403, and the bureau is not called', async () => {
    const { customerId } = await seedReady();
    const { service, bureau } = build([scored()]);
    const elsewhere = principalOf([
      grant('credit_report.pull', 'BRANCH', ['br_somewhere_else']),
      grant('credit_report.read', 'BRANCH', ['br_somewhere_else']),
    ]);

    await expect(service.pull(newCtx(), `cust_crp_${ulid()}`, request(), newKey())).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      service.pull(newCtx(new Date(), elsewhere), customerId, request(), newKey()),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.latest(newCtx(new Date(), elsewhere), customerId, {})).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      service.list(newCtx(new Date(), elsewhere), customerId, { limit: 10 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(bureau.calls).toHaveLength(0);

    // A branch scope that covers the customer's branch works.
    const here = principalOf([
      grant('credit_report.pull', 'BRANCH', [BRANCH]),
      grant('credit_report.read', 'BRANCH', [BRANCH]),
    ]);
    const ok = await service.pull(newCtx(new Date(), here), customerId, request(), newKey());
    expect(ok.report.customerId).toBe(customerId);
  });

  it('P1-05 a date of birth that makes the person younger than 18 is refused before the bureau, with the clock of the request', async () => {
    const { customerId } = await seedReady();
    const { service, bureau } = build([scored()]);
    const now = new Date('2026-11-28T10:00:00.000Z');

    await expect(
      service.pull(newCtx(now), customerId, request({ dateOfBirth: '2008-11-29' }), newKey()),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [{ field: 'dateOfBirth', issue: 'INVALID_AGE' }],
    });
    const ok = await service.pull(newCtx(now), customerId, request({ dateOfBirth: '2008-11-28' }), newKey());
    expect(ok.report.score).toBe(742);
    expect(bureau.calls).toHaveLength(1);
  });

  // ── reading ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  it('P1-05 latest returns the newest report (of one bureau when asked), 404 when there is none, and list is newest first with a cursor', async () => {
    const { customerId } = await seedReady();
    await seedConsent(customerId, { bureau: 'CRIF' });
    const empty = await seedCustomer();
    const { service } = build([scored({ score: 700 }), scored({ score: 710 }), scored({ score: 720 })]);
    const t0 = new Date();
    await service.pull(newCtx(t0), customerId, request({ bureau: 'CIBIL' }), newKey());
    await service.pull(
      newCtx(new Date(t0.getTime() + HOUR)),
      customerId,
      request({ bureau: 'CRIF' }),
      newKey(),
    );
    await service.pull(
      newCtx(new Date(t0.getTime() + 25 * HOUR)),
      customerId,
      request({ bureau: 'CIBIL' }),
      newKey(),
    );

    const latest = await service.latest(newCtx(), customerId, {});
    expect([latest.bureau, latest.score]).toEqual(['CIBIL', 720]);
    expect((await service.latest(newCtx(), customerId, { bureau: 'CRIF' })).score).toBe(710);
    await expect(service.latest(newCtx(), empty, {})).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.latest(newCtx(), customerId, { bureau: 'EXPERIAN' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    const all = await service.list(newCtx(), customerId, { limit: 50 });
    expect(all.data.map((r) => r.score)).toEqual([720, 710, 700]);
    expect(all.meta.nextCursor).toBeNull();
    const page1 = await service.list(newCtx(), customerId, { limit: 2 });
    expect(page1.data.map((r) => r.score)).toEqual([720, 710]);
    expect(page1.meta).toMatchObject({ limit: 2 });
    expect(page1.meta.nextCursor).toEqual(expect.any(String));
    const page2 = await service.list(newCtx(), customerId, {
      limit: 2,
      cursor: page1.meta.nextCursor ?? undefined,
    });
    expect(page2.data.map((r) => r.score)).toEqual([700]);
    expect(page2.meta.nextCursor).toBeNull();
    expect(
      (await service.list(newCtx(), customerId, { limit: 50, bureau: 'CRIF' })).data.map((r) => r.score),
    ).toEqual([710]);
    expect((await service.list(newCtx(), empty, { limit: 50 })).data).toEqual([]);
    await expect(
      service.list(newCtx(), customerId, { limit: 10, cursor: 'not-a-cursor' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('P1-05 reading needs credit_report.read: pulling alone is 403', async () => {
    const { customerId } = await seedReady();
    const { service } = build([scored()]);
    const pullOnly = principalOf([grant('credit_report.pull')]);

    await expect(service.latest(newCtx(new Date(), pullOnly), customerId, {})).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(service.list(newCtx(new Date(), pullOnly), customerId, { limit: 10 })).rejects.toMatchObject(
      { code: 'FORBIDDEN' },
    );
  });

  // ── the data rules ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  it('P1-05 a report is history: nothing can update or delete it', async () => {
    const { customerId } = await seedReady();
    const { report } = await build([scored()]).service.pull(newCtx(), customerId, request(), newKey());

    await expect(
      sql`UPDATE app.credit_report SET score = 900 WHERE id = ${report.id}`.execute(admin),
    ).rejects.toThrow();
    await expect(sql`DELETE FROM app.credit_report WHERE id = ${report.id}`.execute(admin)).rejects.toThrow();
    // The API role cannot either: it holds SELECT and INSERT only.
    await expect(
      sql`UPDATE app.credit_report SET score = 900 WHERE id = ${report.id}`.execute(db),
    ).rejects.toThrow();
    await expect(sql`DELETE FROM app.credit_report WHERE id = ${report.id}`.execute(db)).rejects.toThrow();
  });

  it('P1-05 after all of the above, the PAN, the date of birth and the name are in no table of the database', async () => {
    // One more of each kind, so the scan has fresh rows to look at even when this test runs alone: a report, a cache answer, a vendor error
    // and its retry.
    const { customerId } = await seedReady();
    const { service, bureau } = build([timeout(), scored()]);
    const key = newKey();
    await expect(service.pull(newCtx(), customerId, request(), key)).rejects.toMatchObject({
      code: 'DEPENDENCY_UNAVAILABLE',
    });
    await service.pull(newCtx(), customerId, request(), key);
    await service.pull(newCtx(), customerId, request(), newKey());
    expect(bureau.calls.filter((c) => c.body.pan === PAN)).toHaveLength(2);

    const tables = await sql<{ table_schema: string; table_name: string }>`
      SELECT table_schema, table_name FROM information_schema.tables
       WHERE table_type = 'BASE TABLE' AND table_schema IN ('app', 'public')`.execute(admin);
    expect(tables.rows.length).toBeGreaterThan(50);
    const hits: string[] = [];
    for (const t of tables.rows) {
      for (const secret of [PAN, DOB, NAME]) {
        const found = await sql<{ n: number }>`
          SELECT count(*)::int AS n FROM ${sql.id(t.table_schema, t.table_name)} AS t WHERE t::text ILIKE ${`%${secret}%`}`.execute(
          admin,
        );
        if ((found.rows[0]?.n ?? 0) > 0)
          hits.push(`${t.table_schema}.${t.table_name} holds ${secret.slice(0, 4)}...`);
      }
    }
    expect(hits).toEqual([]);
  });
});
