// apps/api/test/verification-kyc-check.int.spec.ts
// P1-06: POST /v1/verifications/checks (API-VER-003) against a real PostgreSQL: the server runs a PAN or GST check at the tenant's
// provider and stores the result. The vendor is a fake fetch inside a real KarzaAdapter, reached through the real KycCheckPort and the
// real IntegrationRegistry; nothing leaves the machine. Connects as dsa_api (NOBYPASSRLS). Needs Docker (npm run test:int).
import { type Database, type RequestContext, type RunVerificationCheck } from '@dsa/contracts';
import { FakeUserDirectoryPort } from '@dsa/contracts/fakes';
import { createAuditPort, createAuthz, createIdGenerator, requestHash } from '@dsa/kernel';
import { sql, type Kysely } from 'kysely';
import { ulid } from 'ulid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/kernel-min/db';
import { createTxRunner } from '../src/kernel-min/tx-runner';
import { IntegrationRegistry } from '../src/modules/integrations/integration-registry';
import { createKycCheckPort } from '../src/modules/integrations/kyc-port';
import { KarzaAdapter, type FetchLike } from '../src/modules/integrations/providers/karza-adapter';
import { VerificationService } from '../src/modules/origination/verifications/verification-service';
import { resolveLocalTestDatabaseUrl } from './support/test-db-url';

const dbUrl = resolveLocalTestDatabaseUrl('DATABASE_URL');
const adminUrl = resolveLocalTestDatabaseUrl('VERIFY_DATABASE_URL');
const describeLivePg = dbUrl && adminUrl ? describe : describe.skip;

const TENANT = 'ten_demo_01';
const USER = 'usr_demo_01';
const BRANCH = 'br_demo_01';
// Synthetic identifiers that no other spec uses, so the leak scan below cannot be fooled by another spec's rows.
const PAN = 'QXZKW7391L';
const GSTIN = '27QXZKW7391L1Z5';
const NAME_ON_RECORD = 'RAVI KUMAR SHARMA';
// The bank penny drop: a synthetic account number and holder name that no other spec uses.
const ACCOUNT = '731904826517';
const ACCOUNT_MASKED = '********6517';
const IFSC = 'HDFC0001234';
const HOLDER_ON_RECORD = 'SUNITA DEVI VERMA';
const HOLDER_TYPED = 'Sunita Devi Verma';

type Reply = { status: number; body: unknown } | Error;
const answer = (status: number, body: unknown): Reply => ({ status, body });
const timeout = (): Reply => Object.assign(new Error('timed out'), { name: 'TimeoutError' });
const dropped = (): Reply => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
const bankOk = (result: Record<string, unknown> = {}) =>
  answer(200, {
    request_id: 'req_bank_int_1',
    'status-code': '101',
    result: { bankTxnStatus: true, accountName: HOLDER_ON_RECORD, ...result },
  });
const vendorCode = (code: string) => answer(200, { request_id: 'req_x', 'status-code': code, result: {} });
const panOk = (extra: Record<string, unknown> = {}) =>
  answer(200, {
    request_id: 'req_pan_int_1',
    'status-code': '101',
    result: { name: NAME_ON_RECORD, status: 'Valid', ...extra },
  });
const gstOk = answer(200, {
  request_id: 'req_gst_int_1',
  'status-code': '101',
  result: { sts: 'Active', tradeNam: 'SHARMA TRADERS', lgnm: NAME_ON_RECORD, rgdt: '01/07/2019' },
});

interface VendorCall {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** The vendor: answers from a script (the last reply repeats), records every call, can take its time. */
function fakeVendor(replies: Reply[], delayMs = 0) {
  const calls: VendorCall[] = [];
  const queue = [...replies];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) as Record<string, unknown> });
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const next = (queue.length > 1 ? queue.shift() : queue[0]) ?? answer(500, {});
    if (next instanceof Error) throw next;
    return { status: next.status, text: async () => JSON.stringify(next.body) };
  };
  return { calls, fetchImpl };
}

const principal = {
  kind: 'USER' as const,
  id: USER,
  tenantId: TENANT,
  primaryBranchId: BRANCH,
  managedTeamMemberIds: [],
  queueIds: [],
  grants: [{ code: 'verification.perform' as const, scope: 'TENANT' as const, branchIds: [] }],
  authTime: null,
};
const newCtx = (): RequestContext => ({
  principal,
  correlationId: `corr_kyc_${ulid()}`,
  now: new Date(),
});
const newKey = () => `kyc_int_${ulid()}`;

