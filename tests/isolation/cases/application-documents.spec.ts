// TEST-SEC-001 cases for application documents and legal holds (owner: Dev 3, MOD-DOC slice of Module 16; MOD-PRV legal holds).
// Tenant A creates its records through the real API (uploads are kept in memory, not on disk). Tenant B, holding every document,
// application and privacy permission, must not create, read, open, download, review, archive or hold any of them.
// Named operationIds: API-DOC-001, API-DOC-001-PUT, API-DOC-002, API-DOC-003, API-DOC-004, API-DOC-004-GET, API-DOC-005,
// API-DOC-006, API-DOC-007, API-DOC-008, API-DOC-009, API-DOC-009-STATUS, API-PRV-004, API-PRV-004-LIST.
import crypto from 'node:crypto';
import type { PermissionCode } from '@dsa/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startIsolationEnv, type IsolationEnv } from '../harness';

let env: IsolationEnv;
const APP = 'app_iso_doc_a1';
const CUST = 'cust_iso_doc_a1';
const PARTY = 'pty_iso_doc_a1';
const ITEM_DONE = 'chk_iso_doc_pan';
const ITEM_PENDING = 'chk_iso_doc_bank';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF\n');
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

const EVERY: PermissionCode[] = [
  'document.upload',
  'document.view',
  'document.download',
  'document.review',
  'document.waive',
  'application.read',
  'privacy.manage',
  'config.manage',
];
let seq = 0;
const key = (label: string) => `iso-doc-${label}-${seq++}`;

// Tenant A's records, created in beforeAll.
let documentId = '';
let versionId = '';
let pendingIntentId = '';
let pendingUploadUrl = '';
let archiveId = '';
let holdId = '';
let viewUrl = '';

/** Keeps uploaded files in memory for the test, so nothing is written under ./uploads. */
class MemoryDocumentStore {
  private readonly files = new Map<string, Buffer>();
  async put(tenantId: string, name: string, bytes: Buffer): Promise<string> {
    const objectKey = `${tenantId}/${name}`;
    this.files.set(objectKey, Buffer.from(bytes));
    return objectKey;
  }
  async get(_tenantId: string, objectKey: string): Promise<Buffer | null> {
    return this.files.get(objectKey) ?? null;
  }
}

const tenantA = () => env.appAs(env.A, EVERY);
const tenantB = () => env.appAs(env.B, EVERY);
const one = async (text: string, params: unknown[]) => (await env.admin.query(text, params)).rows[0];

