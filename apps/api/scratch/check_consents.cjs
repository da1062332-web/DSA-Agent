const { Client } = require('pg');
const client = new Client({
  connectionString:
    'postgresql://postgres.mlpkwwhnagxzinaohdxg:Qloax%40DSA%2312@aws-0-ap-south-1.pooler.supabase.com:5432/postgres',
});
client
  .connect()
  .then(async () => {
    const consents = await client.query(
      "SELECT * FROM app.consent_record WHERE subject_id IN ('cust_01M51NCA91T9FP2JWKKRK70PXJ', 'lead_01M51MSQ9RBDZTX2PQZ5XTKXSS')",
    );
    console.log('Consents found:', consents.rows);
    const branches = await client.query('SELECT id, code, name FROM app.branch');
    console.log('Branches:', branches.rows);
    await client.end();
  })
  .catch(console.error);
