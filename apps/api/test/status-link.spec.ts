// Customer status link (task P3-05, checklist 6.2 and 6.3; TEST-STATUS-*). The token rules and the route rules. The branch and owner scope
// and the SQL reads are covered by the isolation case and the integration suite.
import { FileLinkSigner } from '../src/modules/origination/applications/document-store';
import {
  CUSTOMER_STAGE_LABEL,
  customerProgress,
  customerStageLabel,
  InMemoryStatusLinkRepository,
  STATUS_LINK_TTL_SECONDS,
  StatusLinkSigner,
} from '../src/modules/origination/applications/status-link';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { ErrorEnvelope, type AuditPort, type PermissionCode } from '@dsa/contracts';
import { createTestApp, fakeAuth, testPrincipal } from './support/fake-auth';

const SECRET = 'status-link-test-secret-0123456789abcdef';
const TENANT_A = 'ten_01JSTATUSTENANTA0000000000';
const TENANT_B = 'ten_01JSTATUSTENANTB0000000000';
const APP = 'app_01JSTATUS0000000000000001';
const NOW_S = () => Math.floor(Date.now() / 1000);

const passThroughTx = {
  withTenantTx: async (_ctx: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({}),
};

function appRepo(): InMemoryStatusLinkRepository {
  const repo = new InMemoryStatusLinkRepository();
  repo.add(
    TENANT_A,
    { id: APP, status: 'DOCUMENTS_PENDING', updatedAt: '2026-11-26T09:30:00.000Z' },
    ['Salary slip'],
  );
  return repo;
}

function sinks() {
  const audit: { action: string; entityId: string | null; after?: Record<string, unknown> }[] = [];
  const auditPort: AuditPort = {
    record: async (_tx, _ctx, e) => {
      audit.push({ action: e.action, entityId: e.entityId, after: e.after });
      return 'aud_status';
    },
  };
  return { audit, auditPort };
}

const as = (tenantId: string, ...codes: PermissionCode[]) =>
  testPrincipal({ tenantId, grants: codes.map((code) => ({ code, scope: 'TENANT' as const, branchIds: [] })) });

function appFor(principal: ReturnType<typeof testPrincipal>, repo: InMemoryStatusLinkRepository, audit: AuditPort) {
  return createTestApp({
    auth: fakeAuth(principal),
    deps: {
      txRunner: passThroughTx as never,
      statusLinkRepository: repo,
      audit,
      documentLinkSecret: SECRET,
    },
  });
}

describe('TEST-STATUS-01 status link token', () => {
  const signer = new StatusLinkSigner(SECRET);
  const claims = { t: TENANT_A, a: APP, e: NOW_S() + STATUS_LINK_TTL_SECONDS };

  it('TEST-STATUS-01 a fresh link verifies and returns its tenant and application', () => {
    const token = signer.sign(claims);
    expect(signer.verify(token, NOW_S())).toEqual(claims);
  });

  it('TEST-STATUS-01 an altered link is refused', () => {
    const token = signer.sign(claims);
    const [body, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...claims, a: 'app_other' })).toString('base64url');
    expect(signer.verify(`${forged}.${sig}`, NOW_S())).toBeNull();
    expect(signer.verify(`${body}x.${sig}`, NOW_S())).toBeNull();
    expect(signer.verify(`${body}.${sig}.extra`, NOW_S())).toBeNull();
  });

  it('TEST-STATUS-01 an expired link is refused', () => {
    const expired = signer.sign({ ...claims, e: NOW_S() - 1 });
    expect(signer.verify(expired, NOW_S())).toBeNull();
  });

  it('TEST-STATUS-01 a link signed with another secret is refused', () => {
    const other = new StatusLinkSigner('another-secret-0123456789abcdef0123456789').sign(claims);
    expect(signer.verify(other, NOW_S())).toBeNull();
  });

  it('TEST-STATUS-01 a document link, signed with the same secret, is never accepted as a status link', () => {
    const documentLink = new FileLinkSigner(SECRET).sign({ t: TENANT_A, k: 'v', i: 'dver_1', d: 'inline', e: claims.e });
    expect(signer.verify(documentLink, NOW_S())).toBeNull();
  });
});

