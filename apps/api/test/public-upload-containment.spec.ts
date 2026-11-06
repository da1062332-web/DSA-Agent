// Regression tests for the 2026-11-04 containment of the public upload route (docs/PRODUCTION_SECURITY_CONTAINMENT.md).
// The route must accept no new request: every method under /public/v1/upload is refused with 503 DEPENDENCY_UNAVAILABLE before any
// handler or service runs. The sharing records and uploaded documents are not read, changed or removed by it.
// The internal sharing workflow is a control: it must keep working.
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../src/http/error-handler';
import type { DocumentSharingService } from '../src/modules/origination/document-sharing/document-sharing-service';
import {
  createPublicDocumentSharingRouter,
  createRouter as createInternalSharingRouter,
} from '../src/modules/origination/document-sharing/router';
import type { ApiDeps } from '../src/modules/types';
import { createTestApp, fakeAuth, testPrincipal } from './support/fake-auth';

const TOKEN = 'tok_01JTESTPUBLICUPLOAD000000';
const SESSION = 'Bearer upl_session_01JTESTSESSION00000000';
const FILE_BODY = {
  checklistItemId: 'chk_01JTESTCHECKLIST0000000000',
  filename: 'payslip.pdf',
  mimeType: 'application/pdf',
  contentBase64: Buffer.from('%PDF-1.4 test').toString('base64'),
};

/** A service whose every method is a spy. The public route must never reach any of them. */
function spiedService() {
  return {
    getPublicUploadStatus: vi.fn(async () => ({ status: 'OPEN' })),
    verifyUploadOtp: vi.fn(async () => ({ verified: true })),
    uploadPublicFile: vi.fn(async () => ({ id: 'doc_01JTEST' })),
    listUploadLinks: vi.fn(async () => ({ items: [] })),
    createUploadLink: vi.fn(async () => ({ link: { id: 'upl_01JTEST', lockVersion: 1 }, isReplayed: false })),
  };
}

type SpiedService = ReturnType<typeof spiedService>;

/** The public router alone, mounted where app.ts mounts it, with the production error envelope. */
function mountPublic(service: SpiedService) {
  const app = express();
  app.use(express.json());
  app.use(
    '/public/v1',
    createPublicDocumentSharingRouter({} as ApiDeps, service as unknown as DocumentSharingService),
  );
  app.use(errorHandler());
  return app;
}

/** The internal router alone, for a caller holding the document.upload permission. */
function mountInternal(service: SpiedService) {
  const app = express();
  app.use(express.json());
  app.use(
    '/v1',
    fakeAuth(testPrincipal({ grants: [{ code: 'document.upload', scope: 'TENANT', branchIds: [] }] })),
    createInternalSharingRouter({} as ApiDeps, service as unknown as DocumentSharingService),
  );
  app.use(errorHandler());
  return app;
}

describe('public upload route containment', () => {
  it('TEST-PUC-01 GET /public/v1/upload/:token is refused with 503 DEPENDENCY_UNAVAILABLE and reads nothing', async () => {
    const service = spiedService();
    const res = await request(mountPublic(service)).get(`/public/v1/upload/${TOKEN}`);

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('DEPENDENCY_UNAVAILABLE');
    expect(res.body.error.httpStatus).toBe(503);
    expect(service.getPublicUploadStatus).not.toHaveBeenCalled();
  });

  it('TEST-PUC-02 POST /public/v1/upload/:token/otp-verification is refused and no OTP is checked', async () => {
    const service = spiedService();
    const res = await request(mountPublic(service))
      .post(`/public/v1/upload/${TOKEN}/otp-verification`)
      .send({ otp: '123456' });

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('DEPENDENCY_UNAVAILABLE');
    expect(service.verifyUploadOtp).not.toHaveBeenCalled();
  });

  it('TEST-PUC-03 POST /public/v1/upload/:token/files cannot accept a new upload, even with a complete request', async () => {
    const service = spiedService();
    const res = await request(mountPublic(service))
      .post(`/public/v1/upload/${TOKEN}/files`)
      .set('Authorization', SESSION)
      .send(FILE_BODY);

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('DEPENDENCY_UNAVAILABLE');
    expect(service.uploadPublicFile).not.toHaveBeenCalled();
  });

  it('TEST-PUC-04 containment runs before validation: a malformed upload is refused the same way, not as a 400 or 422', async () => {
    const service = spiedService();
    const app = mountPublic(service);

    const noSession = await request(app).post(`/public/v1/upload/${TOKEN}/files`).send(FILE_BODY);
    const emptyBody = await request(app)
      .post(`/public/v1/upload/${TOKEN}/files`)
      .set('Authorization', SESSION);
    const badOtp = await request(app).post(`/public/v1/upload/${TOKEN}/otp-verification`).send({});

    for (const res of [noSession, emptyBody, badOtp]) {
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('DEPENDENCY_UNAVAILABLE');
    }
  });

  it('TEST-PUC-05 across every public request, no sharing service method runs', async () => {
    const service = spiedService();
    const app = mountPublic(service);

    await request(app).get(`/public/v1/upload/${TOKEN}`);
    await request(app).post(`/public/v1/upload/${TOKEN}/otp-verification`).send({ otp: '123456' });
    await request(app).post(`/public/v1/upload/${TOKEN}/files`).set('Authorization', SESSION).send(FILE_BODY);

    for (const method of Object.values(service)) {
      expect(method).not.toHaveBeenCalled();
    }
  });

  it('TEST-PUC-06 the production mount refuses new public uploads the same way', async () => {
    // createTestApp mounts the real /public/v1 tree from app.ts, with its real error envelope.
    const app = createTestApp();
    const get = await request(app).get(`/public/v1/upload/${TOKEN}`);
    const post = await request(app)
      .post(`/public/v1/upload/${TOKEN}/files`)
      .set('Authorization', SESSION)
      .send(FILE_BODY);

    expect(get.status).toBe(503);
    expect(get.body.error.code).toBe('DEPENDENCY_UNAVAILABLE');
    expect(post.status).toBe(503);
    expect(post.body.error.code).toBe('DEPENDENCY_UNAVAILABLE');
  });

  it('TEST-PUC-07 the internal sharing workflow is not disabled: staff can still list upload links', async () => {
    const service = spiedService();
    const res = await request(mountInternal(service)).get('/v1/upload-links');

    expect(res.status).toBe(200);
    expect(service.listUploadLinks).toHaveBeenCalledTimes(1);
  });
});
