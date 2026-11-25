const { Client } = require('pg');

async function check() {
  // The target comes from the environment only (TEST-SECRETS-01): no database URL or password is written in this file.
  const connectionString = process.env.VERIFY_DATABASE_URL;
  if (!connectionString) {
    console.error('Set VERIFY_DATABASE_URL to the database to read.');
    process.exit(1);
  }
  const client = new Client({ connectionString });
  await client.connect();
  const res = await client.query(`
    SELECT r.id, r.tenant_id, r.code, r.name, t.legal_name
    FROM app.role r
    JOIN app.tenant t ON r.tenant_id = t.id
    ORDER BY t.legal_name, r.code
  `);
  console.log(res.rows);
  await client.end();
}

check().catch(console.error);
