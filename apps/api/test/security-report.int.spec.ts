// Permission audit F-04, on a throwaway PostgreSQL: the full app and the real route, as the API role (NOBYPASSRLS). A security event filed over
// HTTP is stored with the server's principal, address and severity, never the caller's; the row passes the real table constraints; and the
// events the system detects itself are still recordable through the trusted path.
import { SECURITY_EVENT_TYPES, type PermissionCode, type RequestContext } from '@dsa/contracts';
import { createIdGenerator } from '@dsa/kernel';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startIsolationEnv, type IsolationEnv } from '../../../tests/isolation/harness';
import { createTxRunner } from '../src/kernel-min/tx-runner';
import { SecurityService } from '../src/modules/security/service';
import { createTestDeps, testPrincipal } from './support/fake-auth';

let env: IsolationEnv;
const REPORTER: PermissionCode[] = ['security.incident'];
const as = (tenant: 'A' | 'B', codes: PermissionCode[]) => env.appAs(tenant === 'A' ? env.A : env.B, codes);

beforeAll(async () => {
  env = await startIsolationEnv();
}, 240_000);

afterAll(async () => {
  await env?.stop();
});

const forged = {
  type: 'SUSPICIOUS_ACCESS',
  principal: 'usr_victim_99',
  ip: '10.9.9.9',
  severity: 'CRITICAL',
  details: { note: 'p', reportedBy: 'usr_forged', source: 'SIEM', password: 'Sup3rSecret!' },
};
const rowsFor = async (tenantId: string) =>
  (
    await env.admin.query(
      `SELECT type, principal, ip, severity, details FROM app.security_event WHERE tenant_id = $1 ORDER BY created_at`,
      [tenantId],
    )
  ).rows;

describe('F-04 a reported security event, against the real table', () => {
  it('TEST-HARD-SECINT-01 no permission and a permission of another kind are refused, and nothing is written', async () => {
    const before = (await rowsFor(env.A.tenantId)).length;
    for (const codes of [[], ['lead.read', 'finance.view', 'config.manage']] as PermissionCode[][]) {
      expect((await request(as('A', codes)).post('/v1/security/events').send(forged)).status).toBe(403);
    }
    expect((await rowsFor(env.A.tenantId)).length).toBe(before);
  });

  it('TEST-HARD-SECINT-02 the stored row has the filer, the request address and a server-chosen severity; the claims sit under details.claimed', async () => {
    const res = await request(as('A', REPORTER)).post('/v1/security/events').send(forged);
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const stored = (await rowsFor(env.A.tenantId)).at(-1)!;
    expect(stored.type).toBe('SUSPICIOUS_ACCESS');
    expect(stored.principal).toBe(env.A.userIds[0]); // not usr_victim_99
    expect(stored.ip).not.toBe('10.9.9.9');
    expect(stored.severity).toBe('MEDIUM'); // not CRITICAL
    expect(stored.details.claimed).toEqual({
      principal: 'usr_victim_99',
      ip: '10.9.9.9',
      severity: 'CRITICAL',
    });
    expect(stored.details).toMatchObject({
      reportedBy: env.A.userIds[0],
      reporterKind: 'USER',
      source: 'API_REPORT',
    });
    expect(stored.details.password).toBe('[REDACTED]');
  });

  it('TEST-HARD-SECINT-03 every type the system detects itself is refused over HTTP, and nothing is stored for it', async () => {
    const before = (await rowsFor(env.A.tenantId)).length;
    for (const type of SECURITY_EVENT_TYPES.filter((t) => t !== 'SUSPICIOUS_ACCESS')) {
      const res = await request(as('A', REPORTER))
        .post('/v1/security/events')
        .send({ ...forged, type });
      expect(res.status, type).toBe(422);
    }
    expect((await rowsFor(env.A.tenantId)).length).toBe(before);
  });

  it('TEST-HARD-SECINT-04 oversized details are refused; a missing principal, address and severity are fine', async () => {
    const big = await request(as('A', REPORTER))
      .post('/v1/security/events')
      .send({ type: 'SUSPICIOUS_ACCESS', details: { b: 'x'.repeat(20_000) } });
    expect(big.status).toBe(422);
    const bare = await request(as('A', REPORTER))
      .post('/v1/security/events')
      .send({ type: 'SUSPICIOUS_ACCESS' });
    expect(bare.status).toBe(201);
    expect(bare.body.details.claimed).toEqual({ principal: null, ip: null, severity: null });
  });

  it('TEST-HARD-SECINT-05 the trusted path still records every type with the detector’s own metadata, and the table accepts all of them', async () => {
    const service = new SecurityService({
      ...createTestDeps({}),
      txRunner: createTxRunner(env.db),
      ids: createIdGenerator(),
    } as never);
    const ctx = {
      principal: testPrincipal({ tenantId: env.A.tenantId, id: env.A.userIds[0] }),
      correlationId: 'corr-sec-int',
      now: new Date(),
    } as RequestContext;
    for (const type of SECURITY_EVENT_TYPES) {
      const e = await service.recordSecurityEvent(ctx, {
        type,
        principal: `SYSTEM:detector-${type}`,
        ip: '10.0.0.9',
        severity: 'HIGH',
        details: {},
      });
      expect(e).toMatchObject({ type, principal: `SYSTEM:detector-${type}`, severity: 'HIGH' });
    }
  });

  it('TEST-HARD-SECINT-06 tenant isolation: the other tenant’s holder never reads these events, and writes only to its own tenant', async () => {
    const list = await request(as('B', REPORTER)).get('/v1/security/events');
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain('usr_victim_99');
    const before = (await rowsFor(env.A.tenantId)).length;
    expect(
      (await request(as('B', REPORTER)).post('/v1/security/events').send({ type: 'SUSPICIOUS_ACCESS' }))
        .status,
    ).toBe(201);
    expect((await rowsFor(env.A.tenantId)).length).toBe(before);
    expect((await rowsFor(env.B.tenantId)).length).toBe(1);
  });
});
