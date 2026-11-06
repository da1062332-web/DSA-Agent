// The document upload lifecycle against a real database and the production routes (2026-11-04 containment). Covered: the quarantine
// boundary, the fail-closed scanner, the one-time link, expiry, the declared size and hash, tenant binding, the size cap and the rate
// limit. The scanner is the real ClamAV client against a fake clamd. Synthetic data only.
import crypto from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createTxRunner } from '../src/kernel-min/tx-runner';
import { ClamAvFileScanner } from '../src/modules/origination/applications/document-backends';
import { createProductionDeps } from '../src/wiring';
import { startIsolationEnv, type IsolationEnv } from '../../../tests/isolation/harness';
import { fakeAuth, testPrincipal } from './support/fake-auth';
import { MemoryObjectStore } from './support/document-doubles';
import { startFakeClamd, type FakeClamd } from './support/fake-clamd';
import type { PermissionCode } from '@dsa/contracts';

let env: IsolationEnv;
let clamd: FakeClamd;
const store = new MemoryObjectStore(); // clean files: what the document routes serve
const quarantine = new MemoryObjectStore(); // bytes waiting for their verdict
const APP = 'app_lc_1';
const CUST = 'cust_lc_1';
const PARTY = 'pty_lc_1';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF\n');
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
const key = (l: string) => `lc_${l}_${Math.random().toString(36).slice(2, 10)}`;
const STAFF: PermissionCode[] = [
  'document.upload',
  'document.view',
  'document.download',
  'document.review',
  'application.read',
];
/** One checklist item per scenario, so the scenarios do not share a document. */
const ITEM = (i: number): string => `chk_lc_${i}`;
const ITEMS = Array.from({ length: 12 }, (_, i) => ITEM(i));

