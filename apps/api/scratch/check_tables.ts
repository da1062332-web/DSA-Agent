import { createDb } from '../src/kernel-min/db';
import { sql } from 'kysely';

async function main() {
  const db = createDb(process.env.VERIFY_DATABASE_URL!);

  const lcCols = await sql<{ column_name: string; is_nullable: string }>`
    SELECT column_name, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'app' AND table_name = 'lender_case'
  `.execute(db);
  console.log('lender_case columns:', lcCols.rows);

  const appCols = await sql<{ column_name: string; is_nullable: string }>`
    SELECT column_name, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'app' AND table_name = 'loan_application'
  `.execute(db);
  console.log('loan_application columns:', appCols.rows);

  const lndCols = await sql<{ column_name: string; is_nullable: string }>`
    SELECT column_name, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'app' AND table_name = 'lender'
  `.execute(db);
  console.log('lender columns:', lndCols.rows);

  await db.destroy();
}

main().catch(console.error);