describe('TEST-STATUS-02 progress along the customer path', () => {
  it('TEST-STATUS-02 a state on the path is the current step, and nothing past it is marked', () => {
    expect(customerProgress('DRAFT').currentIndex).toBe(0);
    expect(customerProgress('READY_FOR_SUBMISSION').currentIndex).toBe(1);
    expect(customerProgress('SANCTIONED').currentIndex).toBe(4);
    expect(customerProgress('DISBURSED').currentIndex).toBe(5);
  });

  it('TEST-STATUS-02 a closed application has no current step and is flagged closed', () => {
    for (const status of ['CLOSED', 'REJECTED', 'WITHDRAWN', 'CANCELLED']) {
      expect(customerProgress(status)).toMatchObject({ currentIndex: null, closed: true });
    }
  });

  it('TEST-STATUS-02 a state with no label is off the path, so the page does not invent a step', () => {
    expect(customerProgress('SOME_NEW_STATE')).toEqual({
      steps: expect.any(Array),
      currentIndex: null,
      closed: false,
    });
  });
});

describe('TEST-STATUS-02 stage labels', () => {
  it('TEST-STATUS-02 the customer sees the proposed label, and an unknown state shows as In progress', () => {
    expect(customerStageLabel('DOCUMENTS_PENDING')).toBe('Under processing');
    expect(customerStageLabel('SANCTIONED')).toBe('Approved');
    expect(customerStageLabel('REJECTED')).toBe('Closed');
    expect(customerStageLabel('SOME_NEW_STATE')).toBe('In progress');
    expect(Object.keys(CUSTOMER_STAGE_LABEL)).toHaveLength(12);
  });
});

describe('TEST-STATUS-03 the staff route creates the link (POST /v1/applications/{id}/status-link)', () => {
  it('TEST-STATUS-03 a caller without application.read is refused with 403', async () => {
    const { auditPort } = sinks();
    const res = await request(appFor(as(TENANT_A), appRepo(), auditPort)).post(`/v1/applications/${APP}/status-link`);
    expect(res.status).toBe(403);
    expect(ErrorEnvelope.parse(res.body).error.code).toBe('FORBIDDEN');
  });

  it('TEST-STATUS-03 an application outside the tenant or unknown is 404', async () => {
    const { auditPort } = sinks();
    const app = appFor(as(TENANT_B, 'application.read'), appRepo(), auditPort);
    const res = await request(app).post(`/v1/applications/${APP}/status-link`);
    expect(res.status).toBe(404);
  });

  it('TEST-STATUS-03 the link is a /status path with a seven-day expiry, and its creation is audited', async () => {
    const { audit, auditPort } = sinks();
    const res = await request(appFor(as(TENANT_A, 'application.read'), appRepo(), auditPort)).post(
      `/v1/applications/${APP}/status-link`,
    );
    expect(res.status).toBe(201);
    expect(res.body.url.startsWith('/status/')).toBe(true);
    const token = res.body.url.slice('/status/'.length);
    const verified = new StatusLinkSigner(SECRET).verify(token, NOW_S());
    expect(verified).toMatchObject({ t: TENANT_A, a: APP });
    const days = (Date.parse(res.body.expiresAt) - Date.now()) / 1000 / 86400;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThanOrEqual(7.01);
    expect(audit.map((a) => a.action)).toEqual(['status_link.created']);
  });
});

