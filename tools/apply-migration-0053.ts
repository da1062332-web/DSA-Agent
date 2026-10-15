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
  '20261001000047_invoices_and_statements.sql',
);

const sql = readFileSync(migrationPath, 'utf8');

const client = new pg.Client({ connectionString: url });
await client.connect();

try {
  console.log('Applying migration 20261001000047_invoices_and_statements.sql...');
  await client.query(sql);
  console.log('Migration 20261001000047 applied successfully!');
} catch (err: any) {
  console.error('Error applying migration:', err);
  process.exit(1);
} finally {
  await client.end();
}