beforeAll(async () => {
  clamd = await startFakeClamd('OK');
  env = await startIsolationEnv({
    documentStore: store,
    documentQuarantineStore: quarantine,
    documentScanner: new ClamAvFileScanner('127.0.0.1', clamd.port, undefined, 5_000),
  });
  const a = env.A;
  const q = (text: string, values: unknown[]) => env.admin.query(text, values);
  await q(
    `insert into app.customer (id, tenant_id, party_type, full_name, home_branch_id, created_by, updated_by)
     values ($1, $2, 'INDIVIDUAL', 'Upload Customer', $3, $4, $4)`,
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
  for (const [index, id] of ITEMS.entries()) {
    // The ordinal starts at 1 (checklist_item_ordinal_check). Items of one type are told apart by it.
    await q(
      `insert into app.checklist_item (id, tenant_id, application_id, party_id, document_type_code, ordinal, mandatory,
                                       source_decision_id, created_by, updated_by)
       values ($1, $2, $3, $4, 'OTHER', $5, true, 'dr_lc', $6, $6)`,
      [id, a.tenantId, APP, PARTY, index + 1, a.userIds[0]],
    );
  }
}, 240_000);

afterAll(async () => {
  await env?.stop();
  await clamd?.stop();
});

const staff = () => env.appAs(env.A, STAFF);

/** Issue an upload intent for a checklist item. */
async function issue(item: string, body: Buffer = PDF, sizeBytes = body.length) {
  return request(staff())
    .post('/v1/documents/upload-intents')
    .set('Idempotency-Key', key('intent'))
    .send({
      checklistItemId: item,
      fileName: 'pan.pdf',
      sizeBytes,
      mimeType: 'application/pdf',
      sha256: sha(body),
    });
}

/** The stored intent's status and object key. */
async function intentRow(id: string) {
  return (await env.admin.query('select status, object_key from app.upload_intent where id = $1', [id]))
    .rows[0];
}

/** Files held for one intent. The file name carries the intent id, so the match is exact. */
const quarantinedFor = (intentId: string) =>
  [...quarantine.files.keys()].filter((k) => k.includes(intentId)).length;
const storedFor = (intentId: string) => [...store.files.keys()].filter((k) => k.includes(intentId)).length;

describe('TEST-LC document upload lifecycle', () => {
  it('TEST-LC-01 without a working malware scanner no upload intent is issued, so no link exists', async () => {
    // The production default: the file-signature check is not a malware scanner, so it is never ready.
    const noScanner = createApp({
      deps: createProductionDeps(createTxRunner(env.db), {
        documentStore: store,
        documentQuarantineStore: quarantine,
      }),
      corsAllowedOrigins: [],
      auth: fakeAuth(
        testPrincipal({
          id: env.A.userIds[0],
          tenantId: env.A.tenantId,
          primaryBranchId: env.A.branchId,
          authTime: new Date().toISOString(),
          grants: STAFF.map((code) => ({ code, scope: 'TENANT' as const, branchIds: [] })),
        }),
      ),
    });
    const res = await request(noScanner)
      .post('/v1/documents/upload-intents')
      .set('Idempotency-Key', key('none'))
      .send({
        checklistItemId: ITEM(0),
        fileName: 'pan.pdf',
        sizeBytes: PDF.length,
        mimeType: 'application/pdf',
        sha256: sha(PDF),
      });

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('DEPENDENCY_UNAVAILABLE');
    const rows = await env.admin.query(
      'select count(*)::int as n from app.upload_intent where checklist_item_id = $1',
      [ITEM(0)],
    );
    expect(rows.rows[0].n).toBe(0);
  });

  it('TEST-LC-02 a scanner that does not answer refuses a new intent and writes nothing', async () => {
    clamd.mode = 'DOWN';
    try {
      const res = await issue(ITEM(1));
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('DEPENDENCY_UNAVAILABLE');
      const rows = await env.admin.query(
        'select count(*)::int as n from app.upload_intent where checklist_item_id = $1',
        [ITEM(1)],
      );
      expect(rows.rows[0].n).toBe(0);
    } finally {
      clamd.mode = 'OK';
    }
  });

  it('TEST-LC-03 the link stores the bytes only in quarantine, and the store that serves files is untouched', async () => {
    const intent = await issue(ITEM(2));
    expect(intent.status, JSON.stringify(intent.body)).toBe(201);
    const id = intent.body.uploadIntentId;

    const put = await request(env.anonymousApp())
      .put(intent.body.url)
      .set('Content-Type', 'application/pdf')
      .send(PDF);
    expect(put.status, JSON.stringify(put.body)).toBe(204);

    expect(quarantinedFor(id)).toBe(1);
    expect(storedFor(id)).toBe(0);
    const row = await intentRow(id);
    expect(row.status).toBe('UPLOADED');
    expect(row.object_key.startsWith(`${env.A.tenantId}/`)).toBe(true);
    expect(quarantine.files.has(row.object_key)).toBe(true);
  });

  it('TEST-LC-04 a clean verdict promotes the bytes and only then makes the version available', async () => {
    const intent = await issue(ITEM(3));
    const id = intent.body.uploadIntentId;
    await request(env.anonymousApp()).put(intent.body.url).set('Content-Type', 'application/pdf').send(PDF);

    const done = await request(staff()).post(`/v1/upload-intents/${id}/completion`).send({});
    expect(done.status, JSON.stringify(done.body)).toBe(202);
    expect(done.body.scanStatus).toBe('CLEAN');
    expect(storedFor(id)).toBe(1);

    const version = (
      await env.admin.query(
        'select v.object_key, v.scan_status from app.document_version v where v.id = $1',
        [done.body.versionId],
      )
    ).rows[0];
    expect(version.scan_status).toBe('CLEAN');
    expect(store.files.has(version.object_key)).toBe(true);

    const item = await env.admin.query('select status from app.checklist_item where id = $1', [ITEM(3)]);
    expect(item.rows[0].status).toBe('SUBMITTED');
    const link = await request(staff())
      .post(`/v1/document-versions/${done.body.versionId}/view-url`)
      .send({});
    expect(link.status).toBe(200);
  });

  it('TEST-LC-05 an infected file stays in quarantine: not promoted, not submitted, and every serving route refuses it', async () => {
    clamd.mode = 'FOUND';
    try {
      const intent = await issue(ITEM(4));
      const id = intent.body.uploadIntentId;
      await request(env.anonymousApp()).put(intent.body.url).set('Content-Type', 'application/pdf').send(PDF);

      const done = await request(staff()).post(`/v1/upload-intents/${id}/completion`).send({});
      expect(done.status).toBe(202);
      expect(done.body.scanStatus).toBe('QUARANTINED');
      expect(storedFor(id)).toBe(0);
      expect(quarantinedFor(id)).toBe(1);

      const item = await env.admin.query('select status from app.checklist_item where id = $1', [ITEM(4)]);
      expect(item.rows[0].status).toBe('PENDING');

      const view = await request(staff())
        .post(`/v1/document-versions/${done.body.versionId}/view-url`)
        .send({});
      expect(view.status).toBe(409);
      expect(view.body.error.code).toBe('DOCUMENT_QUARANTINED');
      const review = await request(staff())
        .post(`/v1/document-versions/${done.body.versionId}/reviews`)
        .set('Idempotency-Key', key('rv'))
        .send({ decision: 'ACCEPT' });
      expect(review.status).toBe(409);
      expect(review.body.error.code).toBe('DOCUMENT_QUARANTINED');
    } finally {
      clamd.mode = 'OK';
    }
  });

  it('TEST-LC-06 a scanner that stops answering at completion leaves no version; a retry after recovery is accepted', async () => {
    const intent = await issue(ITEM(5));
    const id = intent.body.uploadIntentId;
    await request(env.anonymousApp()).put(intent.body.url).set('Content-Type', 'application/pdf').send(PDF);

    clamd.mode = 'DOWN';
    try {
      const refused = await request(staff()).post(`/v1/upload-intents/${id}/completion`).send({});
      expect(refused.status).toBe(503);
      expect(refused.body.error.code).toBe('DEPENDENCY_UNAVAILABLE');
      expect((await intentRow(id)).status).toBe('UPLOADED');
      const versions = await env.admin.query(
        'select count(*)::int as n from app.document_version v join app.document d on d.id = v.document_id where d.checklist_item_id = $1',
        [ITEM(5)],
      );
      expect(versions.rows[0].n).toBe(0);
    } finally {
      clamd.mode = 'OK';
    }

    const retry = await request(staff()).post(`/v1/upload-intents/${id}/completion`).send({});
    expect(retry.status, JSON.stringify(retry.body)).toBe(202);
    expect(retry.body.scanStatus).toBe('CLEAN');
  });

  it('TEST-LC-07 a scanner that is down at the link stores nothing, and the intent stays pending for a later upload', async () => {
    const intent = await issue(ITEM(6));
    const id = intent.body.uploadIntentId;

    clamd.mode = 'DOWN';
    try {
      const refused = await request(env.anonymousApp())
        .put(intent.body.url)
        .set('Content-Type', 'application/pdf')
        .send(PDF);
      expect(refused.status).toBe(503);
      expect(refused.body.error.code).toBe('DEPENDENCY_UNAVAILABLE');
      expect(quarantinedFor(id)).toBe(0);
      expect((await intentRow(id)).status).toBe('PENDING');
    } finally {
      clamd.mode = 'OK';
    }

    const later = await request(env.anonymousApp())
      .put(intent.body.url)
      .set('Content-Type', 'application/pdf')
      .send(PDF);
    expect(later.status).toBe(204);
    expect(quarantinedFor(id)).toBe(1);
  });

  it('TEST-LC-08 a replayed upload is refused and stores nothing more', async () => {
    const intent = await issue(ITEM(7));
    const id = intent.body.uploadIntentId;
    const first = await request(env.anonymousApp())
      .put(intent.body.url)
      .set('Content-Type', 'application/pdf')
      .send(PDF);
    expect(first.status).toBe(204);

    const replay = await request(env.anonymousApp())
      .put(intent.body.url)
      .set('Content-Type', 'application/pdf')
      .send(PDF);
    expect(replay.status).toBe(409);
    expect(replay.body.error.code).toBe('INVALID_STATE');
    expect(quarantinedFor(id)).toBe(1);
  });

  it('TEST-LC-09 an expired link is refused and stores nothing', async () => {
    const intent = await issue(ITEM(8));
    const id = intent.body.uploadIntentId;
    await env.admin.query(
      "update app.upload_intent set expires_at = now() - interval '1 minute' where id = $1",
      [id],
    );

    const late = await request(env.anonymousApp())
      .put(intent.body.url)
      .set('Content-Type', 'application/pdf')
      .send(PDF);
    expect(late.status).toBe(410);
    expect(late.body.error.code).toBe('LINK_EXPIRED');
    expect(quarantinedFor(id)).toBe(0);
    expect((await intentRow(id)).status).toBe('PENDING');
  });

  it('TEST-LC-10 bytes that differ from the declared file are refused and not kept', async () => {
    const intent = await issue(ITEM(9));
    const id = intent.body.uploadIntentId;
    const other = Buffer.from('%PDF-1.4 a different file');

    const wrong = await request(env.anonymousApp())
      .put(intent.body.url)
      .set('Content-Type', 'application/pdf')
      .send(other);
    expect(wrong.status).toBe(422);
    expect(quarantinedFor(id)).toBe(0);
    expect((await intentRow(id)).status).toBe('PENDING');
  });

  it('TEST-LC-11 a file over the size cap is refused when the intent is issued, and no intent is written', async () => {
    const declared = 21 * 1024 * 1024;
    const res = await issue(ITEM(10), PDF, declared);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d: { issue: string }) => d.issue)).toContain('TOO_LARGE');
    const rows = await env.admin.query(
      'select count(*)::int as n from app.upload_intent where checklist_item_id = $1',
      [ITEM(10)],
    );
    expect(rows.rows[0].n).toBe(0);
  });

  it('TEST-LC-12 the link belongs to the issuing tenant: another tenant cannot complete the intent', async () => {
    const intent = await issue(ITEM(11));
    const id = intent.body.uploadIntentId;
    await request(env.anonymousApp()).put(intent.body.url).set('Content-Type', 'application/pdf').send(PDF);

    const otherTenant = env.appAs(env.B, STAFF);
    const refused = await request(otherTenant).post(`/v1/upload-intents/${id}/completion`).send({});
    expect(refused.status).toBe(404);
    expect((await intentRow(id)).status).toBe('UPLOADED');
    // The bytes stay under the issuing tenant's prefix.
    const row = await intentRow(id);
    expect(row.object_key.startsWith(`${env.A.tenantId}/`)).toBe(true);
    expect(row.object_key.startsWith(`${env.B.tenantId}/`)).toBe(false);
  });

  it('TEST-LC-14 a body over the cap is refused by the request parser, and nothing is stored', async () => {
    // ITEM(0) has no intent yet: the first scenario's intent was refused, so this one is the item's first.
    const intent = await issue(ITEM(0));
    const id = intent.body.uploadIntentId;
    // A declared file of a few bytes, and a body above MAX_UPLOAD_BYTES: the parser stops reading at the cap.
    const oversized = Buffer.alloc(21 * 1024 * 1024, 0x25);
    const res = await request(env.anonymousApp())
      .put(intent.body.url)
      .set('Content-Type', 'application/pdf')
      .send(oversized);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MALFORMED_REQUEST');
    expect(quarantinedFor(id)).toBe(0);
    expect((await intentRow(id)).status).toBe('PENDING');
  });

  it('TEST-LC-13 the upload link is rate limited, so it cannot be used to flood storage', async () => {
    // A fresh application has its own limiter, so the count starts at zero.
    const fresh = env.anonymousApp();
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) {
      const res = await request(fresh)
        .put('/public/v1/document-uploads/not-a-real-token')
        .set('Content-Type', 'application/pdf')
        .send(PDF);
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 30).every((s) => s === 404)).toBe(true);
    expect(statuses[30]).toBe(429);
  });
});
