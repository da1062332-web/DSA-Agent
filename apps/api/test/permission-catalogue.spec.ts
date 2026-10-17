// Permission catalogue consistency (owner: Dev 1). A migration that grants a permission nobody defined fails as soon as a tenant
// exists when it runs (as on hosted), because role_permission.permission_code references permission(code). Static check, no database.
import { readdirSync, readFileSync } from 'node:fs';
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