beforeAll(async () => {
  env = await startIsolationEnv();
  env.deps.documentStore = new MemoryDocumentStore();
  const a = env.A;
  const q = (text: string, values: unknown[]) => env.admin.query(text, values);
  await q(
    `insert into app.customer (id, tenant_id, party_type, full_name, home_branch_id, created_by, updated_by)
     values ($1, $2, 'INDIVIDUAL', 'Isolation Document Customer', $3, $4, $4)`,
    [CUST, a.tenantId, a.branchId, a.userIds[0]],
  );
  await q(
    `insert into app.loan_application (id, tenant_id, branch_id, customer_id, product_category, requested_amount,
                                       applicant_type, status, sales_owner_id, created_by, updated_by)
     values ($1, $2, $3, $4, 'PL', 300000, 'SALARIED', 'DRAFT', $5, $5, $5)`,
    [APP, a.tenantId, a.branchId, CUST, a.userIds[0]],
  );
  await q(
    `insert into app.application_party (id, tenant_id, application_id, customer_id, role, party_type, created_by)
     values ($1, $2, $3, $4, 'PRIMARY', 'INDIVIDUAL', $5)`,
    [PARTY, a.tenantId, APP, CUST, a.userIds[0]],
  );
  for (const [id, code] of [
    [ITEM_DONE, 'PAN_CARD'],
    [ITEM_PENDING, 'BANK_STATEMENT'],
  ]) {
    await q(
      `insert into app.checklist_item (id, tenant_id, application_id, party_id, document_type_code, mandatory,
                                       source_decision_id, created_by, updated_by)
       values ($1, $2, $3, $4, $5, true, 'dr_iso_doc', $6, $6)`,
      [id, a.tenantId, APP, PARTY, code, a.userIds[0]],
    );
  }

  // A clean document version: upload intent, signed PUT, completion.
  const app = tenantA();
  const intent = await request(app)
    .post('/v1/documents/upload-intents')
    .set('Idempotency-Key', key('a-intent'))
    .send({
      checklistItemId: ITEM_DONE,
      fileName: 'pan.pdf',
      sizeBytes: PDF.length,
      mimeType: 'application/pdf',
      sha256: sha(PDF),
    });
  expect(intent.status, JSON.stringify(intent.body)).toBe(201);
  const put = await request(app).put(intent.body.url).set('Content-Type', 'application/pdf').send(PDF);
  expect(put.status, JSON.stringify(put.body)).toBe(204);
  const done = await request(app)
    .post(`/v1/upload-intents/${intent.body.uploadIntentId}/completion`)
    .send({});
  expect(done.status, JSON.stringify(done.body)).toBe(202);
  documentId = done.body.documentId;
  versionId = done.body.versionId;

  // An upload that is still waiting for its bytes.
  const pending = await request(app)
    .post('/v1/documents/upload-intents')
    .set('Idempotency-Key', key('a-pending'))
    .send({
      checklistItemId: ITEM_PENDING,
      fileName: 'bank.pdf',
      sizeBytes: PDF.length,
      mimeType: 'application/pdf',
      sha256: sha(PDF),
    });
  expect(pending.status, JSON.stringify(pending.body)).toBe(201);
  pendingIntentId = pending.body.uploadIntentId;
  pendingUploadUrl = pending.body.url;

  const view = await request(app)
    .post(`/v1/document-versions/${versionId}/view-url`)
    .send({ purpose: 'isolation' });
  expect(view.status, JSON.stringify(view.body)).toBe(200);
  viewUrl = view.body.url;

  const archive = await request(app).post(`/v1/applications/${APP}/document-archive`).send({});
  expect(archive.status, JSON.stringify(archive.body)).toBe(202);
  archiveId = archive.body.archiveId;

  const hold = await request(app)
    .post('/v1/legal-holds')
    .set('Idempotency-Key', key('a-hold'))
    .send({ subjectType: 'LOAN_APPLICATION', subjectId: APP, reason: 'Court order 2026/ISO (synthetic)' });
  expect(hold.status, JSON.stringify(hold.body)).toBe(201);
  holdId = hold.body.id;
}, 240_000);

afterAll(async () => {
  await env?.stop();
});

