// Permission catalogue consistency (owner: Dev 1). A migration that grants a permission nobody defined fails as soon as a tenant
// exists when it runs (as on hosted), because role_permission.permission_code references permission(code). Static check, no database.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PERMISSION_CODES } from '@dsa/contracts';
import { describe, expect, it } from 'vitest';

const DIR = path.resolve(__dirname, '../../../supabase/migrations');
const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();
const CODE = /'([a-z_]+(?:\.[a-z_]+)+)'/g;

const defined = new Map<string, string>();
const granted = new Map<string, Set<string>>();
for (const f of files) {
  const sql = readFileSync(path.join(DIR, f), 'utf8');
  for (const m of sql.matchAll(/INSERT INTO (?:app\.)?permission\s*(?:\([^)]*\))?\s*VALUES(.*?);/gis))
    for (const c of m[1]!.matchAll(/\(\s*'([a-z_]+(?:\.[a-z_]+)+)'\s*,/g))
      if (!defined.has(c[1]!)) defined.set(c[1]!, f);
  for (const m of sql.matchAll(/INSERT INTO (?:app\.)?role_permission.*?;/gis))
    for (const c of m[0].matchAll(CODE)) granted.set(c[1]!, (granted.get(c[1]!) ?? new Set()).add(f));
}

describe('permission catalogue', () => {
  it('TEST-PERM-01 every permission a migration grants is defined by the same or an earlier migration', () => {
    const problems: string[] = [];
    for (const [code, where] of granted) {
      const by = defined.get(code);
      // Only codes that look like permissions and are used with a catalogue (not table names such as app.role).
      if (!by) {
        if (
          /^(customer|lead|task|share|document|consent|application|connector|disbursement|sanction|lender_case)\./.test(
            code,
          )
        )
          problems.push(`${code} granted in ${[...where].join(', ')} but defined by no migration`);
        continue;
      }
      const firstGrant = [...where].sort()[0]!;
      if (by > firstGrant) problems.push(`${code} is granted in ${firstGrant} before it is defined in ${by}`);
    }
    expect(problems).toEqual([]);
  });

  it('TEST-PERM-03 every permission in the contracts (the 100-code catalogue) is defined by some migration, so a role can actually hold it', () => {
    const missing = PERMISSION_CODES.filter((code) => !defined.has(code));
    expect(missing).toEqual([]);
  });

  it('TEST-PERM-04 the migration that completed the catalogue defined nine permissions and granted none (commission is Release 3, lead.reopen falls back)', () => {
    const NINE = [
      'commission.plan.edit',
      'commission.plan.approve',
      'commission.calculate',
      'customer.reveal_sensitive',
      'lead.reopen',
      'lender.read',
      'lender.manage',
      'product.read',
      'product.manage',
    ];
    for (const code of NINE)
      expect(defined.get(code), code).toBe('20261001000060_permission_catalogue_completion.sql');
    for (const code of NINE)
      expect([...(granted.get(code) ?? [])], `${code} must not be granted by any migration`).toEqual([]);
  });

  it('TEST-PERM-02 customer.create and customer.update are defined by a migration, as M-001 permissions', () => {
    expect(defined.get('customer.create')).toBe(
      '20261001000051_reconcile_tenant_admin_operational_grants.sql',
    );
    expect(defined.get('customer.update')).toBe(
      '20261001000051_reconcile_tenant_admin_operational_grants.sql',
    );
  });
});

// A permission a route enforces but no role can ever be given is a dead end: the feature works for nobody. Commission plan edit and approve
// are the known exception (Release 3: defined and enforced, deliberately granted to nobody until commission is promoted).
const SRC = path.resolve(__dirname, '../src');
const SEED = path.resolve(__dirname, '../../../seeds/demo/platform.ts');
const KNOWN_ENFORCED_BUT_UNGRANTED = ['commission.plan.approve', 'commission.plan.edit'];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sourceFiles(path.join(dir, e.name)) : e.name.endsWith('.ts') ? [path.join(dir, e.name)] : [],
  );
}

describe('permission enforcement vs grants', () => {
  it('TEST-PERM-05 every permission a route enforces can be granted by a migration or the demo role seed, except the Release 3 commission plan ones', () => {
    const catalogue = new Set<string>(PERMISSION_CODES);
    const grantable = new Set<string>([...granted.keys()]);
    if (existsSync(SEED)) for (const c of readFileSync(SEED, 'utf8').matchAll(CODE)) grantable.add(c[1]!);
    const enforced = new Set<string>();
    for (const f of sourceFiles(SRC)) {
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/(?:requirePermission|requireAnyPermission|assertPermission|requireStepUp)\w*\(([^;]*?)\)/gs))
        for (const c of m[1]!.matchAll(CODE)) if (catalogue.has(c[1]!)) enforced.add(c[1]!);
    }
    expect(enforced.size).toBeGreaterThan(50);
    const deadEnds = [...enforced].filter((c) => !grantable.has(c) && !KNOWN_ENFORCED_BUT_UNGRANTED.includes(c));
    expect(deadEnds).toEqual([]);
    for (const c of KNOWN_ENFORCED_BUT_UNGRANTED) expect(grantable.has(c), `${c} is now granted: remove it from the known list`).toBe(false);
  });
});
