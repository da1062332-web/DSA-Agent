const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgresql://postgres.mlpkwwhnagxzinaohdxg:Qloax%40DSA%2312@aws-0-ap-south-1.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false },
});
async function main() {
  await client.connect();
  const app = await client.query("select id, status, updated_at from app.loan_application where id = 'app_01M60KBHCY91ENFSQRRYPPQ9QH'");
  console.log('Application:', app.rows[0]);
  const cases = await client.query("select id, application_id, lender_id, status, channel, lender_reference, submitted_at, sanction_id from app.lender_case where application_id = 'app_01M60KBHCY91ENFSQRRYPPQ9QH'");
  console.log('Lender Cases:', cases.rows);
  await client.end();
}
main().catch(console.error);
