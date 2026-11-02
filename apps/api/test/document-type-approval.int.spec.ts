// Approval of a document type for partner upload (migration 0098, the document-types API). A new type starts unapproved; only a configuration
// manager approves or withdraws it; an update that does not mention the flag keeps the stored approval (TEST-DOCAPPR).
import type { PermissionCode, Principal } from '@dsa/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createTxRunner } from '../src/kernel-min/tx-runner';
import { createProductionDeps } from '../src/wiring';
import { startIsolationEnv, type IsolationEnv } from '../../../tests/isolation/harness';
import { fakeAuth, testPrincipal } from './support/fake-auth';

let env: IsolationEnv;
let seq = 0;
const key = (label: string) => `dta_${label}_${seq++}`;

const as = (grants: PermissionCode[], overrides: Partial<Principal> = {}) =>
  createApp({
    deps: createProductionDeps(createTxRunner(env.db)),
    corsAllowedOrigins: [],
    auth: fakeAuth(
      testPrincipal({
        id: env.A.userIds[0],
        tenantId: env.A.tenantId,
        primaryBranchId: env.A.branchId,
        authTime: new Date().toISOString(),
        grants: grants.map((code) => ({ code, scope: 'TENANT' as const, branchIds: [] })),
        ...overrides,
      }),
    ),
  });
const configManager = () => as(['config.manage', 'document.view']);

const type = (over: Record<string, unknown> = {}) => ({
  code: 'PAN_CARD',
  name: 'PAN card',
  category: 'IDENTITY',
  ...over,
});

beforeAll(async () => {
  env = await startIsolationEnv();
}, 240_000);

afterAll(async () => {
  await env?.stop();
});

const listed = async (code: string) => {
  const res = await request(configManager()).get('/v1/document-types');
  expect(res.status).toBe(200);
  return res.body.data.find((t: { code: string }) => t.code === code);
};

describe('document type approval for partner upload (TEST-DOCAPPR)', () => {
  it('TEST-DOCAPPR-01 a new document type starts unapproved for partners', async () => {
    const res = await request(configManager())
      .post('/v1/document-types')
      .set('Idempotency-Key', key('new'))
      .send(type());
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.partnerUpload).toBe(false);
    expect((await listed('PAN_CARD')).partnerUpload).toBe(false);
  });

  it('TEST-DOCAPPR-02 a configuration manager approves the type, and the approval is audited', async () => {
    const res = await request(configManager())
      .post('/v1/document-types')
      .set('Idempotency-Key', key('approve'))
      .send(type({ partnerUpload: true }));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.partnerUpload).toBe(true);
    expect((await listed('PAN_CARD')).partnerUpload).toBe(true);
    const audit = await env.admin.query(
      `select after->>'partnerUpload' as approved from app.audit_event
        where action = 'document_type.updated' and entity_type = 'DOCUMENT_TYPE' and after->>'code' = 'PAN_CARD'
        order by occurred_at desc limit 1`,
    );
    expect(audit.rows[0]?.approved).toBe('true');
  });

  it('TEST-DOCAPPR-03 an update that does not mention the flag keeps the stored approval', async () => {
    const res = await request(configManager())
      .post('/v1/document-types')
      .set('Idempotency-Key', key('rename'))
      .send(type({ name: 'PAN card (identity)' }));
    expect(res.status).toBe(200);
    expect(res.body.partnerUpload).toBe(true);
    expect((await listed('PAN_CARD')).name).toBe('PAN card (identity)');
  });

  it('TEST-DOCAPPR-04 a user without configuration rights cannot approve a type, and the stored state does not change', async () => {
    const res = await request(as(['document.view']))
      .post('/v1/document-types')
      .set('Idempotency-Key', key('forbidden'))
      .send(type({ code: 'ADDRESS_PROOF', name: 'Address proof', category: 'ADDRESS', partnerUpload: true }));
    expect(res.status).toBe(403);
    const row = await env.admin.query(
      `select count(*)::int as n from app.document_type where code = 'ADDRESS_PROOF'`,
    );
    expect(row.rows[0].n).toBe(0);
  });

  it('TEST-DOCAPPR-05 a configuration manager withdraws the approval', async () => {
    const res = await request(configManager())
      .post('/v1/document-types')
      .set('Idempotency-Key', key('withdraw'))
      .send(type({ partnerUpload: false }));
    expect(res.status).toBe(200);
    expect(res.body.partnerUpload).toBe(false);
    expect((await listed('PAN_CARD')).partnerUpload).toBe(false);
  });
});
