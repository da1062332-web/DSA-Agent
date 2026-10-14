import { createDb } from '../src/kernel-min/db';
import { sql } from 'kysely';

async function main() {
  const db = createDb(process.env.VERIFY_DATABASE_URL!);
  
  // Check RLS policies on report_schedule
  const policies = await sql<{ policyname: string; cmd: string; qual: string; with_check: string }>`
    SELECT policyname, cmd, qual, with_check
    FROM pg_policies
    WHERE tablename = 'report_schedule'
  `.execute(db);
  console.log('RLS policies on report_schedule:', policies.rows);

  // Check table grants on report_schedule
  const grants = await sql<{ grantee: string; privilege_type: string }>`
    SELECT grantee, privilege_type
    FROM information_schema.role_table_grants
    WHERE table_name = 'report_schedule'
  `.execute(db);
  console.log('Grants on report_schedule:', grants.rows);

  await db.destroy();
}

main().catch(console.error);
