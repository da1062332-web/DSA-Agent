import { createDb } from '../src/kernel-min/db';
import { sql } from 'kysely';

async function main() {
  const db = createDb(process.env.VERIFY_DATABASE_URL!);
  
  const tables = await sql<{ table_name: string }>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'app'
    ORDER BY table_name
  `.execute(db);
  console.log('Tables in app schema:', tables.rows.map(t => t.table_name));

  await db.destroy();
}

main().catch(console.error);