describe('TEST-SEC-001 application documents: tenants never cross', () => {
  it('API-DOC-007 API-DOC-008: a document type defined by tenant A is invisible to tenant B and unchanged by its own type', async () => {
    const created = await request(tenantA())
      .post('/v1/document-types')
      .set('Idempotency-Key', key('a-type'))
      .send({ code: 'ISO_TENANT_A_ONLY', name: 'Tenant A only', category: 'OTHER' });
    expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);

    const bTypes = await request(tenantB()).get('/v1/document-types');
    expect(bTypes.status).toBe(200);
    expect(bTypes.body.data.map((t: { code: string }) => t.code)).not.toContain('ISO_TENANT_A_ONLY');

    // Tenant B defining the same code gets its own type; tenant A's keeps its name.
    const own = await request(tenantB())
      .post('/v1/document-types')
      .set('Idempotency-Key', key('b-type'))
      .send({ code: 'ISO_TENANT_A_ONLY', name: 'Tenant B copy', category: 'OTHER' });
    expect(own.status, JSON.stringify(own.body)).toBeLessThan(300);
    const rows = await env.admin.query(
      `select tenant_id, name from app.document_type where code = 'ISO_TENANT_A_ONLY' order by tenant_id`,
    );
    expect(rows.rows).toEqual(
      [
        { tenant_id: env.A.tenantId, name: 'Tenant A only' },
        { tenant_id: env.B.tenantId, name: 'Tenant B copy' },
      ].sort((x, y) => x.tenant_id.localeCompare(y.tenant_id)),
    );
  });

  it('API-DOC-001 API-DOC-002: tenant B cannot open an upload for a tenant A checklist item or complete a tenant A upload', async () => {
    const b = tenantB();
    const intent = await request(b)
      .post('/v1/documents/upload-intents')
      .set('Idempotency-Key', key('b-intent'))
      .send({
        checklistItemId: ITEM_PENDING,
        fileName: 'hostile.pdf',
        sizeBytes: PDF.length,
        mimeType: 'application/pdf',
        sha256: sha(PDF),
      });
    expect(intent.status).toBe(404);
    const complete = await request(b).post(`/v1/upload-intents/${pendingIntentId}/completion`).send({});
    expect(complete.status).toBe(404);
    expect((await one(`select status from app.upload_intent where id = $1`, [pendingIntentId])).status).toBe(
      'PENDING',
    );
    expect(
      (await one(`select count(*)::int as n from app.upload_intent where tenant_id = $1`, [env.B.tenantId]))
        .n,
    ).toBe(0);
  });

  it('API-DOC-003 API-DOC-004 API-DOC-005 API-DOC-006: tenant B cannot read, open, download or review a tenant A document', async () => {
    const b = tenantB();
    const logBefore = (
      await one(`select count(*)::int as n from app.document_access_log where version_id = $1`, [versionId])
    ).n;
    expect((await request(b).get(`/v1/documents/${documentId}`)).status).toBe(404);
    expect((await request(b).post(`/v1/document-versions/${versionId}/view-url`).send({})).status).toBe(404);
    expect((await request(b).post(`/v1/document-versions/${versionId}/download-url`).send({})).status).toBe(
      404,
    );
    const review = await request(b)
      .post(`/v1/document-versions/${versionId}/reviews`)
      .set('Idempotency-Key', key('b-review'))
      .send({ decision: 'REJECT', reasonCode: 'ILLEGIBLE' });
    expect(review.status).toBe(404);

    expect(
      (await one(`select count(*)::int as n from app.document_access_log where version_id = $1`, [versionId]))
        .n,
    ).toBe(logBefore);
    expect(
      (await one(`select review_status from app.document_version where id = $1`, [versionId])).review_status,
    ).not.toBe('REJECTED');
    expect((await one(`select status from app.checklist_item where id = $1`, [ITEM_DONE])).status).toBe(
      'SUBMITTED',
    );
  });

  it('API-DOC-009 API-DOC-009-STATUS: tenant B cannot archive tenant A documents or read a tenant A archive', async () => {
    const b = tenantB();
    const count = async () =>
      (await one(`select count(*)::int as n from app.document_archive where application_id = $1`, [APP])).n;
    const before = await count();
    expect((await request(b).post(`/v1/applications/${APP}/document-archive`).send({})).status).toBe(404);
    expect((await request(b).get(`/v1/document-archives/${archiveId}`)).status).toBe(404);
    expect(await count()).toBe(before);
  });

  it('API-PRV-004 API-PRV-004-LIST: tenant B cannot place a hold on a tenant A record or see tenant A holds', async () => {
    const b = tenantB();
    for (const [subjectType, subjectId] of [
      ['LOAN_APPLICATION', APP],
      ['CUSTOMER', CUST],
      ['DOCUMENT', documentId],
    ]) {
      const res = await request(b)
        .post('/v1/legal-holds')
        .set('Idempotency-Key', key(`b-hold-${subjectType}`))
        .send({ subjectType, subjectId, reason: 'Hostile hold attempt' });
      expect(res.status, subjectType).toBe(404);
    }
    const list = await request(b).get('/v1/legal-holds');
    expect(list.status).toBe(200);
    expect(list.body.data.map((h: { id: string }) => h.id)).not.toContain(holdId);
    expect(
      (await one(`select count(*)::int as n from app.legal_hold where tenant_id = $1`, [env.B.tenantId])).n,
    ).toBe(0);
  });

  it('API-DOC-001-PUT API-DOC-004-GET: a signed link reaches only the record it was issued for; a forged one reaches nothing', async () => {
    const anyone = env.anonymousApp();
    // The link tenant A was given serves tenant A's file and nothing else.
    const file = await request(anyone)
      .get(viewUrl)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(file.status).toBe(200);
    expect(Buffer.compare(file.body as Buffer, PDF)).toBe(0);

    // A changed or invented file token is refused.
    const tampered = viewUrl.replace(/.$/, (c: string) => (c === 'A' ? 'B' : 'A'));
    expect((await request(anyone).get(tampered)).status).toBe(410);
    expect((await request(anyone).get('/public/v1/document-files/not-a-real-token')).status).toBe(410);

    // An invented upload token stores nothing, and tenant A's pending upload is still waiting.
    const forgedUpload = await request(anyone)
      .put('/public/v1/document-uploads/not-a-real-upload-token')
      .set('Content-Type', 'application/pdf')
      .send(PDF);
    expect(forgedUpload.status).toBe(404);
    const changedUpload = pendingUploadUrl.replace(/.$/, (c: string) => (c === 'A' ? 'B' : 'A'));
    expect(
      (await request(anyone).put(changedUpload).set('Content-Type', 'application/pdf').send(PDF)).status,
    ).toBe(404);
    expect((await one(`select status from app.upload_intent where id = $1`, [pendingIntentId])).status).toBe(
      'PENDING',
    );
  });
});
