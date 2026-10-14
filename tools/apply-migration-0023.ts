// tools/apply-migration-0023.ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const url =
  process.env.VERIFY_DATABASE_URL ??
  'postgresql://postgres.mlpkwwhnagxzinaohdxg:Qloax%40DSA%2312@aws-0-ap-south-1.pooler.supabase.com:6543/postgres';

const migrationPath = path.resolve(
  import.meta.dirname,
  '..',
  'supabase',
  'migrations',
  '20261001000023_origination_sanction_disbursement.sql',
);

const sql = readFileSync(migrationPath, 'utf8');

const client = new pg.Client({ connectionString: url });
await client.connect();

try {
  console.log('Applying migration 20261001000023_origination_sanction_disbursement.sql...');
  await client.query(sql);
  console.log('Migration 20261001000023 applied successfully!');
} catch (err: any) {
  if (err.message?.includes('already exists')) {
    console.log('Tables already exist, migration previously applied.');
  } else {
    console.error('Error applying migration:', err);
    process.exit(1);
  }
} finally {
  await client.end();
}
