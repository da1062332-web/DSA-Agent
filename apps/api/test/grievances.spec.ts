// MOD-GRV Grievances, unit level (owner: Dev 3; DSA Notion MODULE 13). Permissions, headers and input validation run before
// any database call, so these tests need no database. Workflow and concurrency are in grievances.int.spec.ts.
import { ErrorEnvelope, type PermissionCode } from '@dsa/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestApp, fakeAuth, testPrincipal } from './support/fake-auth';

const as = (...codes: PermissionCode[]) =>
  createTestApp({
    auth: fakeAuth(
      testPrincipal({ grants: codes.map((code) => ({ code, scope: 'TENANT' as const, branchIds: [] })) }),
    ),
  });
const code = (res: request.Response) => ErrorEnvelope.parse(res.body).error.code;
const IDEM = { 'Idempotency-Key': 'grv-key-00000001' };
const COMPLAINT = 'grv_01HZX0000000000000000000AA';
const APP = 'app_01HZX0000000000000000000AA';

const complaint = {
  complainantType: 'APPLICATION',
  complainantId: APP,
  channel: 'PHONE',
  category: 'SERVICE',
  description: 'Customer waited three weeks for a callback',
};

describe('grievances: permissions (complaint.create, complaint.manage)', () => {
  it('TEST-GRV-001 intake is 403 without complaint.create, even for a complaint handler', async () => {
    const res = await request(as('complaint.manage')).post('/v1/complaints').set(IDEM).send(complaint);
    expect(res.status).toBe(403);
    expect(code(res)).toBe('FORBIDDEN');
  });

  it('TEST-GRV-002 the queue, detail, assignment and resolution are 403 without complaint.manage', async () => {
    const app = as('complaint.create');
    const calls = [
      request(app).get('/v1/complaints'),
      request(app).get(`/v1/complaints/${COMPLAINT}`),
      request(app).patch(`/v1/complaints/${COMPLAINT}`).set('If-Match', '"0"').send({ category: 'PROCESS' }),
      request(app)
        .post(`/v1/complaints/${COMPLAINT}/resolution`)
        .set(IDEM)
        .set('If-Match', '"0"')
        .send({ action: 'RESOLVE', resolution: 'Callback made and the file was cleared.' }),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status).toBe(403);
      expect(code(res)).toBe('FORBIDDEN');
    }
  });
});

describe('grievances: idempotency and concurrency headers', () => {
  it('TEST-GRV-003 intake without Idempotency-Key is 400 MALFORMED_REQUEST', async () => {
    const res = await request(as('complaint.create')).post('/v1/complaints').send(complaint);
    expect(res.status).toBe(400);
    expect(code(res)).toBe('MALFORMED_REQUEST');
  });

  it('TEST-GRV-004 edits and resolutions without If-Match are 400 MALFORMED_REQUEST', async () => {
    const manage = as('complaint.manage');
    const patch = await request(manage).patch(`/v1/complaints/${COMPLAINT}`).send({ category: 'PROCESS' });
    expect(patch.status).toBe(400);
    expect(code(patch)).toBe('MALFORMED_REQUEST');

    const resolve = await request(manage)
      .post(`/v1/complaints/${COMPLAINT}/resolution`)
      .set(IDEM)
      .send({ action: 'RESOLVE', resolution: 'Callback made and the file was cleared.' });
    expect(resolve.status).toBe(400);
    expect(code(resolve)).toBe('MALFORMED_REQUEST');
  });
});

describe('grievances: input validation (422 before any database call)', () => {
  const create = (body: Record<string, unknown>) =>
    request(as('complaint.create')).post('/v1/complaints').set(IDEM).send(body);
  const patch = (body: Record<string, unknown>) =>
    request(as('complaint.manage')).patch(`/v1/complaints/${COMPLAINT}`).set('If-Match', '"0"').send(body);

  it('TEST-GRV-005 intake rejects a short description, an unknown channel or category, and unknown fields', async () => {
    const bad = [
      { ...complaint, description: 'Too short' },
      { ...complaint, channel: 'FAX' },
      { ...complaint, category: 'MOOD' },
      { ...complaint, status: 'RESOLVED' },
      { ...complaint, complainantType: 'CUSTOMER' },
      { ...complaint, dueAt: 'next Tuesday' },
    ];
    for (const body of bad) {
      const res = await create(body);
      expect(res.status).toBe(422);
      expect(code(res)).toBe('VALIDATION_ERROR');
    }
  });

  it('TEST-GRV-006 a description with a PAN, Aadhaar-style or account number is refused (S3 data)', async () => {
    for (const description of [
      'PAN is ABCDE1234F for this customer',
      'Aadhaar 1234 5678 9012 was shared on the call',
      'Account 123456789012 was debited twice',
    ]) {
      const res = await create({ ...complaint, description });
      expect(res.status).toBe(422);
      expect(code(res)).toBe('VALIDATION_ERROR');
    }
  });

  it('TEST-GRV-007 an edit needs at least one field and cannot set a status other than IN_PROGRESS', async () => {
    const empty = await patch({});
    expect(empty.status).toBe(422);
    const resolved = await patch({ status: 'RESOLVED' });
    expect(resolved.status).toBe(422);
    expect(code(resolved)).toBe('VALIDATION_ERROR');
  });

  it('TEST-GRV-008 a lender referral needs a lender and a reference', async () => {
    const res = await patch({ lenderReferral: { lenderId: 'lnd_01HZX0000000000000000000AA' } });
    expect(res.status).toBe(422);
  });

  it('TEST-GRV-009 resolving needs a written resolution; reopening needs a reason', async () => {
    const manage = as('complaint.manage');
    const noText = await request(manage)
      .post(`/v1/complaints/${COMPLAINT}/resolution`)
      .set(IDEM)
      .set('If-Match', '"0"')
      .send({ action: 'RESOLVE' });
    expect(noText.status).toBe(422);

    const noReason = await request(manage)
      .post(`/v1/complaints/${COMPLAINT}/resolution`)
      .set(IDEM)
      .set('If-Match', '"1"')
      .send({ action: 'REOPEN' });
    expect(noReason.status).toBe(422);

    const unknown = await request(manage)
      .post(`/v1/complaints/${COMPLAINT}/resolution`)
      .set(IDEM)
      .set('If-Match', '"1"')
      .send({ action: 'DELETE' });
    expect(unknown.status).toBe(422);
  });

  it('TEST-GRV-010 the queue rejects a page size outside 1 to 200', async () => {
    const res = await request(as('complaint.manage')).get('/v1/complaints?limit=0');
    expect(res.status).toBe(422);
  });
});

describe('grievances: delete is not offered (TEST-GRV-011)', () => {
  it('a complaint cannot be deleted', async () => {
    const res = await request(as('complaint.manage'))
      .delete(`/v1/complaints/${COMPLAINT}`)
      .set('If-Match', '"0"');
    expect(res.status).toBe(404);
  });
});
