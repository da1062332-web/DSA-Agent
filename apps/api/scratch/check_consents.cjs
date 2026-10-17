const { Client } = require('pg');
// The connection string comes from the environment, never from this file. These one-off scripts touch whatever database it names.
if (!process.env.VERIFY_DATABASE_URL)
  throw new Error('Set VERIFY_DATABASE_URL to the database this script should use.');
const client = new Client({ connectionString: process.env.VERIFY_DATABASE_URL });
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
