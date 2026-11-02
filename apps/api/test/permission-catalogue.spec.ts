// Permission catalogue consistency (owner: Dev 1). A migration that grants a permission nobody defined fails as soon as a tenant
// exists when it runs (as on hosted), because role_permission.permission_code references permission(code). Static check, no database.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { LEGACY_PARENTS, PERMISSION_CODES, SUB_PERMISSION_CODES } from '@dsa/contracts';
import { describe, expect, it } from 'vitest';
import { ROLE_GRANT_FIXES } from '../../../seeds/demo/platform';

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

  it('TEST-PERM-03 every permission in the contracts (the 151-code catalogue) is defined by some migration, so a role can actually hold it', () => {
    const missing = PERMISSION_CODES.filter((code) => !defined.has(code));
    expect(missing).toEqual([]);
  });

  it('TEST-PERM-07 the 32 sub-permissions are defined by migration 98 and by no other migration', () => {
    for (const code of SUB_PERMISSION_CODES)
      expect(defined.get(code), code).toBe('20261001000098_permission_sub_permissions_expand.sql');
  });

  it('TEST-PERM-07 the backfill in migration 98 grants each sub-permission from exactly its LEGACY_PARENTS, so SQL and contract cannot drift', () => {
    const sql = readFileSync(path.join(DIR, '20261001000098_permission_sub_permissions_expand.sql'), 'utf8');
    const backfill = /VALUES\s*(.*?)\)\s*AS m\(parent, child\)/is.exec(sql)?.[1] ?? '';
    const fromSql = new Set<string>();
    for (const m of backfill.matchAll(/\(\s*'([a-z_.]+)'\s*,\s*'([a-z_.]+)'\s*\)/g))
      fromSql.add(`${m[1]} -> ${m[2]}`);
    const fromContract = new Set<string>();
    for (const [child, parents] of Object.entries(LEGACY_PARENTS))
      for (const parent of parents) fromContract.add(`${parent} -> ${child}`);
    expect([...fromSql].filter((p) => !fromContract.has(p))).toEqual([]);
    expect([...fromContract].filter((p) => !fromSql.has(p))).toEqual([]);
  });

  it('TEST-PERM-08 migration 99 grants exactly the ROLE_GRANT_FIXES of the demo seed, so the seed and the database cannot drift', () => {
    const sql = readFileSync(path.join(DIR, '20261001000099_role_grants_per_roles_page.sql'), 'utf8');
    const rows = /VALUES\s*(.*?)\)\s*AS g\(role_code, permission_code\)/is.exec(sql)?.[1] ?? '';
    const fromSql = new Set<string>();
    for (const m of rows.matchAll(/\(\s*'(ROLE-[A-Z-]+)'\s*,\s*'([a-z_.]+)'\s*\)/g))
      fromSql.add(`${m[1]} ${m[2]}`);
    const fromSeed = new Set<string>();
    for (const [role, codes] of Object.entries(ROLE_GRANT_FIXES))
      for (const code of codes) fromSeed.add(`${role} ${code}`);
    expect(fromSql.size).toBeGreaterThan(0);
    expect([...fromSql].filter((p) => !fromSeed.has(p))).toEqual([]);
    expect([...fromSeed].filter((p) => !fromSql.has(p))).toEqual([]);
  });

  it('TEST-PERM-08 migration 99 only adds grants: it deletes and updates nothing, and every code it grants is in the catalogue', () => {
    const sql = readFileSync(path.join(DIR, '20261001000099_role_grants_per_roles_page.sql'), 'utf8')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    // Statements only: a quoted permission code such as 'application.update' is not an UPDATE.
    expect(sql.replace(/'[^']*'/g, "''")).not.toMatch(/\b(DELETE|UPDATE|TRUNCATE|DROP)\b/i);
    const catalogue = new Set<string>(PERMISSION_CODES);
    const unknown = [...sql.matchAll(CODE)].map((m) => m[1]!).filter((c) => !catalogue.has(c));
    expect(unknown).toEqual([]);
  });

  it('TEST-PERM-04 the migration that completed the catalogue defined nine permissions in migration 60', () => {
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
const KNOWN_ENFORCED_BUT_UNGRANTED: string[] = [];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? sourceFiles(path.join(dir, e.name))
      : e.name.endsWith('.ts')
        ? [path.join(dir, e.name)]
        : [],
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
      for (const m of text.matchAll(
        /(?:requirePermission|requireAnyPermission|assertPermission|requireStepUp)\w*\(([^;]*?)\)/gs,
      ))
        for (const c of m[1]!.matchAll(CODE)) if (catalogue.has(c[1]!)) enforced.add(c[1]!);
    }
    expect(enforced.size).toBeGreaterThan(50);
    const deadEnds = [...enforced].filter(
      (c) => !grantable.has(c) && !KNOWN_ENFORCED_BUT_UNGRANTED.includes(c),
    );
    expect(deadEnds).toEqual([]);
    for (const c of KNOWN_ENFORCED_BUT_UNGRANTED)
      expect(grantable.has(c), `${c} is now granted: remove it from the known list`).toBe(false);
  });
});
