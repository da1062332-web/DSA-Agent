import { createDb } from '../src/kernel-min/db';
import { sql } from 'kysely';

async function main() {
  const db = createDb(process.env.VERIFY_DATABASE_URL!);

  const cases = await sql<{ id: string; tenant_id: string; status: string }>`
    SELECT id, tenant_id, status FROM app.lender_case
  `.execute(db);
  console.log('Lender cases:', cases.rows);

  await db.destroy();
}

main().catch(console.error);
