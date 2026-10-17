import { createDb } from '../src/kernel-min/db';
import { sql } from 'kysely';

async function main() {
  const dbUrl = process.env.VERIFY_DATABASE_URL || process.env.DATABASE_URL!;
  const db = createDb(dbUrl);

  const tenants = await sql`SELECT id, status FROM app.tenant`.execute(db);
  console.log('Tenants:', tenants.rows);

  const tables = await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'app'
    ORDER BY table_name ASC
  `.execute(db);
  console.log(
    'App tables:',
    tables.rows.map((r: any) => r.table_name),
  );

  const branches = await sql`
    SELECT b.id, b.tenant_id, b.name, b.code
    FROM app.branch b
  `.execute(db);
  console.log('Branches:', branches.rows);

  await db.destroy();
}

main().catch(console.error);
