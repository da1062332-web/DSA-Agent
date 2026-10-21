import { readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const url = (() => {
  const value = process.env.VERIFY_DATABASE_URL;
  if (!value) {
    throw new Error(
      'VERIFY_DATABASE_URL is not set. This tool writes to the database it is pointed at: set it explicitly (node --env-file=apps/api/.env), never rely on a built-in default.',
    );
  }
  return value;
})();

const migrationPath = path.resolve(
  import.meta.dirname,
  '..',
  'supabase',
  'migrations',
  '20261001000069_permission_realignment_and_period_close.sql',
);

const verifyPath = path.resolve(
  import.meta.dirname,
  'sql',
  '0069',
  'verify.sql',
);

const sql = readFileSync(migrationPath, 'utf8');
const verifySql = readFileSync(verifyPath, 'utf8');

const client = new pg.Client({ connectionString: url });
await client.connect();

try {
  console.log('Applying migration 20261001000069_permission_realignment_and_period_close.sql to hosted...');
  await client.query('BEGIN');
  await client.query(sql);
  await client.query('COMMIT');
  console.log('Migration 20261001000069 applied successfully!\n');

  console.log('Running verification checks (read-only)...');
  const result = await client.query(verifySql);
  // find the rows from the query
  const rows = Array.isArray(result) ? result[result.length - 1].rows : result.rows;
  console.table(rows);

  const failed = rows.filter((r: any) => r.result !== 'PASS');
  if (failed.length > 0) {
    console.error('Verification failed for checks:', failed);
    process.exit(1);
  }
  console.log('\nAll verification checks PASSED!');
} catch (err: any) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('Error applying migration:', err);
  process.exit(1);
} finally {
  await client.end();
}