describeLivePg('P1-06 POST /v1/verifications/checks: live PostgreSQL', () => {
  let db: Kysely<Database>;
  let admin: Kysely<Database>;
  let txRunner: ReturnType<typeof createTxRunner>;

  const build = (replies: Reply[], opts: { delayMs?: number; nodeEnv?: string } = {}) => {
    const vendor = fakeVendor(replies, opts.delayMs);
    const registry = new IntegrationRegistry(undefined, { nodeEnv: () => opts.nodeEnv ?? 'test' });
    registry.registerAdapter(
      new KarzaAdapter({
        fetchImpl: vendor.fetchImpl,
        sleep: async () => {},
        retryDelayMs: 0,
        lookupMaxAttempts: 1,
      }),
    );
    const ids = createIdGenerator();
    const service = new VerificationService({
      txRunner,
      authz: createAuthz(),
      audit: createAuditPort(ids),
      ids,
      userDirectory: new FakeUserDirectoryPort(),
      kycPort: createKycCheckPort({ registry }),
      documentLinkSecret: 'k'.repeat(48),
    });
    return { service, vendor };
  };

  /** A customer and the consent they gave. The defaults are a live VERIFICATION_CHECK consent. */
  async function seedSubject(
    opts: {
      purpose?: string;
      status?: string;
      expiresAt?: Date | null;
      subjectId?: string;
    } = {},
  ) {
    const customerId = opts.subjectId ?? `cus_kyc_${ulid()}`;
    const consentId = `cnst_${ulid()}`;
    const purpose = opts.purpose ?? 'VERIFICATION_CHECK';
    if (!opts.subjectId) {
      await sql`
        INSERT INTO app.customer (id, tenant_id, party_type, full_name, home_branch_id, created_by, updated_by)
        VALUES (${customerId}, ${TENANT}, 'INDIVIDUAL', 'Synthetic KYC Customer', ${BRANCH}, ${USER}, ${USER})
      `.execute(admin);
    }
    await sql`
      INSERT INTO app.consent_record (id, tenant_id, subject_type, subject_id, purpose, purpose_target, notice_version,
                                      channel, captured_by, captured_at, status, expires_at)
      VALUES (${consentId}, ${TENANT}, 'CUSTOMER', ${customerId}, ${purpose},
              ${purpose === 'VERIFICATION_CHECK' ? 'KARZA' : null}, 'V1', 'IN_PERSON', ${USER}, now(),
              ${opts.status ?? 'ACTIVE'}, ${opts.expiresAt ?? null})
    `.execute(admin);
    return { customerId, consentId };
  }

  const panRequest = (
    s: { customerId: string; consentId: string },
    extra: Partial<RunVerificationCheck> = {},
  ): RunVerificationCheck =>
    ({
      check: 'PAN',
      subjectType: 'CUSTOMER',
      subjectId: s.customerId,
      consentRecordId: s.consentId,
      idNumber: PAN,
      purpose: 'KYC',
      ...extra,
    }) as RunVerificationCheck;

  const bankRequest = (
    s: { customerId: string; consentId: string },
    extra: Record<string, unknown> = {},
  ): RunVerificationCheck =>
    ({
      check: 'BANK_ACCOUNT',
      subjectType: 'CUSTOMER',
      subjectId: s.customerId,
      consentRecordId: s.consentId,
      accountNumber: ACCOUNT,
      ifsc: IFSC,
      purpose: 'KYC',
      ...extra,
    }) as RunVerificationCheck;

  const caseIdsOf = (calls: VendorCall[]) =>
    calls.map((c) => (c.body.clientData as { caseId: string }).caseId);

  const verificationRows = async (subjectId: string) =>
    (
      await sql<{
        id: string;
        check_type: string;
        method: string;
        result: string;
        minimal_result: Record<string, unknown>;
        evidence_ref: string;
        consent_record_id: string;
        performed_by: string;
      }>`SELECT id, check_type, method, result, minimal_result, evidence_ref, consent_record_id, performed_by
           FROM app.verification WHERE subject_id = ${subjectId}`.execute(admin)
    ).rows;

  const idempotencyRows = async (key: string) =>
    (
      await sql<{ request_hash: string }>`
        SELECT request_hash FROM app.idempotency_key WHERE key = ${key} AND tenant_id = ${TENANT}`.execute(
        admin,
      )
    ).rows;

  const setConnectionStatus = (capability: string, status: string) =>
    sql`UPDATE app.integration_connection SET status = ${status}
         WHERE tenant_id = ${TENANT} AND provider = 'KARZA' AND capability = ${capability}`.execute(admin);

  beforeAll(async () => {
    if (!dbUrl || !adminUrl) return;
    db = createDb(dbUrl, { poolMax: 6 });
    txRunner = createTxRunner(db);
    admin = createDb(adminUrl, { poolMax: 2 });
    // The tenant's active Karza connections for the two checks. The credential reference resolves in the development vault.
    for (const [capability, path] of [
      ['VERIFICATION.PAN', 'pan'],
      ['VERIFICATION.GST', 'gst'],
      ['VERIFICATION.BANK', 'bank'],
    ] as const) {
      await sql`
        INSERT INTO app.integration_connection (id, tenant_id, provider, capability, environment, credential_ref, config,
                                                status, created_by, updated_by)
        VALUES (${`itc_${ulid()}`}, ${TENANT}, 'KARZA', ${capability}, 'SANDBOX',
                'vault://tenants/ten_demo_01/sandbox/karza/credentials',
                ${JSON.stringify({ apiEndpoint: `https://kyc.example.test/v3/${path}`, minMatchScore: 85 })}::jsonb,
                'ACTIVE', ${USER}, ${USER})
        ON CONFLICT (tenant_id, provider, capability)
        DO UPDATE SET status = 'ACTIVE', environment = 'SANDBOX', config = EXCLUDED.config,
                      credential_ref = EXCLUDED.credential_ref
      `.execute(admin);
    }
  });

  afterAll(async () => {
    await db?.destroy();
    await admin?.destroy();
  });

  // ── results ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  it('P1-06 a PAN that matches is stored as a PROVIDER_AUTOMATED VERIFIED record with masked data only', async () => {
    const subject = await seedSubject();
    const { service, vendor } = build([panOk()]);

    const { verification, isReplayed } = await service.runCheck(
      newCtx(),
      panRequest(subject, { name: 'Ravi Kumar Sharma' }),
      newKey(),
    );

    expect(isReplayed).toBeFalsy();
    expect(verification).toMatchObject({
      checkType: 'PAN',
      method: 'PROVIDER_AUTOMATED',
      result: 'VERIFIED',
      subjectType: 'CUSTOMER',
      subjectId: subject.customerId,
      consentRecordId: subject.consentId,
      purpose: 'KYC',
      performedBy: USER,
      lockVersion: 0,
      evidenceRef: 'KARZA:req_pan_int_1',
      minimalResult: {
        maskedIdentifier: 'QXZKW****L',
        nameMatchScore: 100,
        providerReference: 'req_pan_int_1',
        discrepancies: [],
      },
    });
    // The stored row is the response.
    const rows = await verificationRows(subject.customerId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: verification.id, method: 'PROVIDER_AUTOMATED', result: 'VERIFIED' });
    // The vendor received the full PAN, once, with the consent flag; the key came from the vault and is a header, not in the body.
    expect(vendor.calls).toHaveLength(1);
    expect(vendor.calls[0]?.body).toMatchObject({ pan: PAN, consent: 'Y' });
    expect(vendor.calls[0]?.url).toBe('https://kyc.example.test/v3/pan');
    expect(vendor.calls[0]?.headers['x-karza-key']).toBe('mock_karza_api_key_sand_99999');
    expect(JSON.stringify(vendor.calls[0]?.body)).not.toContain('mock_karza_api_key');
    // The response, as sent to the client, holds neither the PAN nor the name on record.
    expect(JSON.stringify(verification)).not.toContain(PAN);
    expect(JSON.stringify(verification)).not.toContain(NAME_ON_RECORD);
  });

  it('P1-06 an audit event is written in the same transaction, with the masked identifier and no PAN or name', async () => {
    const subject = await seedSubject();
    const { service } = build([panOk()]);

    const { verification } = await service.runCheck(
      newCtx(),
      panRequest(subject, { name: 'Ravi Kumar Sharma' }),
      newKey(),
    );

    const audit = await sql<{ action: string; after: Record<string, unknown> }>`
      SELECT action, after FROM app.audit_event WHERE entity_id = ${verification.id}`.execute(admin);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.action).toBe('verification.performed');
    expect(audit.rows[0]?.after).toMatchObject({
      checkType: 'PAN',
      method: 'PROVIDER_AUTOMATED',
      result: 'VERIFIED',
      provider: 'KARZA',
      maskedIdentifier: 'QXZKW****L',
    });
    expect(JSON.stringify(audit.rows[0]?.after)).not.toContain(PAN);
    expect(JSON.stringify(audit.rows[0]?.after)).not.toContain(NAME_ON_RECORD);
  });

  it('P1-06 a name that does not match is stored as REJECTED with the reason, and an invalid PAN as REJECTED too', async () => {
    const mismatch = await seedSubject();
    const first = await build([panOk()]).service.runCheck(
      newCtx(),
      panRequest(mismatch, { name: 'Mohan Lal Gupta' }),
      newKey(),
    );
    expect(first.verification).toMatchObject({
      result: 'REJECTED',
      minimalResult: { nameMatchScore: 0, discrepancies: ['NAME_MISMATCH'], maskedIdentifier: 'QXZKW****L' },
    });

    const invalid = await seedSubject();
    const second = await build([
      answer(200, { request_id: 'req_x', 'status-code': '102', result: {} }),
    ]).service.runCheck(newCtx(), panRequest(invalid), newKey());
    expect(second.verification).toMatchObject({
      result: 'REJECTED',
      minimalResult: { discrepancies: ['ID_INVALID'] },
    });
    expect(await verificationRows(mismatch.customerId)).toHaveLength(1);
    expect(await verificationRows(invalid.customerId)).toHaveLength(1);
  });

  it('P1-06 a name that was asked for but not returned by the vendor is stored as INCONCLUSIVE, never VERIFIED', async () => {
    const subject = await seedSubject();
    const { verification } = await build([
      answer(200, { request_id: 'req_n', 'status-code': '101', result: { status: 'Valid' } }),
    ]).service.runCheck(newCtx(), panRequest(subject, { name: 'Ravi Kumar Sharma' }), newKey());

    expect(verification).toMatchObject({
      result: 'INCONCLUSIVE',
      minimalResult: { discrepancies: ['NAME_NOT_RETURNED'] },
    });
  });

  it('P1-06 a GSTIN is checked and stored with its embedded PAN masked', async () => {
    const subject = await seedSubject();
    const { service, vendor } = build([gstOk]);

    const { verification } = await service.runCheck(
      newCtx(),
      { ...panRequest(subject), check: 'GST', idNumber: GSTIN } as RunVerificationCheck,
      newKey(),
    );

    expect(verification).toMatchObject({
      checkType: 'GST',
      method: 'PROVIDER_AUTOMATED',
      result: 'VERIFIED',
      minimalResult: { maskedIdentifier: '27QXZKW****L1Z5' },
    });
    expect(vendor.calls[0]?.url).toBe('https://kyc.example.test/v3/gst');
    expect(vendor.calls[0]?.body).toMatchObject({ gstin: GSTIN });
    expect(JSON.stringify(verification)).not.toContain(PAN);
    expect(JSON.stringify(verification)).not.toContain(GSTIN);
  });

  // ── errors: nothing is stored, the same key can be retried ──────────────────────────────────────────────────────────────────
  it('P1-06 a vendor timeout stores nothing, and the same Idempotency-Key succeeds on retry with the same case id', async () => {
    const subject = await seedSubject();
    const { service, vendor } = build([timeout(), panOk()]);
    const key = newKey();

    await expect(service.runCheck(newCtx(), panRequest(subject), key)).rejects.toMatchObject({
      code: 'DEPENDENCY_UNAVAILABLE',
      retryable: true,
    });
    expect(await verificationRows(subject.customerId)).toHaveLength(0);
    expect(await idempotencyRows(key)).toHaveLength(0);

    const retry = await service.runCheck(newCtx(), panRequest(subject), key);
    expect(retry.verification.result).toBe('VERIFIED');
    expect(retry.isReplayed).toBeFalsy();
    expect(await verificationRows(subject.customerId)).toHaveLength(1);

    // The vendor saw the same case id both times, so it can recognise the retry; another key gets another case id.
    const caseIds = vendor.calls.map((c) => (c.body.clientData as { caseId: string }).caseId);
    expect(caseIds).toHaveLength(2);
    expect(caseIds[0]).toBe(caseIds[1]);
    expect(caseIds[0]).toMatch(/^idem_[0-9a-f]{20}$/);
    await service.runCheck(newCtx(), panRequest(subject), newKey());
    const other = (vendor.calls[2]?.body.clientData as { caseId: string }).caseId;
    expect(other).not.toBe(caseIds[0]);
  });

  it('P1-06 vendor errors keep their class: 503 and 429 are retryable, a refused key and a strange answer are not, and none is stored', async () => {
    const cases: [string, Reply, string, boolean][] = [
      ['a 503', answer(503, {}), 'DEPENDENCY_UNAVAILABLE', true],
      ['a 429', answer(429, {}), 'RATE_LIMITED', true],
      ['a 401', answer(401, {}), 'INTERNAL_ERROR', false],
      ['an unknown status-code', answer(200, { 'status-code': '999', result: {} }), 'INTERNAL_ERROR', false],
      [
        'a vendor that is busy (104)',
        answer(200, { 'status-code': '104', result: {} }),
        'DEPENDENCY_UNAVAILABLE',
        true,
      ],
    ];
    for (const [label, reply, code, retryable] of cases) {
      const subject = await seedSubject();
      const key = newKey();
      await expect(
        build([reply]).service.runCheck(newCtx(), panRequest(subject), key),
        label,
      ).rejects.toMatchObject({
        code,
        retryable,
      });
      expect(await verificationRows(subject.customerId), label).toHaveLength(0);
      expect(await idempotencyRows(key), label).toHaveLength(0);
    }
  });

  // ── idempotency ───────────────────────────────────────────────────────────────────────────────────────────────────────────
  it('P1-06 the same key twice calls the vendor once and replays the same record', async () => {
    const subject = await seedSubject();
    const { service, vendor } = build([panOk()]);
    const key = newKey();

    const first = await service.runCheck(newCtx(), panRequest(subject), key);
    const second = await service.runCheck(newCtx(), panRequest(subject), key);

    expect(first.isReplayed).toBeFalsy();
    expect(second.isReplayed).toBe(true);
    expect(second.verification).toEqual(first.verification);
    expect(vendor.calls).toHaveLength(1);
    expect(await verificationRows(subject.customerId)).toHaveLength(1);
  });

  it('P1-06 the same key with a different request is refused (422 IDEMPOTENCY_KEY_REUSED) and the vendor is not called again', async () => {
    const subject = await seedSubject();
    const { service, vendor } = build([panOk()]);
    const key = newKey();
    await service.runCheck(newCtx(), panRequest(subject), key);

    await expect(
      service.runCheck(newCtx(), panRequest(subject, { idNumber: 'ABCDE1234F' }), key),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    await expect(
      service.runCheck(newCtx(), panRequest(subject, { name: 'Someone Else' }), key),
    ).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSED',
    });
    expect(vendor.calls).toHaveLength(1);
  });

  it('P1-06 two concurrent requests with one key call the vendor once (the second waits, then replays)', async () => {
    const subject = await seedSubject();
    const { service, vendor } = build([panOk()], { delayMs: 400 });
    const key = newKey();

    const [a, b] = await Promise.all([
      service.runCheck(newCtx(), panRequest(subject), key),
      service.runCheck(newCtx(), panRequest(subject), key),
    ]);

    expect(vendor.calls).toHaveLength(1);
    expect([Boolean(a.isReplayed), Boolean(b.isReplayed)].sort()).toEqual([false, true]);
    expect(a.verification.id).toBe(b.verification.id);
    expect(await verificationRows(subject.customerId)).toHaveLength(1);
  });

  it('P1-06 the idempotency row holds a keyed hash, not the plain SHA-256 of a request that carries a PAN', async () => {
    const subject = await seedSubject();
    const key = newKey();
    const request = panRequest(subject, { name: 'Ravi Kumar Sharma' });
    await build([panOk()]).service.runCheck(newCtx(), request, key);

    const rows = await idempotencyRows(key);
    expect(rows).toHaveLength(1);
    const plain = requestHash({ key, method: 'POST', path: '/v1/verifications/checks', body: request });
    expect(rows[0]?.request_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]?.request_hash).not.toBe(plain);
  });

  // ── consent and connection: refused before the vendor is called ─────────────────────────────────────────────────────────────
  it('P1-06 an unknown consent, one of another subject, of the wrong purpose, expired or not active never reaches the vendor', async () => {
    const subject = await seedSubject();
    const someoneElse = await seedSubject();
    const wrongPurpose = await seedSubject({ purpose: 'LOAN_PROCESSING' });
    const expired = await seedSubject({ expiresAt: new Date(Date.now() - 86_400_000) });
    const notActive = await seedSubject({ status: 'EXPIRED' });
    const { service, vendor } = build([panOk()]);

    const refusals: [string, RunVerificationCheck, string][] = [
      ['an unknown consent', panRequest(subject, { consentRecordId: `cnst_${ulid()}` }), 'NOT_FOUND'],
      [
        'the consent of another subject',
        panRequest(subject, { consentRecordId: someoneElse.consentId }),
        'VALIDATION_ERROR',
      ],
      ['a consent for another purpose', panRequest(wrongPurpose), 'VALIDATION_ERROR'],
      ['an expired consent', panRequest(expired), 'CONSENT_REQUIRED'],
      ['a consent that is not active', panRequest(notActive), 'CONSENT_REQUIRED'],
    ];
    for (const [label, request, code] of refusals) {
      await expect(service.runCheck(newCtx(), request, newKey()), label).rejects.toMatchObject({ code });
    }
    expect(vendor.calls).toHaveLength(0);
    for (const s of [subject, someoneElse, wrongPurpose, expired, notActive]) {
      expect(await verificationRows(s.customerId)).toHaveLength(0);
    }
  });

  it('P1-06 the consent errors are the same ones POST /v1/verifications gives (the gate is shared)', async () => {
    const subject = await seedSubject();
    const someoneElse = await seedSubject();
    const { service } = build([panOk()]);
    const manual = {
      subjectType: 'CUSTOMER' as const,
      subjectId: subject.customerId,
      checkType: 'PAN' as const,
      method: 'MANUAL' as const,
      purpose: 'KYC' as const,
      consentRecordId: someoneElse.consentId,
      result: 'VERIFIED' as const,
      minimalResult: { statusDescription: 'Checked by hand' },
      evidenceRef: 'manual:evidence-1',
    };

    await expect(service.createVerification(newCtx(), manual, newKey())).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [{ field: 'consentRecordId', issue: 'CONSENT_SUBJECT_MISMATCH' }],
    });
    await expect(
      service.runCheck(newCtx(), panRequest(subject, { consentRecordId: someoneElse.consentId }), newKey()),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [{ field: 'consentRecordId', issue: 'CONSENT_SUBJECT_MISMATCH' }],
    });
  });

  it('P1-06 POST /v1/verifications still records a MANUAL result through the same consent gate (the refactor changed nothing)', async () => {
    const subject = await seedSubject();
    const { service, vendor } = build([panOk()]);
    const key = newKey();
    const manual = {
      subjectType: 'CUSTOMER' as const,
      subjectId: subject.customerId,
      checkType: 'PAN' as const,
      method: 'MANUAL' as const,
      purpose: 'KYC' as const,
      consentRecordId: subject.consentId,
      result: 'VERIFIED' as const,
      minimalResult: {
        statusDescription: 'Checked against the original card',
        maskedIdentifier: 'QXZKW****L',
      },
      evidenceRef: 'manual:card-photo-1',
    };

    const first = await service.createVerification(newCtx(), manual, key);
    const replay = await service.createVerification(newCtx(), manual, key);

    expect(first.verification).toMatchObject({
      method: 'MANUAL',
      result: 'VERIFIED',
      checkType: 'PAN',
      lockVersion: 0,
    });
    expect(replay.isReplayed).toBe(true);
    expect(replay.verification.id).toBe(first.verification.id);
    expect(await verificationRows(subject.customerId)).toHaveLength(1);
    expect(vendor.calls).toHaveLength(0);
  });

  it('P1-06 with no ACTIVE connection for the check the answer is 422 NO_ACTIVE_CONNECTION and the vendor is not called', async () => {
    const subject = await seedSubject();
    const { service, vendor } = build([gstOk]);
    await setConnectionStatus('VERIFICATION.GST', 'INACTIVE');
    try {
      await expect(
        service.runCheck(
          newCtx(),
          { ...panRequest(subject), check: 'GST', idNumber: GSTIN } as RunVerificationCheck,
          newKey(),
        ),
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        details: [{ field: 'check', issue: 'NO_ACTIVE_CONNECTION' }],
      });
    } finally {
      await setConnectionStatus('VERIFICATION.GST', 'ACTIVE');
    }
    expect(vendor.calls).toHaveLength(0);
    expect(await verificationRows(subject.customerId)).toHaveLength(0);
  });

  it('P1-06 production uses production connections only: a sandbox connection is not used, and a production one cannot use the development vault', async () => {
    const subject = await seedSubject();
    const { service, vendor } = build([panOk()], { nodeEnv: 'production' });

    // The tenant's Karza PAN connection is a sandbox one, so production does not use it.
    await expect(service.runCheck(newCtx(), panRequest(subject), newKey())).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [{ field: 'check', issue: 'NO_ACTIVE_CONNECTION' }],
    });

    // Made a production connection it is found, and the registry refuses the development vault before any call.
    const setEnvironment = (environment: string) =>
      sql`UPDATE app.integration_connection SET environment = ${environment}
           WHERE tenant_id = ${TENANT} AND provider = 'KARZA' AND capability = 'VERIFICATION.PAN'`.execute(
        admin,
      );
    await setEnvironment('PRODUCTION');
    try {
      await expect(service.runCheck(newCtx(), panRequest(subject), newKey())).rejects.toMatchObject({
        code: 'INTERNAL_ERROR',
        message: expect.stringContaining('development vault'),
      });
    } finally {
      await setEnvironment('SANDBOX');
    }
    expect(vendor.calls).toHaveLength(0);
    expect(await verificationRows(subject.customerId)).toHaveLength(0);
  });

  // ── permission and wiring ───────────────────────────────────────────────────────────────────────────────────────────────────
  it('P1-06 a user without verification.perform gets 403 and a server without a KYC port gets 503; neither calls the vendor', async () => {
    const subject = await seedSubject();
    const { service, vendor } = build([panOk()]);
    const readOnly: RequestContext = {
      ...newCtx(),
      principal: { ...principal, grants: [{ code: 'verification.read', scope: 'TENANT', branchIds: [] }] },
    };
    await expect(service.runCheck(readOnly, panRequest(subject), newKey())).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    const ids = createIdGenerator();
    const withoutPort = new VerificationService({
      txRunner,
      authz: createAuthz(),
      audit: createAuditPort(ids),
      ids,
      userDirectory: new FakeUserDirectoryPort(),
    });
    await expect(withoutPort.runCheck(newCtx(), panRequest(subject), newKey())).rejects.toMatchObject({
      code: 'DEPENDENCY_UNAVAILABLE',
    });
    expect(vendor.calls).toHaveLength(0);
    expect(await verificationRows(subject.customerId)).toHaveLength(0);
  });

  // ── the bank-account penny drop (it moves Rs 1) ────────────────────────────────────────────────────────────────────────────
  it('P1-06 a bank account whose holder name matches is stored as a PROVIDER_AUTOMATED BANK_ACCOUNT VERIFIED record with the masked account only', async () => {
    const subject = await seedSubject();
    const { service, vendor } = build([bankOk()]);

    const { verification, isReplayed } = await service.runCheck(
      newCtx(),
      bankRequest(subject, { name: HOLDER_TYPED }),
      newKey(),
    );

    expect(isReplayed).toBeFalsy();
    expect(verification).toMatchObject({
      checkType: 'BANK_ACCOUNT',
      method: 'PROVIDER_AUTOMATED',
      result: 'VERIFIED',
      subjectType: 'CUSTOMER',
      subjectId: subject.customerId,
      consentRecordId: subject.consentId,
      purpose: 'KYC',
      performedBy: USER,
      lockVersion: 0,
      evidenceRef: 'KARZA:req_bank_int_1',
      minimalResult: {
        maskedIdentifier: ACCOUNT_MASKED,
        nameMatchScore: 100,
        providerReference: 'req_bank_int_1',
        discrepancies: [],
      },
    });
    const rows = await verificationRows(subject.customerId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: verification.id,
      check_type: 'BANK_ACCOUNT',
      method: 'PROVIDER_AUTOMATED',
      result: 'VERIFIED',
    });
    // The vendor received the full account number once, with the IFSC and the consent flag; the key came from the vault, in a header.
    expect(vendor.calls).toHaveLength(1);
    expect(vendor.calls[0]?.url).toBe('https://kyc.example.test/v3/bank');
    expect(vendor.calls[0]?.body).toMatchObject({ accountNumber: ACCOUNT, ifsc: IFSC, consent: 'Y' });
    expect(vendor.calls[0]?.headers['x-karza-key']).toBe('mock_karza_api_key_sand_99999');
    // The response holds neither the account number nor the name the bank holds.
    expect(JSON.stringify(verification)).not.toContain(ACCOUNT);
    expect(JSON.stringify(verification)).not.toContain(HOLDER_ON_RECORD);
  });

  it('P1-06 a bank check without a name stands on the bank saying the Rs 1 credit went through, and its audit event carries the masked account only', async () => {
    const subject = await seedSubject();
    const { verification } = await build([bankOk()]).service.runCheck(
      newCtx(),
      bankRequest(subject),
      newKey(),
    );

    expect(verification.result).toBe('VERIFIED');
    expect(verification.minimalResult).not.toHaveProperty('nameMatchScore');
    const audit = await sql<{ action: string; after: Record<string, unknown> }>`
      SELECT action, after FROM app.audit_event WHERE entity_id = ${verification.id}`.execute(admin);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.after).toMatchObject({
      checkType: 'BANK_ACCOUNT',
      method: 'PROVIDER_AUTOMATED',
      result: 'VERIFIED',
      provider: 'KARZA',
      maskedIdentifier: ACCOUNT_MASKED,
    });
    expect(JSON.stringify(audit.rows[0]?.after)).not.toContain(ACCOUNT);
    expect(JSON.stringify(audit.rows[0]?.after)).not.toContain(HOLDER_ON_RECORD);
  });

  it("P1-06 the bank's decisions are stored: a name mismatch and an invalid account are REJECTED, a failed Rs 1 credit and a missing name are INCONCLUSIVE", async () => {
    const decisions: [string, Reply, Record<string, unknown>, string, string][] = [
      ['a name that does not match', bankOk(), { name: 'Mohan Lal Gupta' }, 'REJECTED', 'NAME_MISMATCH'],
      ['an invalid account (102)', vendorCode('102'), {}, 'REJECTED', 'ID_INVALID'],
      ['an account the bank does not know (103)', vendorCode('103'), {}, 'REJECTED', 'NOT_FOUND'],
      [
        'a bank that does not support the check (107)',
        vendorCode('107'),
        {},
        'INCONCLUSIVE',
        'NOT_SUPPORTED',
      ],
      ['the Rs 1 credit failed', bankOk({ bankTxnStatus: false }), {}, 'INCONCLUSIVE', 'BANK_TXN_FAILED'],
      [
        'a name asked for but not returned',
        bankOk({ accountName: undefined }),
        { name: HOLDER_TYPED },
        'INCONCLUSIVE',
        'NAME_NOT_RETURNED',
      ],
    ];
    for (const [label, reply, extra, result, reason] of decisions) {
      const subject = await seedSubject();
      const { service, vendor } = build([reply, bankOk()]);
      const key = newKey();

      const first = await service.runCheck(newCtx(), bankRequest(subject, extra), key);
      expect(first.verification, label).toMatchObject({
        checkType: 'BANK_ACCOUNT',
        result,
        minimalResult: { maskedIdentifier: ACCOUNT_MASKED, discrepancies: [reason] },
      });
      expect(await verificationRows(subject.customerId), label).toHaveLength(1);

      // A decision uses the key up as well: the same key replays it and the Rs 1 is not sent again.
      const replay = await service.runCheck(newCtx(), bankRequest(subject, extra), key);
      expect(replay.isReplayed, label).toBe(true);
      expect(replay.verification, label).toEqual(first.verification);
      expect(vendor.calls, label).toHaveLength(1);
    }
  });

  it('P1-06 THE MONEY RULE: when it cannot be known whether the Rs 1 was sent, the check is stored INCONCLUSIVE / OUTCOME_UNKNOWN and the key is used up', async () => {
    const unknown: [string, Reply][] = [
      ['a timeout', timeout()],
      ['a dropped connection', dropped()],
      ['HTTP 503', answer(503, {})],
      ['HTTP 500', answer(500, {})],
      ['HTTP 408', answer(408, {})],
      ['an answer that is not a JSON object', answer(200, 'upstream gateway timeout')],
      [
        'an answer the adapter does not recognise (status-code 999)',
        answer(200, { 'status-code': '999', result: {} }),
      ],
      [
        'a positive answer that does not say whether the Rs 1 went through',
        answer(200, { request_id: 'req_u', 'status-code': '101', result: { accountName: HOLDER_ON_RECORD } }),
      ],
    ];
    for (const [label, reply] of unknown) {
      const subject = await seedSubject();
      // The second answer would VERIFY the account: it is only ever used by a deliberate new attempt, never by a retry of the key.
      const { service, vendor } = build([reply, bankOk()]);
      const key = newKey();

      const first = await service.runCheck(newCtx(), bankRequest(subject, { name: HOLDER_TYPED }), key);

      expect(first.isReplayed, label).toBeFalsy();
      expect(first.verification, label).toMatchObject({
        checkType: 'BANK_ACCOUNT',
        method: 'PROVIDER_AUTOMATED',
        result: 'INCONCLUSIVE',
        minimalResult: {
          maskedIdentifier: ACCOUNT_MASKED,
          discrepancies: ['OUTCOME_UNKNOWN'],
          statusDescription: expect.stringContaining('Rs 1'),
        },
      });
      // The evidence reference carries the vendor's case id, so the transfer can be looked up with the provider.
      expect(first.verification.evidenceRef, label).toMatch(/^KARZA:(idem_[0-9a-f]{20}|req_u)$/);
      expect(await verificationRows(subject.customerId), label).toHaveLength(1);
      expect(await idempotencyRows(key), label).toHaveLength(1);
      expect(JSON.stringify(first.verification), label).not.toContain(ACCOUNT);

      // The same key replays the stored record. The vendor is not asked again, so the Rs 1 cannot be sent twice.
      const retry = await service.runCheck(newCtx(), bankRequest(subject, { name: HOLDER_TYPED }), key);
      expect(retry.isReplayed, label).toBe(true);
      expect(retry.verification, label).toEqual(first.verification);
      expect(vendor.calls, label).toHaveLength(1);
      expect(await verificationRows(subject.customerId), label).toHaveLength(1);

      // A new key is a deliberate new attempt: it reaches the vendor again, with another case id.
      const again = await service.runCheck(newCtx(), bankRequest(subject, { name: HOLDER_TYPED }), newKey());
      expect(again.verification.result, label).toBe('VERIFIED');
      expect(vendor.calls, label).toHaveLength(2);
      const caseIds = caseIdsOf(vendor.calls);
      expect(caseIds[0], label).not.toBe(caseIds[1]);
    }
  });

  it('P1-06 an answer that proves nothing was sent is thrown: nothing is stored, and the same key can be retried with the same case id', async () => {
    const notSent: [string, Reply, string][] = [
      ['HTTP 429', answer(429, {}), 'RATE_LIMITED'],
      ['HTTP 401', answer(401, {}), 'INTERNAL_ERROR'],
      ['HTTP 403', answer(403, {}), 'INTERNAL_ERROR'],
      ['HTTP 404', answer(404, {}), 'NOT_FOUND'],
      ['HTTP 400', answer(400, {}), 'VALIDATION_ERROR'],
      ['HTTP 422', answer(422, {}), 'VALIDATION_ERROR'],
      ['the source being busy (104)', vendorCode('104'), 'DEPENDENCY_UNAVAILABLE'],
      ['the source being unavailable (108)', vendorCode('108'), 'DEPENDENCY_UNAVAILABLE'],
    ];
    for (const [label, reply, code] of notSent) {
      const subject = await seedSubject();
      const { service, vendor } = build([reply, bankOk()]);
      const key = newKey();

      await expect(service.runCheck(newCtx(), bankRequest(subject), key), label).rejects.toMatchObject({
        code,
      });
      expect(await verificationRows(subject.customerId), label).toHaveLength(0);
      expect(await idempotencyRows(key), label).toHaveLength(0);

      const retry = await service.runCheck(newCtx(), bankRequest(subject), key);
      expect(retry.verification.result, label).toBe('VERIFIED');
      expect(retry.isReplayed, label).toBeFalsy();
      const caseIds = caseIdsOf(vendor.calls);
      expect(caseIds, label).toHaveLength(2);
      expect(caseIds[0], label).toBe(caseIds[1]);
    }
  });

  it('P1-06 our own validation and a missing connection stop a bank check before the vendor: thrown, nothing stored', async () => {
    const subject = await seedSubject();
    const { service, vendor } = build([bankOk()]);

    // The request schema normally catches this; the adapter checks again, so a caller that skipped it still sends nothing.
    await expect(
      service.runCheck(newCtx(), bankRequest(subject, { ifsc: 'HDFC1001234' }), newKey()),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    await setConnectionStatus('VERIFICATION.BANK', 'INACTIVE');
    try {
      await expect(service.runCheck(newCtx(), bankRequest(subject), newKey())).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        details: [{ field: 'check', issue: 'NO_ACTIVE_CONNECTION' }],
      });
    } finally {
      await setConnectionStatus('VERIFICATION.BANK', 'ACTIVE');
    }
    expect(vendor.calls).toHaveLength(0);
    expect(await verificationRows(subject.customerId)).toHaveLength(0);
  });

  it('P1-06 bank: the same key twice sends the Rs 1 once; a different account or name under that key is refused (422 IDEMPOTENCY_KEY_REUSED)', async () => {
    const subject = await seedSubject();
    const { service, vendor } = build([bankOk()]);
    const key = newKey();

    const first = await service.runCheck(newCtx(), bankRequest(subject), key);
    const second = await service.runCheck(newCtx(), bankRequest(subject), key);

    expect(first.isReplayed).toBeFalsy();
    expect(second.isReplayed).toBe(true);
    expect(second.verification).toEqual(first.verification);
    await expect(
      service.runCheck(newCtx(), bankRequest(subject, { accountNumber: '918273645019' }), key),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    await expect(
      service.runCheck(newCtx(), bankRequest(subject, { name: 'Someone Else' }), key),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    await expect(
      service.runCheck(newCtx(), bankRequest(subject, { ifsc: 'SBIN0001234' }), key),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    expect(vendor.calls).toHaveLength(1);
    expect(await verificationRows(subject.customerId)).toHaveLength(1);
  });

  it('P1-06 bank: two concurrent requests with one key send the Rs 1 once (the second waits, then replays)', async () => {
    const subject = await seedSubject();
    const { service, vendor } = build([bankOk()], { delayMs: 400 });
    const key = newKey();

    const [a, b] = await Promise.all([
      service.runCheck(newCtx(), bankRequest(subject), key),
      service.runCheck(newCtx(), bankRequest(subject), key),
    ]);

    expect(vendor.calls).toHaveLength(1);
    expect([Boolean(a.isReplayed), Boolean(b.isReplayed)].sort()).toEqual([false, true]);
    expect(a.verification.id).toBe(b.verification.id);
    expect(await verificationRows(subject.customerId)).toHaveLength(1);
  });

  it('P1-06 bank: the idempotency row holds a keyed hash, not the plain SHA-256 of a request that carries an account number', async () => {
    const subject = await seedSubject();
    const key = newKey();
    const request = bankRequest(subject, { name: HOLDER_TYPED });
    await build([bankOk()]).service.runCheck(newCtx(), request, key);

    const rows = await idempotencyRows(key);
    expect(rows).toHaveLength(1);
    const plain = requestHash({ key, method: 'POST', path: '/v1/verifications/checks', body: request });
    expect(rows[0]?.request_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]?.request_hash).not.toBe(plain);
  });

  // ── the leak test ───────────────────────────────────────────────────────────────────────────────────────────────────────────
  it('P1-06 after all of the above, the full PAN, GSTIN and account number, and the holder name, are in no table of the database', async () => {
    // One more run of each check, so the scan has fresh rows to look at even when this test runs alone. The last bank answer is an
    // unknown outcome (a dropped connection), which is stored as well.
    const subject = await seedSubject();
    const { service, vendor } = build([panOk(), gstOk, bankOk(), dropped()]);
    await service.runCheck(newCtx(), panRequest(subject, { name: 'Ravi Kumar Sharma' }), newKey());
    await service.runCheck(
      newCtx(),
      { ...panRequest(subject), check: 'GST', idNumber: GSTIN } as RunVerificationCheck,
      newKey(),
    );
    const bank = await service.runCheck(newCtx(), bankRequest(subject, { name: HOLDER_TYPED }), newKey());
    const unknown = await service.runCheck(newCtx(), bankRequest(subject, { name: HOLDER_TYPED }), newKey());
    expect(bank.verification.result).toBe('VERIFIED');
    expect(unknown.verification.result).toBe('INCONCLUSIVE');
    // The vendor, and only the vendor, was given the PAN, the GSTIN and the account number.
    expect(vendor.calls.filter((c) => c.body.pan === PAN)).toHaveLength(1);
    expect(vendor.calls.filter((c) => c.body.gstin === GSTIN)).toHaveLength(1);
    expect(vendor.calls.filter((c) => c.body.accountNumber === ACCOUNT)).toHaveLength(2);

    const tables = await sql<{ table_schema: string; table_name: string }>`
      SELECT table_schema, table_name FROM information_schema.tables
       WHERE table_type = 'BASE TABLE' AND table_schema IN ('app', 'public')`.execute(admin);
    expect(tables.rows.length).toBeGreaterThan(50);
    const hits: string[] = [];
    for (const t of tables.rows) {
      for (const secret of [PAN, GSTIN, ACCOUNT, HOLDER_ON_RECORD]) {
        const found = await sql<{ n: number }>`
          SELECT count(*)::int AS n FROM ${sql.id(t.table_schema, t.table_name)} AS t
           WHERE t::text ILIKE ${`%${secret}%`}`.execute(admin);
        if ((found.rows[0]?.n ?? 0) > 0)
          hits.push(`${t.table_schema}.${t.table_name} holds ${secret.slice(0, 5)}...`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('P1-06 each run leaves exactly one immutable row, and nothing can change it afterwards', async () => {
    const subject = await seedSubject();
    const { verification } = await build([panOk()]).service.runCheck(newCtx(), panRequest(subject), newKey());

    await expect(
      sql`UPDATE app.verification SET result = 'VERIFIED' WHERE id = ${verification.id}`.execute(admin),
    ).rejects.toThrow();
    await expect(
      sql`DELETE FROM app.verification WHERE id = ${verification.id}`.execute(admin),
    ).rejects.toThrow();
  });
});
