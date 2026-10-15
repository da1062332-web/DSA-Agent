import { createDb } from '../src/kernel-min/db';
import { sql } from 'kysely';

async function main() {
  const db = createDb(process.env.VERIFY_DATABASE_URL!);
  
  const sanctions = await sql<{ id: string; tenant_id: string; status: string }>`
    SELECT id, tenant_id, status FROM app.sanction
  `.execute(db);
  console.log('Sanctions in DB:', sanctions.rows);

  await db.destroy();
}

main().catch(console.error);
