import { createDb } from '../src/kernel-min/db';
import { sql } from 'kysely';

async function check() {
  const db = createDb(process.env.VERIFY_DATABASE_URL!);
  
  const rolesWithCust = await sql<{ role_code: string; permission_code: string }>`
    SELECT r.code as role_code, rp.permission_code
    FROM app.role_permission rp
    JOIN app.role r ON rp.role_id = r.id
    WHERE rp.permission_code LIKE 'customer.%'
  `.execute(db);
  console.log('Roles with customer permissions:', rolesWithCust.rows);

  await db.destroy();
}

check().catch(console.error);
