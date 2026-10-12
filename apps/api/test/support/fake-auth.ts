// Test helpers so every lane can write route tests from Day 1.
// TASK-102 moves fakeAuth to @dsa/kernel/testing with the same signature.
import type { Principal, TxRunner } from '@dsa/contracts';
import type { Express, RequestHandler } from 'express';
import { createApp } from '../../src/app';
import type { ApiDeps } from '../../src/modules/types';

export function fakeAuth(principal: Principal): RequestHandler {
  return (req, _res, next) => {
    req.ctx = {
      principal,
      correlationId: req.correlationId,
      now: new Date(),
      ip: req.ip,
      userAgent: req.get('user-agent'),
    };
    next();
  };
}

export function testPrincipal(overrides: Partial<Principal> = {}): Principal {
  return {
    kind: 'USER',
    id: 'usr_01JTESTUSER0000000000000000',
    tenantId: 'ten_01JTESTTENANT00000000000000',
    primaryBranchId: null,
    managedTeamMemberIds: [],
    queueIds: [],
    grants: [],
    authTime: null,
    ...overrides,
  };
}

const unusedTxRunner: TxRunner = {
  withTenantTx: () => Promise.reject(new Error('No TxRunner configured for this test')),
};

export function createTestApp(opts: { auth?: RequestHandler; deps?: Partial<ApiDeps> } = {}): Express {
  return createApp({
    deps: { txRunner: unusedTxRunner, ...opts.deps },
    corsAllowedOrigins: [],
    auth: opts.auth,
  });
}
