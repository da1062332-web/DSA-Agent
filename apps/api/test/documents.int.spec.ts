// MOD-DOC documents against a real database (M-070), with the production wiring. Synthetic data only.
import crypto from 'node:crypto';
import { unzipSync } from 'fflate';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTxRunner } from '../src/kernel-min/tx-runner';
import { createDocumentArchiveHandler } from '../src/modules/origination/applications/documents';
import { createProductionDeps } from '../src/wiring';
import { startIsolationEnv, type IsolationEnv } from '../../../tests/isolation/harness';
import { testPrincipal } from './support/fake-auth';
import type { PermissionCode } from '@dsa/contracts';

let env: IsolationEnv;
const APP = 'app_doc_int_1';
const CUST = 'cust_doc_int_1';
const PARTY = 'pty_doc_int_1';
const ITEM = 'chk_doc_int_pan';
const ITEM_2 = 'chk_doc_int_bank';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF\n');
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

beforeAll(async () => {
  env = await startIsolationEnv();
  const a = env.A;
  const q = (text: string, values: unknown[]) => env.admin.query(text, values);
  await q(
    `insert into app.customer (id, tenant_id, party_type, full_name, home_branch_id, created_by, updated_by)
     values ($1, $2, 'INDIVIDUAL', 'Document Customer', $3, $4, $4)`,
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
    [ITEM, 'PAN_CARD'],
    [ITEM_2, 'BANK_STATEMENT'],
  ]) {
    await q(
      `insert into app.checklist_item (id, tenant_id, application_id, party_id, document_type_code, mandatory, source_decision_id,
                                       created_by, updated_by)
       values ($1, $2, $3, $4, $5, true, 'dr_doc_int', $6, $6)`,
      [id, a.tenantId, APP, PARTY, code, a.userIds[0]],
    );
  }
}, 240_000);
afterAll(async () => {
  await env?.stop();
});

const STAFF: PermissionCode[] = [
  'document.upload',
  'document.view',
  'document.download',
  'document.review',
  'document.waive',
  'application.read',
  'privacy.manage',
  'config.manage',
];
const key = (l: string) => `doc_${l}_${Math.random().toString(36).slice(2, 10)}`;

