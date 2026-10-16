const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres.mlpkwwhnagxzinaohdxg:Qloax%40DSA%2312@aws-0-ap-south-1.pooler.supabase.com:5432/postgres' });
client.connect().then(async () => {
  const tenantId = 'ten_01M4SXZ9E66W8T6DNJYBVNS3FA';
  const lenderId = 'lnd_01M51P84A7VZCKB5W31ADTBPM3';
  const check = await client.query("SELECT * FROM app.loan_product WHERE category = 'PL' AND tenant_id = $1", [tenantId]);
  if (check.rows.length === 0) {
    const prodId = 'prd_01M51PLSTANDARD' + Date.now().toString().slice(-4);
    await client.query(`
      INSERT INTO app.loan_product (
        id, tenant_id, lender_id, name, category, applicant_types, secured, status,
        created_at, created_by, updated_at, updated_by
      ) VALUES ($1, $2, $3, 'HDFC Express Personal Loan', 'PL', $4, false, 'ACTIVE', NOW(), 'SYSTEM', NOW(), 'SYSTEM')
    `, [prodId, tenantId, lenderId, ['SALARIED', 'INDIVIDUAL', 'SELF_EMPLOYED_PROFESSIONAL', 'SELF_EMPLOYED_BUSINESS']]);
    
    const verId = 'prv_01M51PLVER' + Date.now().toString().slice(-4);
    await client.query(`
      INSERT INTO app.loan_product_version (
        id, tenant_id, product_id, version_no, effective_from, amount_min, amount_max,
        currency, tenure_min_months, tenure_max_months, illustrative_rate_text, status,
        created_at, created_by, fee_text, geo_rules, workflow_profile, eligibility_scope
      ) VALUES (
        $1, $2, $3, 1, '2026-01-01', 50000.00, 2500000.00,
        'INR', 12, 60, 'Illustrative rate 10.5% p.a.', 'ACTIVE',
        NOW(), 'SYSTEM', '1.5% Processing Fee', '[]', '{}', '{}'
      )
    `, [verId, tenantId, prodId]);
    console.log('Successfully inserted PL Product:', prodId, 'Version:', verId);
  } else {
    console.log('PL product already exists:', check.rows[0].id);
  }
  await client.end();
}).catch(console.error);
