// The approved eligibility rule set exists in two places: migration 55 (what is evaluated) and the code copy used to create new
// rule sets (rules/db.ts). Both must hash to the same canonical value, or new rule sets would start from different rules.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { computeContentHash } from '@dsa/bre-core';
import { describe, expect, it } from 'vitest';
import { getApprovedDefaultRuleSet } from '../src/modules/rules/db';

const ROOT = path.resolve(__dirname, '../../..');
const APPROVED_HASH = 'sha256:9e492649899860eb1d5491c443d001b167a6d8bd0fbefb45bd6fa827e9f5b3d2';

describe('TEST-ELG-DRIFT the approved eligibility rule set has one content', () => {
  it('the migration 55 definition hashes to the value recorded in that migration', () => {
    const sql = readFileSync(
      path.join(ROOT, 'supabase/migrations/20261001000055_approved_eligibility_rules.sql'),
      'utf8',
    );
    const match = sql.match(/'(\{"schemaVersion":1[\s\S]*?)'::jsonb,\n {2}'\{"result":"REFER"/);
    expect(match, 'definition literal found in migration 55').not.toBeNull();
    expect(computeContentHash(JSON.parse(match![1]!))).toBe(APPROVED_HASH);
    expect(sql).toContain(APPROVED_HASH);
  });

  it('the code copy (used to create new rule sets) has the same canonical content', () => {
    expect(computeContentHash(getApprovedDefaultRuleSet('DK-application.eligibility'))).toBe(APPROVED_HASH);
  });
});
