// P2-04 lender document packs against a real database (owner: Dipanshu). A throwaway PostgreSQL 16 container with every migration
// applied, connected as dsa_api with the production dependencies, and in-memory file stores. The package is built and frozen by the
// real lender-case API (buildPackage), so the download's manifest check is proven against the builder's own hash. Two documents: a
// staff upload (MOD-DOC document_version, no hash in the manifest) and a customer upload-link file (uploaded_document, hash in the
// manifest). Synthetic data only.
import { LenderPackProfileSchema, type PermissionCode } from '@dsa/contracts';
import { createIdGenerator } from '@dsa/kernel';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startIsolationEnv, type IsolationEnv } from '../../../tests/isolation/harness';

const ids = createIdGenerator();
const sha = (b: Buffer | Uint8Array) => createHash('sha256').update(b).digest('hex');

/** In-memory object store keyed by tenant and key (the DocumentObjectStore and customer-upload store shapes). */
class MemoryStore {
  readonly files = new Map<string, Buffer>();
  async put(tenantId: string, name: string, bytes: Buffer): Promise<string> {
    const key = `${tenantId}/${name}`;
    this.files.set(key, bytes);
    return key;
  }
  async get(_tenantId: string, key: string): Promise<Buffer | null> {
    return this.files.get(key) ?? null;
  }
}
const staffStore = new MemoryStore();
const customerStore = new MemoryStore();

let env: IsolationEnv;
const OPS: PermissionCode[] = ['lender_case.submit', 'application.read'];
const ADMIN: PermissionCode[] = ['lender.manage'];
const S = {
  lenderId: '',
  versionId: '',
  empanelmentId: '',
  appId: '',
  customerId: '',
  caseId: '',
  panItem: '',
  bankItem: '',
  panDoc: '',
  panVersion: '',
};
const PAN = Buffer.from('%PDF-1.4 synthetic PAN card for a test applicant');
const BANK = Buffer.from('%PDF-1.4 synthetic bank statement, Jan to Jun');
const ops = () => env.appAs(env.A, OPS);
const pack = (app = ops()) =>
  request(app)
    .get(`/v1/lender-cases/${S.caseId}/pack`)
    .buffer(true)
    .parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
const entries = (body: Buffer) => unzipSync(new Uint8Array(body));

