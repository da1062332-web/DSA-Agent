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
  '20261001000046_workforce_management.sql',
);

const sql = readFileSync(migrationPath, 'utf8');

const client = new pg.Client({ connectionString: url });
await client.connect();

try {
  console.log('Applying migration 20261001000046_workforce_management.sql...');
  await client.query(sql);
  console.log('Migration 20261001000046 applied successfully!');
} catch (err: any) {
  console.error('Error applying migration:', err);
  process.exit(1);
} finally {
  await client.end();
}
