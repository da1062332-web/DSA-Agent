const { Client } = require('pg');
const client = new Client({
  connectionString:
    'postgresql://postgres.mlpkwwhnagxzinaohdxg:Qloax%40DSA%2312@aws-0-ap-south-1.pooler.supabase.com:5432/postgres',
});
client
  .connect()
  .then(async () => {
    const res = await client.query(
      "SELECT id, customer_id, lead_id, requested_amount, status FROM loan_application WHERE customer_id = 'cust_01M51NCA91T9FP2JWKKRK70PXJ'",
    );
    console.log('App records:', res.rows);
    await client.end();
  })
  .catch(console.error);
