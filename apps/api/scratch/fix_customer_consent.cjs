const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres.mlpkwwhnagxzinaohdxg:Qloax%40DSA%2312@aws-0-ap-south-1.pooler.supabase.com:5432/postgres' });
client.connect().then(async () => {
  // Check if consent already exists for customer
  const check = await client.query("SELECT * FROM app.consent_record WHERE subject_type = 'CUSTOMER' AND subject_id = 'cust_01M51NCA91T9FP2JWKKRK70PXJ'");
  if (check.rows.length === 0) {
    const leadConsent = await client.query("SELECT * FROM app.consent_record WHERE subject_type = 'LEAD' AND subject_id = 'lead_01M51MSQ9RBDZTX2PQZ5XTKXSS'");
    if (leadConsent.rows.length > 0) {
      const lc = leadConsent.rows[0];
      const newId = 'cnst_01M51CUSTCONSENT' + Date.now().toString().slice(-6);
      await client.query(`
        INSERT INTO app.consent_record (
          id, tenant_id, subject_type, subject_id, purpose, purpose_target,
          notice_version, channel, evidence_ref, captured_by, captured_at,
          status, created_at
        ) VALUES ($1, $2, 'CUSTOMER', $3, $4, $5, $6, $7, $8, $9, $10, 'ACTIVE', NOW())
      `, [
        newId, lc.tenant_id, 'cust_01M51NCA91T9FP2JWKKRK70PXJ', lc.purpose,
        lc.purpose_target, lc.notice_version, lc.channel, lc.evidence_ref,
        lc.captured_by, lc.captured_at
      ]);
      console.log('Inserted customer consent:', newId);
    }
  } else {
    console.log('Customer consent already exists:', check.rows);
  }
  await client.end();
}).catch(console.error);
