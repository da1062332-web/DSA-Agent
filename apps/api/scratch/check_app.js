const { Client } = require('pg');
// The connection string comes from the environment, never from this file. These one-off scripts touch whatever database it names.
if (!process.env.VERIFY_DATABASE_URL) throw new Error('Set VERIFY_DATABASE_URL to the database this script should use.');
const client = new Client({ connectionString: process.env.VERIFY_DATABASE_URL });
client.connect().then(async () => {
  const res = await client.query("SELECT id, customer_id, lead_id, requested_amount, status FROM loan_application WHERE customer_id = 'cust_01M51NCA91T9FP2JWKKRK70PXJ'");
  console.log('App records:', res.rows);
  await client.end();
}).catch(console.error);
