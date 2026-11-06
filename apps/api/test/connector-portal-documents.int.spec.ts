// Partner document upload (API-CPT-008) against a real database, with the production wiring, a real ClamAV client talking to a
// fake clamd on a local socket, and an in-memory object store. Synthetic data only.
import crypto from 'node:crypto';
import net from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createTxRunner } from '../src/kernel-min/tx-runner';
import { ClamAvFileScanner } from '../src/modules/origination/applications/document-backends';
import { createProductionDeps } from '../src/wiring';
import { startIsolationEnv, type IsolationEnv } from '../../../tests/isolation/harness';
import { fakeAuth, testPrincipal } from './support/fake-auth';

let env: IsolationEnv;
const CON_1 = 'con_doc_1';
const CON_2 = 'con_doc_2';
const USER_1 = 'usr_doc_1';
const USER_2 = 'usr_doc_2';
const MOBILE = '+919876500901';
const APP = 'app_doc_p1';
const CUST = 'cust_doc_p1';
const PARTY = 'pty_doc_p1';
const PAN = 'chk_doc_p_pan'; // PAN_CARD: approved for partners, any allowed type
const ADDR = 'chk_doc_p_addr'; // ADDRESS_PROOF: approved for partners, PDF only
const BANK = 'chk_doc_p_bank'; // BANK_STATEMENT: not approved for partners
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF\n');
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const key = (l: string) => `pdoc_${l}_${Math.random().toString(36).slice(2, 10)}`;
let LEAD = '';

// A stand-in for clamd: PING answers PONG, INSTREAM answers from the mode. DOWN closes without answering.
type ClamMode = 'OK' | 'FOUND' | 'DOWN';
let clamMode: ClamMode = 'OK';
let clamServer: net.Server;
let clamPort = 0;
async function startClamd(): Promise<void> {
  clamServer = net.createServer({ allowHalfOpen: true }, (socket) => {
    socket.on('error', () => undefined);
    socket.once('data', (d) => {
      if (d.toString('utf8', 0, 5) === 'zPING') {
        if (clamMode === 'DOWN') socket.destroy();
        else socket.end('PONG\0');
        return;
      }
      socket.on('end', () => {
        if (clamMode === 'DOWN') return socket.destroy();
        const answer = clamMode === 'FOUND' ? 'stream: Eicar-Test-Signature FOUND' : 'stream: OK';
        socket.end(`${answer}\0`);
      });
    });
  });
  await new Promise<void>((resolve) => clamServer.listen(0, '127.0.0.1', () => resolve()));
  clamPort = (clamServer.address() as net.AddressInfo).port;
}
/** A port nothing listens on, so a connection is refused. */
async function closedPort(): Promise<number> {
  const s = net.createServer();
  await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', () => resolve()));
  const port = (s.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => s.close(() => resolve()));
  return port;
}

/** Object storage in memory, so the tests write nothing to disk. */
class MemoryStore {
  files = new Map<string, Buffer>();
  private n = 0;
  async put(_tenantId: string, _name: string, bytes: Buffer) {
    const key = `mem-${++this.n}`;
    this.files.set(key, bytes);
    return key;
  }
  async get(_tenantId: string, objectKey: string) {
    return this.files.get(objectKey) ?? null;
  }
}
const store = new MemoryStore();
// Uploaded bytes wait here until their verdict (2026-11-04 containment). Memory only, like the store.
const quarantine = new MemoryStore();

const portalApp = (opts: { id?: string; scanner?: ClamAvFileScanner } = {}) =>
  createApp({
    deps: createProductionDeps(createTxRunner(env.db), {
      documentStore: store,
      documentQuarantineStore: quarantine,
      documentScanner: opts.scanner,
    }),
    corsAllowedOrigins: [],
    auth: fakeAuth(
      testPrincipal({
        id: opts.id ?? USER_1,
        tenantId: env.A.tenantId,
        primaryBranchId: env.A.branchId,
        authTime: new Date().toISOString(),
        userType: 'CONNECTOR',
        grants: [],
      }),
    ),
  });
