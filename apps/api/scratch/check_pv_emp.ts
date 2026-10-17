import { createDb } from '../src/kernel-min/db';
import { sql } from 'kysely';

async function main() {
  const db = createDb(process.env.VERIFY_DATABASE_URL!);

  const pv = await sql`SELECT id, tenant_id FROM app.product_version LIMIT 5`.execute(db);
  console.log('product_version:', pv.rows);

  const emp = await sql`SELECT id, tenant_id FROM app.empanelment LIMIT 5`.execute(db);
  console.log('empanelment:', emp.rows);

  await db.destroy();
}

main().catch(console.error);