describe('TEST-STATUS-04 the customer view (GET /public/v1/status/{token})', () => {
  const issue = (tenantId: string, applicationId: string, e = NOW_S() + 3600) =>
    new StatusLinkSigner(SECRET).sign({ t: tenantId, a: applicationId, e });

  it('TEST-STATUS-04 the acceptance view: Under processing, with the salary slip still pending', async () => {
    const { audit, auditPort } = sinks();
    const res = await request(appFor(as(TENANT_A), appRepo(), auditPort)).get(
      `/public/v1/status/${issue(TENANT_A, APP)}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.stage).toBe('Under processing');
    expect(res.body.pendingDocuments).toEqual(['Salary slip']);
    expect(res.body.lastUpdated).toBe('2026-11-26');
    expect(res.body.progress).toEqual({
      steps: ['Application started', 'Under processing', 'Under review', 'Submitted to lender', 'Approved', 'Disbursed'],
      currentIndex: 1,
      closed: false,
    });
    expect(res.headers['cache-control']).toContain('no-store');
    expect(audit.map((a) => a.action)).toEqual(['status_link.viewed']);
  });

  it('TEST-STATUS-04 the view carries only stage, pending documents, last update and expiry (no name, mobile, amount or PAN)', async () => {
    const { auditPort } = sinks();
    const res = await request(appFor(as(TENANT_A), appRepo(), auditPort)).get(
      `/public/v1/status/${issue(TENANT_A, APP)}`,
    );
    expect(Object.keys(res.body).sort()).toEqual(['expiresAt', 'lastUpdated', 'pendingDocuments', 'progress', 'stage']);
    expect(Object.keys(res.body.progress).sort()).toEqual(['closed', 'currentIndex', 'steps']);
  });

  it('TEST-STATUS-04 an altered or expired link answers 410 LINK_EXPIRED, with no detail about the application', async () => {
    const { auditPort } = sinks();
    const app = appFor(as(TENANT_A), appRepo(), auditPort);
    const altered = issue(TENANT_A, APP).replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
    for (const token of [altered, issue(TENANT_A, APP, NOW_S() - 5), 'not-a-token']) {
      const res = await request(app).get(`/public/v1/status/${token}`);
      expect(res.status).toBe(410);
      expect(ErrorEnvelope.parse(res.body).error.code).toBe('LINK_EXPIRED');
    }
  });

  it('TEST-STATUS-04 another tenant’s link never resolves to this tenant’s application', async () => {
    const { auditPort } = sinks();
    const app = appFor(as(TENANT_A), appRepo(), auditPort);
    const res = await request(app).get(`/public/v1/status/${issue(TENANT_B, APP)}`);
    expect(res.status).toBe(410);
  });

  it('TEST-STATUS-04 a document link is refused on the status route', async () => {
    const { auditPort } = sinks();
    const app = appFor(as(TENANT_A), appRepo(), auditPort);
    const documentLink = new FileLinkSigner(SECRET).sign({ t: TENANT_A, k: 'v', i: 'dver_1', d: 'inline', e: NOW_S() + 3600 });
    const res = await request(app).get(`/public/v1/status/${documentLink}`);
    expect(res.status).toBe(410);
  });

  it('TEST-STATUS-04 the view is rate-limited: the 31st request in a minute answers 429', async () => {
    const { auditPort } = sinks();
    const app = appFor(as(TENANT_A), appRepo(), auditPort);
    const statuses: number[] = [];
    for (let i = 0; i < 31; i += 1) {
      statuses.push((await request(app).get('/public/v1/status/not-a-token')).status);
    }
    expect(statuses.slice(0, 30).every((s) => s === 410)).toBe(true);
    expect(statuses[30]).toBe(429);
  });
});

describe('TEST-STATUS-05 nothing is logged with the token', () => {
  it('TEST-STATUS-05 a refused link is not written to the console', async () => {
    const logs: string[] = [];
    const spies = [
      vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void logs.push(JSON.stringify(a))),
      vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void logs.push(JSON.stringify(a))),
    ];
    try {
      const { auditPort } = sinks();
      const token = 'secret-looking-token-value-123';
      await request(appFor(as(TENANT_A), appRepo(), auditPort)).get(`/public/v1/status/${token}`);
      expect(logs.join('\n')).not.toContain(token);
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
  });
});
