import { createDb } from '../src/kernel-min/db';
import { sql } from 'kysely';

async function main() {
  const db = createDb(process.env.VERIFY_DATABASE_URL!);
  
  await sql`
    GRANT DELETE ON app.report_schedule TO dsa_app;
  `.execute(db);

  console.log('Granted DELETE on app.report_schedule to dsa_app.');
  await db.destroy();
}

main().catch(console.error);
