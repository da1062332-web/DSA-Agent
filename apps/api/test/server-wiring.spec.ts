// Production wiring (owner: Dev 1). Routes treat some ports as required and fail closed (503) without them, and the unit and integration tests
// inject their own, so a missing line in src/server.ts is invisible until a real deployment. This checks that the entry point wires each one.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const server = readFileSync(path.resolve(__dirname, '../src/server.ts'), 'utf8');
const depsBlock = server.slice(server.indexOf('deps: {'), server.indexOf('corsAllowedOrigins'));

describe('src/server.ts wires what the routes require', () => {
  it.each([
    ['txRunner', 'every route'],
    ['authz', 'every permission check'],
    ['audit', 'audit in the same transaction as the change'],
    ['complaintSubjectPort', 'complaint intake (subjects must exist in the tenant)'],
    ['productVersionPort', 'application transitions (T-APP-01)'],
    ['lenderPort', 'complaint referrals to a lender (503 DEPENDENCY_UNAVAILABLE without it)'],
    ['dataSharingPort', 'document sharing and consent'],
    ['apiClientRepository', 'API clients (kept in memory without it)'],
  ])('TEST-WIRING-%# server.ts provides %s (%s)', (key) => {
    expect(depsBlock).toMatch(new RegExp(String.raw`\b${key}\b`));
  });

  it('TEST-WIRING-99 nothing imported by server.ts is left unused (an unused import usually means a port was dropped)', () => {
    const imports = [...server.matchAll(/import \{([^}]+)\} from/g)].flatMap((m) =>
      m[1]!
        .split(',')
        .map((n) => n.trim().replace(/^type /, ''))
        .filter(Boolean),
    );
    const body = server.replace(/import [^;]+;/g, '');
    expect(imports.filter((name) => !new RegExp(String.raw`\b${name}\b`).test(body))).toEqual([]);
  });
});
