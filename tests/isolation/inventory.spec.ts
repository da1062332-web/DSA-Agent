// TEST-SEC-001 inventory (owner: Dev 1). Every /v1 operation in openapi/openapi.yaml must be named (by its
// operationId) in at least one tests/isolation/cases/*.spec.ts, and must answer 401 without a token.
// A new endpoint without an isolation case fails CI here (.github/pull_request_template.md).
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestApp } from '../../apps/api/test/support/fake-auth';
import { fill, v1Operations } from './harness';

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

  it('TEST-SEC-001-INV-02 every /v1 operation has an isolation case', () => {
    const missing = ops
      .filter((op) => !casesText.includes(op.operationId))
      .map((op) => `${op.operationId} ${op.method.toUpperCase()} ${op.path}`);
    expect(missing, 'add these operationIds to a tests/isolation/cases/<module>.spec.ts').toEqual([]);
  });

  it('TEST-SEC-001-INV-03 every /v1 operation is 401 without a token', async () => {
    const app = createTestApp();
    for (const op of ops) {
      const res = await request(app)[op.method](fill(op.path, 'x_1')).send({});
      expect(res.status, `${op.operationId} ${op.method.toUpperCase()} ${op.path}`).toBe(401);
    }
  });
});
