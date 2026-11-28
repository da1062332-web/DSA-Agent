// P2-04 migration 0121 static checks (owner: Dipanshu). No database: runs in `npm test`. The rehearsal on a throwaway Postgres is
// migration-0121-lender-pack-profile.int.spec.ts.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../..');
const MIGRATIONS = path.join(ROOT, 'supabase/migrations');
const M121 = readdirSync(MIGRATIONS).find((f) => f.startsWith('20261001000121_'))!;
const read = (p: string) => readFileSync(p, 'utf8');
const stripComments = (sql: string) =>
  sql
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n');

describe('P2-04 migration 0121 (static)', () => {
  const sql = read(path.join(MIGRATIONS, M121));

  it('TEST-M121-S1 the migration is additive: it deletes, truncates, drops and updates nothing', () => {
    const statements = stripComments(sql).replace(/'[^']*'/g, "''");
    expect(statements).not.toMatch(/\b(DELETE|TRUNCATE|DROP)\b/i);
    expect(statements).not.toMatch(/\bUPDATE\s+(app\.)?[a-z_]+\s+SET\b/i);
  });

  it('TEST-M121-S2 it adds no permission: the pack uses lender_case.submit and the lender permissions', () => {
    expect(stripComments(sql)).not.toMatch(/INSERT INTO (app\.)?(permission|role_permission)\b/i);
  });

  it('TEST-M121-S3 the API role may read, insert and update a profile, never delete it', () => {
    expect(sql).toMatch(/GRANT SELECT, INSERT, UPDATE ON lender_pack_profile TO dsa_app;/);
    expect(sql).not.toMatch(/GRANT[^;]*DELETE[^;]*lender_pack_profile/i);
  });

  it('TEST-M121-S4 the rollback drops the table in one transaction', () => {
    const rb = stripComments(read(path.join(ROOT, 'tools/sql/batch/121.rollback.sql')));
    expect(rb).toMatch(/^BEGIN;/m);
    expect(rb).toMatch(/^COMMIT;/m);
    expect(rb).toContain('DROP TABLE IF EXISTS app.lender_pack_profile;');
  });
});