beforeAll(async () => {
  env = await startIsolationEnv({ documentStore: staffStore });
  env.deps.customerUploadStore = customerStore;
  const t = env.A;
  const u = t.userIds[0];
  const q = (text: string, values: unknown[]) => env.admin.query(text, values);
  S.lenderId = ids.next('lnd');
  const productId = ids.next('prd');
  S.versionId = ids.next('prv');
  S.empanelmentId = ids.next('emp');
  await q(
    `insert into app.lender (id, tenant_id, name, lender_type, created_by, updated_by) values ($1, $2, 'Pack Bank', 'BANK', $3, $3)`,
    [S.lenderId, t.tenantId, u],
  );
  await q(
    `insert into app.loan_product (id, tenant_id, lender_id, name, category, applicant_types, secured, created_by, updated_by)
     values ($1, $2, $3, 'Pack PL', 'PL', '{SALARIED}', false, $4, $4)`,
    [productId, t.tenantId, S.lenderId, u],
  );
  await q(
    `insert into app.loan_product_version (id, tenant_id, product_id, version_no, effective_from, amount_min, amount_max, currency,
                                           tenure_min_months, tenure_max_months, created_by)
     values ($1, $2, $3, 1, '2026-01-01T00:00:00Z', 50000, 1500000, 'INR', 12, 60, $4)`,
    [S.versionId, t.tenantId, productId, u],
  );
  await q(
    `insert into app.empanelment (id, tenant_id, organisation_id, lender_id, dsa_code, valid_range, permitted_categories, status,
                                  created_by, updated_by)
     values ($1, $2, $3, $4, 'DSA-PACK', daterange(current_date - 30, current_date + 365), '{PL}', 'ACTIVE', $5, $5)`,
    [S.empanelmentId, t.tenantId, t.orgId, S.lenderId, u],
  );
  S.customerId = ids.next('cust');
  S.appId = ids.next('app');
  const party = ids.next('pty');
  await q(
    `insert into app.customer (id, tenant_id, party_type, full_name, home_branch_id, created_by, updated_by)
     values ($1, $2, 'INDIVIDUAL', 'Pack Customer', $3, $4, $4)`,
    [S.customerId, t.tenantId, t.branchId, u],
  );
  await q(
    `insert into app.loan_application (id, tenant_id, branch_id, customer_id, product_category, requested_amount, tenure_months,
                                       applicant_type, status, sales_owner_id, created_by, updated_by)
     values ($1, $2, $3, $4, 'PL', 500000.00, 36, 'SALARIED', 'DRAFT', $5, $5, $5)`,
    [S.appId, t.tenantId, t.branchId, S.customerId, u],
  );
  await q(
    `insert into app.application_party (id, tenant_id, application_id, customer_id, role, party_type, created_by)
     values ($1, $2, $3, $4, 'PRIMARY', 'INDIVIDUAL', $5)`,
    [party, t.tenantId, S.appId, S.customerId, u],
  );
  S.panItem = ids.next('chk');
  S.bankItem = ids.next('chk');
  for (const [id, type] of [
    [S.panItem, 'PAN'],
    [S.bankItem, 'BANK_STATEMENT'],
  ] as const) {
    await q(
      `insert into app.checklist_item (id, tenant_id, application_id, party_id, document_type_code, mandatory, status,
                                       source_decision_id, reviewed_by, reviewed_at, created_by, updated_by)
       values ($1, $2, $3, $4, $5, true, 'ACCEPTED', 'dec_pack_int', $6, now(), $6, $6)`,
      [id, t.tenantId, S.appId, party, type, u],
    );
  }
  // PAN: a staff upload through MOD-DOC (document + version), file kept in the staff store.
  S.panDoc = ids.next('doc');
  S.panVersion = ids.next('dvr');
  const panKey = await staffStore.put(t.tenantId, `${S.panVersion}.pdf`, PAN);
  await q(
    `insert into app.document (id, tenant_id, owner_type, owner_id, application_id, checklist_item_id, document_type_code,
                               created_by, updated_by)
     values ($1, $2, 'PARTY', $3, $4, $5, 'PAN', $6, $6)`,
    [S.panDoc, t.tenantId, party, S.appId, S.panItem, u],
  );
  await q(
    `insert into app.document_version (id, tenant_id, document_id, version_no, object_key, file_name, sha256, size_bytes,
                                       detected_mime, scan_status, review_status, uploaded_by, uploaded_via, created_at)
     values ($1, $2, $3, 1, $4, 'my pan scan.pdf', $5, $6, 'application/pdf', 'CLEAN', 'ACCEPTED', $7, 'STAFF',
             now() - interval '1 hour')`,
    [S.panVersion, t.tenantId, S.panDoc, panKey, sha(PAN), PAN.length, u],
  );
  await q(`update app.document set current_version_id = $2 where id = $1`, [S.panDoc, S.panVersion]);
  await q(`update app.checklist_item set document_id = $2 where id = $1`, [S.panItem, S.panDoc]);
  // Bank statement: uploaded by the customer through an upload link, file kept in the customer store.
  const bankDoc = ids.next('doc');
  const bankPath = await customerStore.put(t.tenantId, `${bankDoc}.pdf`, BANK);
  await q(
    `insert into app.uploaded_document (id, tenant_id, application_id, checklist_item_id, file_name, file_size_bytes, mime_type,
                                        storage_path, sha256_hash, created_by, updated_by)
     values ($1, $2, $3, $4, 'statement.pdf', $5, 'application/pdf', $6, $7, $8, $8)`,
    [bankDoc, t.tenantId, S.appId, S.bankItem, BANK.length, bankPath, sha(BANK), u],
  );
  await q(`update app.checklist_item set document_id = $2 where id = $1`, [S.bankItem, bankDoc]);
  await q(
    `insert into app.consent_record (id, tenant_id, subject_type, subject_id, purpose, purpose_target, notice_version, channel,
                                     captured_by, captured_at)
     values ($1, $2, 'CUSTOMER', $3, 'SHARE_WITH_LENDER', $4, 'V1.0', 'IN_PERSON', $5, now())`,
    [ids.next('cnst'), t.tenantId, S.customerId, S.lenderId, u],
  );
  const created = await request(ops())
    .post(`/v1/applications/${S.appId}/lender-cases`)
    .send({ lenderId: S.lenderId, productVersionId: S.versionId, empanelmentId: S.empanelmentId });
  if (created.status !== 201) throw new Error(`lender case: ${JSON.stringify(created.body)}`);
  S.caseId = created.body.id;
}, 240_000);
afterAll(async () => {
  await env?.stop();
});

