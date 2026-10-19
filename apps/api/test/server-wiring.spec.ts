// Production wiring (owner: Dev 1). Routes treat some ports as required and fail closed (503) without them, and the unit and integration tests
// inject their own, so a missing port in the production wiring is invisible until a real deployment. src/server.ts builds the app from
// createProductionDeps in src/wiring.ts (the database harnesses use the same function); this checks that the function provides each port.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const server = readFileSync(path.resolve(__dirname, '../src/server.ts'), 'utf8');
const wiring = readFileSync(path.resolve(__dirname, '../src/wiring.ts'), 'utf8');
const depsBlock = wiring.slice(
  wiring.indexOf('export function createProductionDeps'),
  wiring.indexOf('export function createOutboxSubscribers'),
);

describe('the production wiring provides what the routes require', () => {
  it.each([
    ['txRunner', 'every route'],
    ['authz', 'every permission check'],
    ['audit', 'audit in the same transaction as the change'],
    ['complaintSubjectPort', 'complaint intake (subjects must exist in the tenant)'],
    ['productVersionPort', 'application transitions (T-APP-01)'],
    ['lenderPort', 'complaint referrals to a lender (503 DEPENDENCY_UNAVAILABLE without it)'],
    ['dataSharingPort', 'document sharing and consent'],
    ['apiClientRepository', 'API clients (kept in memory without it)'],
    ['decisionPort', 'BRE lead routing and duplicates, SLA targets, the document checklist (503 on evaluations without it)'],
    ['taskPort', 'the first-contact and lender-query tasks'],
    ['applicationPort', 'lead conversion and lender package documents (503 without it)'],
    ['consentPort', 'lender packages and submissions (503 without it: nothing is shared without consent)'],
    ['outboxPort', 'domain events from finance, ledger, reconciliation and automation'],
  ])('TEST-WIRING-%# createProductionDeps provides %s (%s)', (key) => {
    expect(depsBlock).toMatch(new RegExp(String.raw`\b${key}\b`));
  });

  it.each([
    ['server.ts', server],
    ['wiring.ts', wiring],
  ])('TEST-WIRING-99 nothing imported by %s is left unused (an unused import usually means a port was dropped)', (_file, src) => {
    const imports = [...src.matchAll(/import \{([^}]+)\} from/g)].flatMap((m) =>
      m[1]!
        .split(',')
        .map((n) => n.trim().replace(/^type /, ''))
        .filter(Boolean),
    );
    const body = src.replace(/import [^;]+;/g, '');
    expect(imports.filter((name) => !new RegExp(String.raw`\b${name}\b`).test(body))).toEqual([]);
  });

  it('TEST-WIRING-98 the background worker runs the outbox relay, so events are delivered', () => {
    expect(server).toMatch(/startBackgroundWorker\(\{[\s\S]*outboxRelay: new OutboxRelay/);
  });

  it('TEST-WIRING-97 server.ts builds the app from the production wiring', () => {
    expect(server).toMatch(/const deps = createProductionDeps\(txRunner\)/);
    expect(server).toMatch(/createApp\(\{\s*deps,/);
  });
});
