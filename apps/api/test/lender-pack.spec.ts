// P2-04 lender pack routes, unit level (owner: Dipanshu). Permission, header and body checks run before any database call (the test
// app has no database), and the ZIP layout is a pure function. Database behaviour is in lender-pack.int.spec.ts.
import { ErrorEnvelope, type PermissionCode } from '@dsa/contracts';
import { unzipSync } from 'fflate';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { canonicalManifest } from '../src/modules/origination/lender-cases/package-port';
import { zipPack, type PackFile } from '../src/modules/origination/applications/lender-pack';
import { createTestApp, fakeAuth, testPrincipal } from './support/fake-auth';

const as = (codes: PermissionCode[]) =>
  createTestApp({
    auth: fakeAuth(
      testPrincipal({ grants: codes.map((code) => ({ code, scope: 'TENANT' as const, branchIds: [] })) }),
    ),
  });
const code = (res: request.Response) => ErrorEnvelope.parse(res.body).error.code;
const CASE = 'lcs_01JD8Y3Z4K5M6N7P8Q9R0S1T2V';
const LENDER = 'lnd_01JD8Y3Z4K5M6N7P8Q9R0S1T2V';
const profile = { documentOrder: ['PAN'], filenamePattern: '{seq}_{docType}' };

describe('P2-04 lender packs: permissions and headers', () => {
  it('TEST-PACK-005 the download needs lender_case.submit; document.download and lender.manage are not enough', async () => {
    const res = await request(as(['document.download', 'lender.manage', 'application.read'])).get(
      `/v1/lender-cases/${CASE}/pack`,
    );
    expect(res.status).toBe(403);
    expect(code(res)).toBe('FORBIDDEN');
  });

  it('TEST-PACK-006 saving a profile needs lender.manage or config.manage, and If-Match', async () => {
    const denied = await request(as(['lender.read', 'lender_case.submit']))
      .put(`/v1/lenders/${LENDER}/pack-profile`)
      .set('If-Match', '"0"')
      .send(profile);
    expect(denied.status).toBe(403);
    const noIfMatch = await request(as(['lender.manage']))
      .put(`/v1/lenders/${LENDER}/pack-profile`)
      .send(profile);
    expect(noIfMatch.status).toBe(400);
    expect(code(noIfMatch)).toBe('MALFORMED_REQUEST');
    const read = await request(as(['application.read'])).get(`/v1/lenders/${LENDER}/pack-profile`);
    expect(read.status).toBe(403);
  });

  it('TEST-PACK-007 a bad pattern, a repeated type, an unknown field or a tenant id is 422', async () => {
    for (const body of [
      { ...profile, filenamePattern: '{docType}' },
      { ...profile, documentOrder: ['PAN', 'PAN'] },
      { ...profile, mergePdf: true },
      { ...profile, tenantId: 'ten_x' },
    ]) {
      const res = await request(as(['config.manage']))
        .put(`/v1/lenders/${LENDER}/pack-profile`)
        .set('If-Match', '"0"')
        .send(body);
      expect(res.status, JSON.stringify(body)).toBe(422);
      expect(code(res)).toBe('VALIDATION_ERROR');
    }
  });
});

describe('P2-04 lender packs: the ZIP and the manifest hash', () => {
  const f = (documentTypeCode: string, text: string): PackFile => ({
    checklistItemId: `chk_${documentTypeCode}`,
    documentTypeCode,
    party: 'PRIMARY',
    originalFileName: `${documentTypeCode.toLowerCase()}.pdf`,
    mimeType: 'application/pdf',
    bytes: new TextEncoder().encode(text),
    versionId: null,
  });

  it('TEST-PACK-008 the ZIP has one entry per file, in profile order, and the same pack gives the same bytes', () => {
    const files = [f('BANK_STATEMENT', 'bank'), f('PAN', 'pan')];
    const frozenAt = new Date('2026-11-28T05:00:00Z');
    const a = zipPack(files, profile, frozenAt);
    expect(a.names).toEqual(['1_PAN.pdf', '2_BANK_STATEMENT.pdf']);
    const out = unzipSync(a.zip);
    expect(Object.keys(out)).toEqual(a.names);
    expect(new TextDecoder().decode(out['1_PAN.pdf'])).toBe('pan');
    expect(Buffer.from(zipPack(files, profile, frozenAt).zip).equals(Buffer.from(a.zip))).toBe(true);
  });

  it('TEST-PACK-009 the manifest is re-serialised in the builder key order whatever order jsonb returns it in', () => {
    const built = {
      applicationId: 'app_1',
      lenderId: 'lnd_1',
      productVersionId: 'prv_1',
      attemptNo: 1,
      documents: [{ checklistItemId: 'chk_1', documentTypeCode: 'PAN', documentId: 'doc_1', sha256: null }],
      waivers: [],
      builtAt: '2026-11-28T05:00:00.000Z',
    };
    const shuffled = {
      waivers: [],
      builtAt: built.builtAt,
      documents: [{ sha256: null, documentId: 'doc_1', documentTypeCode: 'PAN', checklistItemId: 'chk_1' }],
      lenderId: 'lnd_1',
      attemptNo: 1,
      applicationId: 'app_1',
      productVersionId: 'prv_1',
    };
    expect(canonicalManifest(shuffled)).toBe(JSON.stringify(built));
  });
});
