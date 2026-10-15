import { createDb } from '../src/kernel-min/db';
import { sql } from 'kysely';

async function main() {
  const db = createDb(process.env.VERIFY_DATABASE_URL!);
  
  const deleteGrants = await sql<{ table_name: string }>`
    SELECT table_name
    FROM information_schema.role_table_grants
    WHERE grantee = 'dsa_app' AND privilege_type = 'DELETE'
  `.execute(db);
  console.log('Tables where dsa_app has DELETE privilege:', deleteGrants.rows.map(r => r.table_name));

  await db.destroy();
}

main().catch(console.error);