const scanner = () => new ClamAvFileScanner('127.0.0.1', clamPort, undefined, 5_000);

/** A verified consent code, set directly so the test does not search the code space. */
const consent = async (app: ReturnType<typeof portalApp>, mobile: string) => {
  const sent = await request(app).post('/portal/v1/referrals/consent-otp').send({ action: 'SEND', mobile });
  expect(sent.status, JSON.stringify(sent.body)).toBe(200);
  await env.admin.query(`update app.referral_consent_otp set code_hash = $2 where id = $1`, [
    sent.body.otpId,
    sha(`${sent.body.otpId}:246810`),
  ]);
  const ok = await request(app)
    .post('/portal/v1/referrals/consent-otp')
    .send({ action: 'VERIFY', otpId: sent.body.otpId, code: '246810' });
  expect(ok.body.status).toBe('VERIFIED');
  return sent.body.otpId as string;
};

beforeAll(async () => {
  env = await startIsolationEnv();
  await startClamd();
  const a = env.A;
  const q = (text: string, values: unknown[]) => env.admin.query(text, values);
  const h = (s: string) => crypto.createHash('sha256').update(s).digest();
  for (const [id, mobile, n] of [
    [CON_1, '+919876500931', 1],
    [CON_2, '+919876500932', 2],
  ] as const) {
    await q(
      `insert into app.connector (id, tenant_id, connector_type, legal_name, contact_person, mobile_e164, mobile_hash, email, email_hash,
                                  encrypted_pan, pan_hash, pan_masked, primary_branch_id, relationship_owner_user_id, status,
                                  created_by, updated_by)
       values ($1, $2, 'INDIVIDUAL', $3, 'Synthetic Contact', $4, $5, $6, $7, $8, $9, 'XXXXX1234X', $10, $11, 'ACTIVE', 'iso', 'iso')`,
      [
        id,
        a.tenantId,
        `Synthetic Document Partner ${n}`,
        mobile,
        h(`m-${id}`),
        `${id}@doc.example.com`,
        h(`e-${id}`),
        Buffer.from('synthetic'),
        h(`p-${id}`),
        a.branchId,
        a.userIds[0],
      ],
    );
  }
  await q(
    `insert into app.app_user (id, tenant_id, idp_subject, email, display_name, user_type, primary_branch_id, connector_id,
                               created_by, updated_by)
     values ($1, $2, 'sub-doc-1', 'doc1@doc.example.com', 'Partner One', 'CONNECTOR', $3, $4, 'iso', 'iso'),
            ($5, $2, 'sub-doc-2', 'doc2@doc.example.com', 'Partner Two', 'CONNECTOR', $3, $6, 'iso', 'iso')`,
    [USER_1, a.tenantId, a.branchId, CON_1, USER_2, CON_2],
  );
  // The referral comes through the portal, so it is a real lead owned by connector 1.
  const app = portalApp();
  const otp = await consent(app, MOBILE);
  const created = await request(app)
    .post('/portal/v1/referrals')
    .set('Idempotency-Key', key('lead'))
    .send({ fullName: 'Document Customer', mobile: MOBILE, productCategory: 'PL', consentOtpId: otp });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  LEAD = created.body.id;
  // The application that the referral became, with its party and checklist, as the origination flow would create them.
  await q(
    `insert into app.customer (id, tenant_id, party_type, full_name, home_branch_id, created_by, updated_by)
     values ($1, $2, 'INDIVIDUAL', 'Document Customer', $3, $4, $4)`,
    [CUST, a.tenantId, a.branchId, a.userIds[0]],
  );
  await q(
    `insert into app.loan_application (id, tenant_id, branch_id, customer_id, product_category, requested_amount,
                                       applicant_type, status, sales_owner_id, lead_id, created_by, updated_by)
     values ($1, $2, $3, $4, 'PL', 300000, 'SALARIED', 'DRAFT', $5, $6, $5, $5)`,
    [APP, a.tenantId, a.branchId, CUST, a.userIds[0], LEAD],
  );
  await q(
    `insert into app.application_party (id, tenant_id, application_id, customer_id, role, party_type, created_by)
     values ($1, $2, $3, $4, 'PRIMARY', 'INDIVIDUAL', $5)`,
    [PARTY, a.tenantId, APP, CUST, a.userIds[0]],
  );
  for (const [id, code] of [
    [PAN, 'PAN_CARD'],
    [ADDR, 'ADDRESS_PROOF'],
    [BANK, 'BANK_STATEMENT'],
  ]) {
    await q(
      `insert into app.checklist_item (id, tenant_id, application_id, party_id, document_type_code, mandatory, source_decision_id,
                                       created_by, updated_by)
       values ($1, $2, $3, $4, $5, true, 'dr_doc_p', $6, $6)`,
      [id, a.tenantId, APP, PARTY, code, a.userIds[0]],
    );
  }
  // Approval for partners is a flag on the document type. PAN_CARD and ADDRESS_PROOF are approved here; BANK_STATEMENT is not.
  await q(
    `insert into app.document_type (id, tenant_id, code, name, category, allowed_mime, created_by, updated_by, partner_upload)
     values ('dtp_pan', $1, 'PAN_CARD', 'PAN card', 'IDENTITY', '{application/pdf,image/jpeg,image/png}', 'iso', 'iso', true),
            ('dtp_addr', $1, 'ADDRESS_PROOF', 'Address proof', 'ADDRESS', '{application/pdf}', 'iso', 'iso', true)`,
    [a.tenantId],
  );
}, 240_000);

