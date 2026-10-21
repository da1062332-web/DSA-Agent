// TEST-SEC-001 inventory (owner: Dev 1). Every /v1 operation in openapi/openapi.yaml is swept by cases/sweep.spec.ts as
// tenant B against tenant A ids, so each path parameter must be mapped in sweep-map.ts; every operation must answer 401
// without a token. A new endpoint whose parameter the sweep cannot fill fails CI here (.github/pull_request_template.md).
// Module cases in cases/<module>.spec.ts add checks with valid bodies; the operationIds they name must still exist.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestApp } from '../../apps/api/test/support/fake-auth';
import { fill, v1Operations } from './harness';
import { pathParams, unmapped } from './sweep-map';

const casesDir = path.resolve(import.meta.dirname, 'cases');
const casesText = readdirSync(casesDir)
  .filter((f) => f.endsWith('.spec.ts'))
  .map((f) => readFileSync(path.join(casesDir, f), 'utf8'))
  .join('\n');

describe('TEST-SEC-001 endpoint inventory', () => {
  const ops = v1Operations();

  it('TEST-SEC-001-INV-01 the inventory is not empty', () => {
    expect(ops.length).toBeGreaterThan(0);
  });

  it('TEST-SEC-001-INV-02 every /v1 operation is swept against tenant A ids (cases/sweep.spec.ts)', () => {
    // The sweep calls every operation; it can only aim at a tenant A record when sweep-map.ts knows the parameter.
    const missing = ops.flatMap((op) =>
      pathParams(op.path)
        .map(unmapped)
        .filter((m): m is string => m !== null)
        .map((m) => `${op.operationId} ${op.method.toUpperCase()} ${op.path}: ${m}`),
    );
    expect(missing, 'map these parameters in tests/isolation/sweep-map.ts').toEqual([]);
  });

  it('TEST-SEC-001-INV-04 operations named in a module case exist in the OpenAPI document', () => {
    const known = new Set(ops.map((op) => op.operationId));
    const named = [...casesText.matchAll(/\bAPI-[A-Z]+-\d{3}\b/g)].map((m) => m[0]);
    const stale = [...new Set(named)].filter(
      (id) => ![...known].some((k) => k === id || k.startsWith(`${id}-`)),
    );
    expect(stale, 'a case names an operationId that is no longer in openapi/openapi.yaml').toEqual([]);
  });

  it('TEST-SEC-001-INV-03 every /v1 operation is 401 without a token', async () => {
    const app = createTestApp();
    for (const op of ops) {
      const res = await request(app)[op.method](fill(op.path, 'x_1')).send({});
      expect(res.status, `${op.operationId} ${op.method.toUpperCase()} ${op.path}`).toBe(401);
    }
  });
});