describe('P2-04 lender document packs against PostgreSQL', () => {
  it('TEST-PACK-INT-001 a lender without a profile gets the default; a case with no package cannot be downloaded (409)', async () => {
    const res = await request(ops()).get(`/v1/lenders/${S.lenderId}/pack-profile`);
    expect(res.status).toBe(200);
    expect(res.headers.etag).toBe('"0"');
    expect(LenderPackProfileSchema.parse(res.body)).toMatchObject({
      isDefault: true,
      documentOrder: [],
      filenamePattern: '{seq}_{docType}',
    });
    const none = await pack();
    expect(none.status).toBe(409);
    expect(JSON.parse(none.body.toString()).error.details[0].issue).toBe('NO_PACKAGE');
  });

  it('TEST-PACK-INT-002 an unfrozen package is refused; once frozen, the ZIP holds exactly its documents and the manifest hash checks out', async () => {
    const draft = await request(ops()).post(`/v1/lender-cases/${S.caseId}/package`).send({ freeze: false });
    expect(draft.status, JSON.stringify(draft.body)).toBe(200);
    const unfrozen = await pack();
    expect(unfrozen.status).toBe(409);
    expect(JSON.parse(unfrozen.body.toString()).error.details[0].issue).toBe('PACKAGE_NOT_FROZEN');

    const built = await request(ops()).post(`/v1/lender-cases/${S.caseId}/package`).send({ freeze: true });
    expect(built.status, JSON.stringify(built.body)).toBe(200);
    const res = await pack();
    expect(res.status, res.body.toString()).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['content-disposition']).toBe(`attachment; filename="lender-pack-${S.caseId}.zip"`);
    const stored = await env.admin.query(
      `select id, manifest_sha256 from app.submission_package where id = $1`,
      [built.body.package.id],
    );
    expect(res.headers['x-package-id']).toBe(stored.rows[0].id);
    expect(res.headers['x-manifest-sha256']).toBe(String(stored.rows[0].manifest_sha256).trim());
    const files = entries(res.body);
    // Default profile: the manifest's order (party, then type code), named {seq}_{docType}.
    expect(Object.keys(files)).toEqual(['1_BANK_STATEMENT.pdf', '2_PAN.pdf']);
    expect(sha(files['1_BANK_STATEMENT.pdf']!)).toBe(sha(BANK));
    expect(sha(files['2_PAN.pdf']!)).toBe(sha(PAN));
  });

  it("TEST-PACK-INT-003 the lender's profile sets the order and the names; a stale If-Match is a 409", async () => {
    const admin = env.appAs(env.A, ADMIN);
    const saved = await request(admin)
      .put(`/v1/lenders/${S.lenderId}/pack-profile`)
      .set('If-Match', '"0"')
      .send({ documentOrder: ['PAN', 'BANK_STATEMENT'], filenamePattern: '{seq}_{docType}_{party}' });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body).toMatchObject({ isDefault: false, version: 1 });
    expect(saved.headers.etag).toBe('"1"');
    const stale = await request(admin)
      .put(`/v1/lenders/${S.lenderId}/pack-profile`)
      .set('If-Match', '"0"')
      .send({ documentOrder: [], filenamePattern: '{seq}' });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');

    const files = entries((await pack()).body);
    expect(Object.keys(files)).toEqual(['1_PAN_Applicant.pdf', '2_BANK_STATEMENT_Applicant.pdf']);

    const again = await request(admin)
      .put(`/v1/lenders/${S.lenderId}/pack-profile`)
      .set('If-Match', '"1"')
      .send({ documentOrder: ['PAN'], filenamePattern: '{seq}-{original}' });
    expect(again.status).toBe(200);
    expect(again.body.version).toBe(2);
    expect(Object.keys(entries((await pack()).body))).toEqual(['1-my-pan-scan.pdf', '2-statement.pdf']);
  });

  it('TEST-PACK-INT-004 each download is audited without file names, and each staff document version gets an access-log row', async () => {
    const before = await env.admin.query(
      `select count(*)::int as n from app.document_access_log where version_id = $1`,
      [S.panVersion],
    );
    expect((await pack()).status).toBe(200);
    const after = await env.admin.query(
      `select action, principal_id, purpose from app.document_access_log where version_id = $1 order by at desc`,
      [S.panVersion],
    );
    expect(after.rows.length).toBe(before.rows[0].n + 1);
    expect(after.rows[0]).toMatchObject({
      action: 'DOWNLOAD',
      principal_id: env.A.userIds[0],
      purpose: `lender pack ${S.caseId}`,
    });
    const audit = await env.admin.query(
      `select after from app.audit_event where action = 'lender_case.pack_downloaded' and entity_id = $1 order by occurred_at desc limit 1`,
      [S.caseId],
    );
    expect(audit.rows[0].after).toMatchObject({ fileCount: 2, defaultProfile: false });
    expect(JSON.stringify(audit.rows[0].after)).not.toMatch(/statement|pan scan|Pack Customer/i);
  });

  it('TEST-PACK-INT-005 the pack is the frozen manifest, never the live documents: a version uploaded after the freeze is not used', async () => {
    const newer = Buffer.from('%PDF-1.4 a newer PAN scan, uploaded after the freeze');
    const v2 = ids.next('dvr');
    const key = await staffStore.put(env.A.tenantId, `${v2}.pdf`, newer);
    await env.admin.query(
      `insert into app.document_version (id, tenant_id, document_id, version_no, object_key, file_name, sha256, size_bytes,
                                         detected_mime, scan_status, review_status, uploaded_by, uploaded_via, created_at)
       values ($1, $2, $3, 2, $4, 'new pan.pdf', $5, $6, 'application/pdf', 'CLEAN', 'ACCEPTED', $7, 'STAFF', now() + interval '1 minute')`,
      [v2, env.A.tenantId, S.panDoc, key, sha(newer), newer.length, env.A.userIds[0]],
    );
    await env.admin.query(`update app.document set current_version_id = $2 where id = $1`, [S.panDoc, v2]);
    const files = entries((await pack()).body);
    expect(sha(files['1-my-pan-scan.pdf']!)).toBe(sha(PAN));
  });

  it('TEST-PACK-INT-006 a stored file whose bytes changed is refused (409 CONTENT_HASH_MISMATCH); a missing one is 409 INVALID_STATE', async () => {
    const [bankKey] = [...customerStore.files.keys()];
    const original = customerStore.files.get(bankKey!)!;
    customerStore.files.set(bankKey!, Buffer.from('tampered'));
    const altered = await pack();
    expect(altered.status).toBe(409);
    const a = JSON.parse(altered.body.toString()).error;
    expect(a.code).toBe('CONTENT_HASH_MISMATCH');
    expect(a.details[0]).toMatchObject({ issue: 'FILE_ALTERED', meta: { checklistItemId: S.bankItem } });

    customerStore.files.delete(bankKey!);
    const gone = await pack();
    expect(gone.status).toBe(409);
    const g = JSON.parse(gone.body.toString()).error;
    expect(g.code).toBe('INVALID_STATE');
    expect(g.details[0]).toMatchObject({
      issue: 'DOCUMENT_UNAVAILABLE',
      meta: { checklistItemId: S.bankItem },
    });
    customerStore.files.set(bankKey!, original);
    expect((await pack()).status).toBe(200);
  });

  it('TEST-PACK-INT-007 another tenant gets 404 for the case and the lender; the permissions are enforced', async () => {
    expect((await pack(env.appAs(env.B, OPS))).status).toBe(404);
    expect(
      (await request(env.appAs(env.B, ADMIN)).get(`/v1/lenders/${S.lenderId}/pack-profile`)).status,
    ).toBe(404);
    expect(
      (
        await request(env.appAs(env.B, ADMIN))
          .put(`/v1/lenders/${S.lenderId}/pack-profile`)
          .set('If-Match', '"0"')
          .send({ documentOrder: [], filenamePattern: '{seq}_{docType}' })
      ).status,
    ).toBe(404);
    expect((await pack(env.appAs(env.A, ['application.read', 'document.download']))).status).toBe(403);
    expect(
      (
        await request(env.appAs(env.A, OPS))
          .put(`/v1/lenders/${S.lenderId}/pack-profile`)
          .set('If-Match', '"2"')
          .send({ documentOrder: [], filenamePattern: '{seq}_{docType}' })
      ).status,
    ).toBe(403);
  });

  it('TEST-PACK-INT-008 row-level security keeps profiles per tenant and the API role cannot delete one', async () => {
    const api = await import('pg').then(
      (m) => new m.default.Client({ connectionString: env.apiDatabaseUrl }),
    );
    await api.connect();
    try {
      await api.query('BEGIN');
      await api.query(`SELECT set_config('app.tenant_id', $1, true)`, [env.B.tenantId]);
      expect((await api.query(`select id from app.lender_pack_profile`)).rows).toEqual([]);
      await api.query('ROLLBACK');
      await api.query('BEGIN');
      await api.query(`SELECT set_config('app.tenant_id', $1, true)`, [env.A.tenantId]);
      await expect(api.query(`delete from app.lender_pack_profile`)).rejects.toThrow(/permission denied/);
      await api.query('ROLLBACK');
    } finally {
      await api.end();
    }
  });
});
