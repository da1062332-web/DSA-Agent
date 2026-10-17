import { createDb } from '../src/kernel-min/db';
import { sql } from 'kysely';

async function main() {
  const db = createDb(process.env.VERIFY_DATABASE_URL!);

  const lenders = await sql<{ id: string; tenant_id: string; name: string }>`
    SELECT id, tenant_id, name FROM app.lender
  `.execute(db);
  console.log('All lenders:', lenders.rows);

  const tenants = await sql<{ id: string; name: string }>`
    SELECT id, name FROM app.tenant
  `.execute(db);
  console.log('All tenants:', tenants.rows);

  await db.destroy();
}

main().catch(console.error);