afterAll(async () => {
  await new Promise<void>((resolve) => clamServer?.close(() => resolve()));
  await env?.stop();
});

describe('partner document upload (TEST-CPT-DOC)', () => {
  let uploaded = '';

  it('TEST-CPT-DOC-01 without a working malware scanner the upload is refused, and no upload is recorded', async () => {
    const res = await request(portalApp())
      .post(`/portal/v1/referrals/${LEAD}/documents/upload-intents`)
      .set('Idempotency-Key', key('noscan'))
      .send({
        checklistItemId: PAN,
        fileName: 'pan.pdf',
        sizeBytes: PDF.length,
        mimeType: 'application/pdf',
        sha256: sha(PDF),
      });
    expect(res.status, JSON.stringify(res.body)).toBe(503);
    expect(res.body.error.code).toBe('DEPENDENCY_UNAVAILABLE');
    const n = await env.admin.query(
      `select count(*)::int as n from app.upload_intent where checklist_item_id = $1`,
      [PAN],
    );
    expect(n.rows[0].n).toBe(0);
  });

  it('TEST-CPT-DOC-02 an unreachable scanner refuses the upload, the same as a missing one', async () => {
    const down = new ClamAvFileScanner('127.0.0.1', await closedPort(), undefined, 2_000);
    const res = await request(portalApp({ scanner: down }))
      .post(`/portal/v1/referrals/${LEAD}/documents/upload-intents`)
      .set('Idempotency-Key', key('closed'))
      .send({
        checklistItemId: PAN,
        fileName: 'pan.pdf',
        sizeBytes: PDF.length,
        mimeType: 'application/pdf',
        sha256: sha(PDF),
      });
    expect(res.status).toBe(503);
  });

  it('TEST-CPT-DOC-03 a document type not approved for partners is refused, even with a working scanner', async () => {
    clamMode = 'OK';
    const res = await request(portalApp({ scanner: scanner() }))
      .post(`/portal/v1/referrals/${LEAD}/documents/upload-intents`)
      .set('Idempotency-Key', key('unapproved'))
      .send({
        checklistItemId: BANK,
        fileName: 'bank.pdf',
        sizeBytes: PDF.length,
        mimeType: 'application/pdf',
        sha256: sha(PDF),
      });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('TEST-CPT-DOC-04 another connector cannot upload to this referral, and a checklist item outside the referral is not found', async () => {
    const other = portalApp({ id: USER_2, scanner: scanner() });
    const crossConnector = await request(other)
      .post(`/portal/v1/referrals/${LEAD}/documents/upload-intents`)
      .set('Idempotency-Key', key('cross'))
      .send({
        checklistItemId: PAN,
        fileName: 'pan.pdf',
        sizeBytes: PDF.length,
        mimeType: 'application/pdf',
        sha256: sha(PDF),
      });
    expect(crossConnector.status).toBe(404);
    const unknownItem = await request(portalApp({ scanner: scanner() }))
      .post(`/portal/v1/referrals/${LEAD}/documents/upload-intents`)
      .set('Idempotency-Key', key('unknown'))
      .send({
        checklistItemId: 'chk_not_here',
        fileName: 'pan.pdf',
        sizeBytes: PDF.length,
        mimeType: 'application/pdf',
        sha256: sha(PDF),
      });
    expect(unknownItem.status).toBe(404);
  });

  it('TEST-CPT-DOC-05 a file of a type or size the document type does not allow is refused', async () => {
    const app = portalApp({ scanner: scanner() });
    const wrongMime = await request(app)
      .post(`/portal/v1/referrals/${LEAD}/documents/upload-intents`)
      .set('Idempotency-Key', key('mime'))
      .send({
        checklistItemId: ADDR,
        fileName: 'addr.png',
        sizeBytes: 1024,
        mimeType: 'image/png',
        sha256: sha(PDF),
      });
    expect(wrongMime.status).toBe(422);
    expect(wrongMime.body.error.details?.[0]).toMatchObject({ field: 'mimeType', issue: 'NOT_ALLOWED' });
    const tooLarge = await request(app)
      .post(`/portal/v1/referrals/${LEAD}/documents/upload-intents`)
      .set('Idempotency-Key', key('size'))
      .send({
        checklistItemId: PAN,
        fileName: 'pan.pdf',
        sizeBytes: 60 * 1024 * 1024,
        mimeType: 'application/pdf',
        sha256: sha(PDF),
      });
    expect(tooLarge.status).toBe(422);
    expect(tooLarge.body.error.details?.[0]).toMatchObject({ field: 'sizeBytes', issue: 'TOO_LARGE' });
  });

  it('TEST-CPT-DOC-06 an approved upload is sent to the same signed PUT, scanned on completion, and submits the checklist item', async () => {
    const app = portalApp({ scanner: scanner() });
    const intent = await request(app)
      .post(`/portal/v1/referrals/${LEAD}/documents/upload-intents`)
      .set('Idempotency-Key', key('ok'))
      .send({
        checklistItemId: PAN,
        fileName: 'pan.pdf',
        sizeBytes: PDF.length,
        mimeType: 'application/pdf',
        sha256: sha(PDF),
      });
    expect(intent.status, JSON.stringify(intent.body)).toBe(201);
    expect(intent.body.url).toMatch(/^\/public\/v1\/document-uploads\//);
    uploaded = intent.body.uploadIntentId;

    // Completing before the bytes arrive is refused.
    const early = await request(app).post(`/portal/v1/upload-intents/${uploaded}/completion`).send({});
    expect(early.status).toBe(409);
    const put = await request(app).put(intent.body.url).set('Content-Type', 'application/pdf').send(PDF);
    expect(put.status, JSON.stringify(put.body)).toBe(204);

    const done = await request(app).post(`/portal/v1/upload-intents/${uploaded}/completion`).send({});
    expect(done.status, JSON.stringify(done.body)).toBe(202);
    expect(done.body).toEqual({ uploadIntentId: uploaded, status: 'ACCEPTED' });
    const item = await env.admin.query(`select status, document_id from app.checklist_item where id = $1`, [
      PAN,
    ]);
    expect(item.rows[0].status).toBe('SUBMITTED');
    const version = await env.admin.query(
      `select v.scan_status, v.uploaded_via from app.document_version v join app.document d on d.id = v.document_id
        where d.checklist_item_id = $1`,
      [PAN],
    );
    expect(version.rows[0]).toEqual({ scan_status: 'CLEAN', uploaded_via: 'CONNECTOR' });
  });

  it('TEST-CPT-DOC-07 a file the scanner finds infected is kept as quarantined, does not submit the item, and the partner learns only that it was not accepted', async () => {
    const app = portalApp({ scanner: scanner() });
    const intent = await request(app)
      .post(`/portal/v1/referrals/${LEAD}/documents/upload-intents`)
      .set('Idempotency-Key', key('infected'))
      .send({
        checklistItemId: ADDR,
        fileName: 'addr.pdf',
        sizeBytes: PDF.length,
        mimeType: 'application/pdf',
        sha256: sha(PDF),
      });
    expect(intent.status, JSON.stringify(intent.body)).toBe(201);
    expect(
      (await request(app).put(intent.body.url).set('Content-Type', 'application/pdf').send(PDF)).status,
    ).toBe(204);
    clamMode = 'FOUND';
    try {
      const done = await request(app)
        .post(`/portal/v1/upload-intents/${intent.body.uploadIntentId}/completion`)
        .send({});
      expect(done.status, JSON.stringify(done.body)).toBe(202);
      expect(done.body).toEqual({ uploadIntentId: intent.body.uploadIntentId, status: 'NOT_ACCEPTED' });
      expect(JSON.stringify(done.body)).not.toMatch(/Eicar|FOUND|threat/i);
    } finally {
      clamMode = 'OK';
    }
    const item = await env.admin.query(`select status from app.checklist_item where id = $1`, [ADDR]);
    expect(item.rows[0].status).toBe('PENDING');
    const version = await env.admin.query(
      `select v.scan_status from app.document_version v join app.document d on d.id = v.document_id
        where d.checklist_item_id = $1`,
      [ADDR],
    );
    expect(version.rows[0].scan_status).toBe('QUARANTINED');
  });

  it('TEST-CPT-DOC-08 a scanner that stops answering blocks completion, the upload stays pending, and a retry after recovery is accepted', async () => {
    const app = portalApp({ scanner: scanner() });
    const intent = await request(app)
      .post(`/portal/v1/referrals/${LEAD}/documents/upload-intents`)
      .set('Idempotency-Key', key('down'))
      .send({
        checklistItemId: ADDR,
        fileName: 'addr.pdf',
        sizeBytes: PDF.length,
        mimeType: 'application/pdf',
        sha256: sha(PDF),
      });
    expect(intent.status, JSON.stringify(intent.body)).toBe(201);
    expect(
      (await request(app).put(intent.body.url).set('Content-Type', 'application/pdf').send(PDF)).status,
    ).toBe(204);
    clamMode = 'DOWN';
    try {
      const refused = await request(app)
        .post(`/portal/v1/upload-intents/${intent.body.uploadIntentId}/completion`)
        .send({});
      expect(refused.status).toBe(503);
      const still = await env.admin.query(`select status from app.upload_intent where id = $1`, [
        intent.body.uploadIntentId,
      ]);
      expect(still.rows[0].status).toBe('UPLOADED');
    } finally {
      clamMode = 'OK';
    }
    const retry = await request(app)
      .post(`/portal/v1/upload-intents/${intent.body.uploadIntentId}/completion`)
      .send({});
    expect(retry.status, JSON.stringify(retry.body)).toBe(202);
    expect(retry.body.status).toBe('ACCEPTED');
  });

  it('TEST-CPT-DOC-09 an upload is completed only by the connector user that started it', async () => {
    const app = portalApp({ scanner: scanner() });
    const intent = await request(app)
      .post(`/portal/v1/referrals/${LEAD}/documents/upload-intents`)
      .set('Idempotency-Key', key('owner'))
      .send({
        checklistItemId: PAN,
        fileName: 'pan2.pdf',
        sizeBytes: PDF.length,
        mimeType: 'application/pdf',
        sha256: sha(PDF),
      });
    expect(intent.status).toBe(201);
    await request(app).put(intent.body.url).set('Content-Type', 'application/pdf').send(PDF);
    const other = await request(portalApp({ id: USER_2, scanner: scanner() }))
      .post(`/portal/v1/upload-intents/${intent.body.uploadIntentId}/completion`)
      .send({});
    expect(other.status).toBe(404);
  });

  it('TEST-CPT-DOC-10 partners have no download route, and staff document routes refuse a connector login', async () => {
    const app = portalApp({ scanner: scanner() });
    expect((await request(app).get(`/portal/v1/documents/${uploaded}`)).status).toBe(404);
    expect((await request(app).post(`/portal/v1/document-versions/${uploaded}/download-url`)).status).toBe(
      404,
    );
    expect((await request(app).post(`/portal/v1/document-versions/${uploaded}/view-url`)).status).toBe(404);
    const staffRoute = await request(app).get(`/v1/documents/${uploaded}`);
    expect(staffRoute.status).toBe(403);
    expect(staffRoute.body.error.details?.[0]).toMatchObject({ issue: 'CONNECTOR_IDENTITY_NOT_ALLOWED' });
    const staffCompletion = await request(app).post(`/v1/upload-intents/${uploaded}/completion`).send({});
    expect(staffCompletion.status).toBe(403);
  });

  it('TEST-CPT-DOCL-01 the document list shows only the approved types, with a partner status, and says when uploads are available', async () => {
    const res = await request(portalApp({ scanner: scanner() })).get(
      `/portal/v1/referrals/${LEAD}/documents`,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.uploadAvailable).toBe(true);
    expect(res.body.unavailableReason).toBeNull();
    const ids = res.body.items.map((i: { checklistItemId: string }) => i.checklistItemId);
    expect(ids).toEqual(expect.arrayContaining([PAN, ADDR]));
    expect(ids).not.toContain(BANK);
    for (const item of res.body.items) {
      expect(item).not.toHaveProperty('rejectReason');
      expect(item.status).toBe('PENDING_REVIEW');
      expect(item.actionRequired).toBe(false);
    }
  });

  it('TEST-CPT-DOCL-02 without a working scanner the list says uploads are not available, and another connector gets no list at all', async () => {
    const noScanner = await request(portalApp()).get(`/portal/v1/referrals/${LEAD}/documents`);
    expect(noScanner.status).toBe(200);
    expect(noScanner.body.uploadAvailable).toBe(false);
    expect(noScanner.body.unavailableReason).toBe('SCANNER_UNAVAILABLE');
    const other = await request(portalApp({ id: USER_2, scanner: scanner() })).get(
      `/portal/v1/referrals/${LEAD}/documents`,
    );
    expect(other.status).toBe(404);
  });

  it('TEST-CPT-DOCL-03 the referral detail shows the partner view only: a masked name and number, the status, the steps and the dates', async () => {
    const app = portalApp({ scanner: scanner() });
    const res = await request(app).get(`/portal/v1/referrals/${LEAD}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(
      [
        'id',
        'lastUpdatedAt',
        'mobileMasked',
        'name',
        'productCategory',
        'status',
        'steps',
        'submittedAt',
      ].sort(),
    );
    expect(res.body.name).not.toBe('Document Customer');
    expect(res.body.mobileMasked).not.toContain(MOBILE);
    expect(res.body.status).toBe('RECEIVED');
    expect(res.body.steps).toEqual([
      expect.objectContaining({ label: 'Submitted', done: false, current: true }),
    ]);
    const other = await request(portalApp({ id: USER_2 })).get(`/portal/v1/referrals/${LEAD}`);
    expect(other.status).toBe(404);
  });
});
