const { Client } = require('pg');

async function check() {
  const client = new Client({
    connectionString: 'postgresql://postgres.mlpkwwhnagxzinaohdxg:Qloax%40DSA%2312@aws-0-ap-south-1.pooler.supabase.com:6543/postgres'
  });
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
