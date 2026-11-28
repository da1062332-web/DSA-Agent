// TEST-APP-HIST application status history, unit level: the permission is checked before any database call. Database behaviour and
// tenant isolation are in application-history.int.spec.ts and tests/isolation/cases/application-collateral.spec.ts.
import { ErrorEnvelope } from '@dsa/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestApp, fakeAuth, testPrincipal } from './support/fake-auth';

describe('TEST-APP-HIST status history: permissions', () => {
  it('TEST-APP-HIST-001 reading the status history needs application.read (403 without)', async () => {
    const app = createTestApp({
      auth: fakeAuth(testPrincipal({ grants: [{ code: 'lead.read', scope: 'TENANT', branchIds: [] }] })),
    });
    const res = await request(app).get('/v1/applications/app_01HZX0000000000000000000AA/status-history');
    expect(res.status).toBe(403);
    expect(ErrorEnvelope.parse(res.body).error.code).toBe('FORBIDDEN');
  });
});