describe('TEST-DOC-INT documents', () => {
  let documentId = '';
  let versionId = '';

  it('TEST-DOC-INT-01 upload intent → signed PUT → completion registers a clean version and submits the checklist item', async () => {
    const app = env.appAs(env.A, STAFF);
    const intent = await request(app)
      .post('/v1/documents/upload-intents')
      .set('Idempotency-Key', key('intent'))
      .send({
        checklistItemId: ITEM,
        fileName: 'pan.pdf',
        sizeBytes: PDF.length,
        mimeType: 'application/pdf',
        sha256: sha(PDF),
      });
    expect(intent.status, JSON.stringify(intent.body)).toBe(201);
    expect(intent.body.method).toBe('PUT');

    // Completing before the bytes arrive is refused.
    expect(
      (await request(app).post(`/v1/upload-intents/${intent.body.uploadIntentId}/completion`).send({}))
        .status,
    ).toBe(409);

    // A different file at the link is refused; the declared one is accepted.
    const wrong = await request(app)
      .put(intent.body.url)
      .set('Content-Type', 'application/pdf')
      .send(Buffer.from('%PDF-1.4 other'));
    expect(wrong.status).toBe(422);
    const put = await request(app).put(intent.body.url).set('Content-Type', 'application/pdf').send(PDF);
    expect(put.status, JSON.stringify(put.body)).toBe(204);
    expect(
      (await request(app).put(intent.body.url).set('Content-Type', 'application/pdf').send(PDF)).status,
    ).toBe(409);

    const done = await request(app)
      .post(`/v1/upload-intents/${intent.body.uploadIntentId}/completion`)
      .send({});
    expect(done.status, JSON.stringify(done.body)).toBe(202);
    expect(done.body.scanStatus).toBe('CLEAN');
    documentId = done.body.documentId;
    versionId = done.body.versionId;

    const item = await env.admin.query(`select status, document_id from app.checklist_item where id = $1`, [
      ITEM,
    ]);
    expect(item.rows[0]).toEqual({ status: 'SUBMITTED', document_id: documentId });
    const doc = await request(app).get(`/v1/documents/${documentId}`);
    expect(doc.status).toBe(200);
    expect(doc.body.versions[0]).toMatchObject({
      id: versionId,
      versionNo: 1,
      sha256: sha(PDF),
      scanStatus: 'CLEAN',
    });
  });

  it('TEST-DOC-INT-02 a file whose bytes are not what its type claims is quarantined and cannot be opened', async () => {
    const app = env.appAs(env.A, STAFF);
    const fake = Buffer.from('this is not really a pdf file at all');
    const intent = await request(app)
      .post('/v1/documents/upload-intents')
      .set('Idempotency-Key', key('quarantine'))
      .send({
        checklistItemId: ITEM_2,
        fileName: 'bank.pdf',
        sizeBytes: fake.length,
        mimeType: 'application/pdf',
        sha256: sha(fake),
      });
    await request(app).put(intent.body.url).set('Content-Type', 'application/pdf').send(fake);
    const done = await request(app)
      .post(`/v1/upload-intents/${intent.body.uploadIntentId}/completion`)
      .send({});
    expect(done.body.scanStatus).toBe('QUARANTINED');
    const link = await request(app).post(`/v1/document-versions/${done.body.versionId}/view-url`).send({});
    expect(link.status).toBe(409);
    expect(link.body.error.code).toBe('DOCUMENT_QUARANTINED');
    const item = await env.admin.query(`select status from app.checklist_item where id = $1`, [ITEM_2]);
    expect(item.rows[0].status).toBe('PENDING');
  });

  it('TEST-DOC-INT-03 a reviewer accepts the version; the checklist item follows; a second review is refused', async () => {
    const app = env.appAs(env.A, STAFF);
    const review = await request(app)
      .post(`/v1/document-versions/${versionId}/reviews`)
      .set('Idempotency-Key', key('review'))
      .send({ decision: 'ACCEPT', validUntil: '2030-12-31' });
    expect(review.status, JSON.stringify(review.body)).toBe(200);
    expect(review.body.reviewStatus).toBe('ACCEPTED');
    const item = await env.admin.query(`select status, reviewed_by from app.checklist_item where id = $1`, [
      ITEM,
    ]);
    expect(item.rows[0]).toEqual({ status: 'ACCEPTED', reviewed_by: env.A.userIds[0] });
    const again = await request(app)
      .post(`/v1/document-versions/${versionId}/reviews`)
      .set('Idempotency-Key', key('review2'))
      .send({ decision: 'REJECT', reasonCode: 'ILLEGIBLE' });
    expect(again.status).toBe(409);
  });

  it('TEST-DOC-INT-04 view and download links serve the file, are logged, and a tampered link is refused', async () => {
    const app = env.appAs(env.A, STAFF);
    const view = await request(app)
      .post(`/v1/document-versions/${versionId}/view-url`)
      .send({ purpose: 'credit review' });
    expect(view.status, JSON.stringify(view.body)).toBe(200);
    const file = await request(app)
      .get(view.body.url)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(file.status).toBe(200);
    expect(file.headers['content-disposition']).toMatch(/^inline/);
    expect(Buffer.compare(file.body as Buffer, PDF)).toBe(0);

    const download = await request(app).post(`/v1/document-versions/${versionId}/download-url`).send({});
    expect(download.status).toBe(200);
    const tampered = download.body.url.replace(/.$/, (c: string) => (c === 'A' ? 'B' : 'A'));
    expect((await request(app).get(tampered)).status).toBe(410);

    const log = await env.admin.query(
      `select action, purpose from app.document_access_log where version_id = $1 order by at`,
      [versionId],
    );
    expect(log.rows.map((r) => r.action)).toEqual(['VIEW', 'DOWNLOAD']);
    expect(log.rows[0].purpose).toBe('credit review');
  });

  it('TEST-DOC-INT-05 downloading an S3 document needs a recent step-up', async () => {
    const deps = createProductionDeps(createTxRunner(env.db));
    const { createApp } = await import('../src/app');
    const { fakeAuth } = await import('./support/fake-auth');
    const noStepUp = createApp({
      deps,
      corsAllowedOrigins: [],
      auth: fakeAuth(
        testPrincipal({
          id: env.A.userIds[0],
          tenantId: env.A.tenantId,
          grants: STAFF.map((code) => ({ code, scope: 'TENANT', branchIds: [] })),
          authTime: null,
        }),
      ),
    });
    const res = await request(noStepUp).post(`/v1/document-versions/${versionId}/download-url`).send({});
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('STEP_UP_REQUIRED');
  });

  it('TEST-DOC-INT-06 the archive job builds an encrypted zip of the clean current versions, served by a signed link', async () => {
    const app = env.appAs(env.A, STAFF);
    const queued = await request(app).post(`/v1/applications/${APP}/document-archive`).send({});
    expect(queued.status, JSON.stringify(queued.body)).toBe(202);
    expect(queued.body).toMatchObject({ status: 'QUEUED', documentCount: 1 });

    // Run the queued job the way the worker does: in the archive's tenant.
    const job = await env.admin.query(
      `select id, payload from app.job_queue where job_type = 'document.archive'`,
    );
    expect(job.rows).toHaveLength(1);
    const deps = createProductionDeps(createTxRunner(env.db));
    const handler = createDocumentArchiveHandler(deps);
    await createTxRunner(env.db).withTenantTx(
      {
        principal: testPrincipal({ tenantId: env.A.tenantId, kind: 'SERVICE' }),
        correlationId: 'job',
        now: new Date(),
      },
      (tx) => handler(tx, env.A.tenantId, job.rows[0].payload),
    );
    const stored = await env.admin.query(
      `select object_key, status from app.document_archive where id = $1`,
      [queued.body.archiveId],
    );
    expect(stored.rows[0].status).toBe('READY');

    const status = await request(app).get(`/v1/document-archives/${queued.body.archiveId}`);
    expect(status.body.status).toBe('READY');
    const zip = await request(app)
      .get(status.body.url)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    const files = unzipSync(new Uint8Array(zip.body as Buffer));
    expect(Object.keys(files).sort()).toEqual([`PAN_CARD/${versionId}-pan.pdf`, 'manifest.json']);
  });

  it('TEST-DOC-INT-07 a waiver completes the checklist; the completeness check records the result', async () => {
    const app = env.appAs(env.A, STAFF);
    const before = await request(app).post(`/v1/applications/${APP}/completeness-checks`).send({});
    expect(before.body.result).toBe('INCOMPLETE');
    const waived = await request(app)
      .post(`/v1/applications/${APP}/waivers`)
      .set('Idempotency-Key', key('waive'))
      .send({
        checklistItemId: ITEM_2,
        status: 'WAIVED',
        reason: 'Salary credited to an account already verified',
      });
    expect(waived.status, JSON.stringify(waived.body)).toBe(200);
    const after = await request(app).post(`/v1/applications/${APP}/completeness-checks`).send({});
    expect(after.body).toEqual({ result: 'COMPLETE', reasons: [] });
  });

  it('TEST-DOC-INT-08 legal holds are placed by privacy.manage and listed', async () => {
    const app = env.appAs(env.A, STAFF);
    const hold = await request(app)
      .post('/v1/legal-holds')
      .set('Idempotency-Key', key('hold'))
      .send({ subjectType: 'LOAN_APPLICATION', subjectId: APP, reason: 'Court order 2026/ABC (synthetic)' });
    expect(hold.status, JSON.stringify(hold.body)).toBe(201);
    const list = await request(app).get('/v1/legal-holds');
    expect(list.body.data.map((h: { id: string }) => h.id)).toContain(hold.body.id);
    expect((await request(env.appAs(env.A, ['application.read'])).get('/v1/legal-holds')).status).toBe(403);
  });

  it('TEST-DOC-INT-09 tenant B, with every document permission, can see or open none of it', async () => {
    const b = env.appAs(env.B, STAFF);
    expect((await request(b).get(`/v1/documents/${documentId}`)).status).toBe(404);
    expect((await request(b).post(`/v1/document-versions/${versionId}/view-url`).send({})).status).toBe(404);
    expect(
      (
        await request(b)
          .post(`/v1/document-versions/${versionId}/reviews`)
          .set('Idempotency-Key', key('b'))
          .send({ decision: 'ACCEPT' })
      ).status,
    ).toBe(404);
    expect((await request(b).post(`/v1/applications/${APP}/document-archive`).send({})).status).toBe(404);
    const types = await request(b).get('/v1/document-types');
    expect(types.status).toBe(200);
  });
});
