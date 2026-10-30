// Unit tests for the gate that keeps a connector portal login off the internal API (apps/api/src/http/connector-identity-gate.ts).
// The HTTP-level behaviour, including /portal/v1 still working, is in connector-identity.int.spec.ts.
import type { AppError, Principal } from '@dsa/contracts';
import type { Request, Response } from 'express';
import { describe, expect, it } from 'vitest';
import { connectorIdentityGate } from '../src/http/connector-identity-gate';
import { testPrincipal } from './support/fake-auth';

function run(method: string, path: string, principal: Principal | undefined): unknown[] {
  const req = { method, path, ctx: principal ? { principal } : undefined } as unknown as Request;
  const calls: unknown[] = [];
  connectorIdentityGate(req, {} as Response, (err?: unknown) => calls.push(err));
  return calls;
}

const connector = testPrincipal({ userType: 'CONNECTOR' });
const staff = testPrincipal({ userType: 'STAFF' });

describe('connector portal identity on the internal API (TEST-CONIDENT)', () => {
  it('TEST-CONIDENT-001 a connector login is refused an internal route', () => {
    const [err] = run('GET', '/connectors', connector) as [AppError];
    expect(err.code).toBe('FORBIDDEN');
    expect(err.details[0]!.issue).toBe('CONNECTOR_IDENTITY_NOT_ALLOWED');
  });

  it('TEST-CONIDENT-002 a connector login is refused a write on an internal route', () => {
    const [err] = run('POST', '/users/usr_x/roles', connector) as [AppError];
    expect(err.code).toBe('FORBIDDEN');
  });

  it('TEST-CONIDENT-003 a connector login may read its own profile, which the web app uses to choose where to go', () => {
    expect(run('GET', '/me', connector)).toEqual([undefined]);
    expect(run('GET', '/v1/me', connector)).toEqual([undefined]);
  });

  it('TEST-CONIDENT-004 a connector login may not change its profile through the internal API', () => {
    const [err] = run('PATCH', '/me', connector) as [AppError];
    expect(err.code).toBe('FORBIDDEN');
  });

  it('TEST-CONIDENT-005 a staff account passes the gate on every route', () => {
    expect(run('GET', '/connectors', staff)).toEqual([undefined]);
    expect(run('POST', '/users/usr_x/roles', staff)).toEqual([undefined]);
  });

  it('TEST-CONIDENT-006 a request without a principal is left to the authentication step, not refused here', () => {
    expect(run('GET', '/connectors', undefined)).toEqual([undefined]);
  });

  it('TEST-CONIDENT-007 a service principal passes the gate (it has no user type)', () => {
    const service = testPrincipal({ kind: 'SERVICE', id: 'SYSTEM:connector-portal' });
    expect(run('GET', '/connectors', service)).toEqual([undefined]);
  });
});
