import pg from 'pg';

async function main() {
  const client = new pg.Client({
    connectionString:
      process.env.VERIFY_DATABASE_URL ??
      (() => {
        throw new Error(
          'VERIFY_DATABASE_URL is not set. This script writes to the database it is pointed at.',
        );
      })(),
  });
  await client.connect();

  const leadId = 'lead_demo_01';
  const tenantId = 'ten_demo_01';
  const branchId = 'br_demo_01';

  try {
    await client.query(
      `
      INSERT INTO app.lead (
        id, tenant_id, branch_id, full_name, mobile_e164, mobile_hash,
        product_category, state, owner_user_id, source, lock_version,
        created_at, created_by, updated_at, updated_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), 'usr_demo_01', now(), 'usr_demo_01'
      )
      ON CONFLICT (id) DO NOTHING
    `,
      [
        leadId,
        tenantId,
        branchId,
        'Piyush Navangul',
        '+919876543210',
        Buffer.from('0123456789abcdef0123456789abcdef'),
        'PL',
        'NEW',
        'usr_demo_01',
        'WEBSITE',
        0,
      ],
    );
    console.log('Lead demo inserted successfully');

    await client.query(
      `
      INSERT INTO app.customer (
        id, tenant_id, party_type, full_name, home_branch_id, status, lock_version,
        created_at, created_by, updated_at, updated_by
      ) VALUES (
        'cust_demo_01', $1, 'INDIVIDUAL', 'Piyush Navangul', $2, 'ACTIVE', 0,
        now(), 'usr_demo_01', now(), 'usr_demo_01'
      )
      ON CONFLICT (id) DO NOTHING
    `,
      [tenantId, branchId],
    );
    console.log('Customer demo inserted successfully');

    // Consent records for lead_demo_01
    await client.query(
      `
      INSERT INTO app.consent_record (
        id, tenant_id, subject_type, subject_id, purpose, notice_version,
        channel, captured_by, captured_at, status, created_at
      ) VALUES (
        'con_demo_lead_01', $1, 'LEAD', 'lead_demo_01', 'CONTACT', 'V1.0',
        'EMAIL', 'usr_demo_01', now(), 'ACTIVE', now()
      )
      ON CONFLICT (id) DO NOTHING
    `,
      [tenantId],
    );
    console.log('Consent for lead_demo_01 inserted successfully');

    // Consent records for cust_demo_01
    await client.query(
      `
      INSERT INTO app.consent_record (
        id, tenant_id, subject_type, subject_id, purpose, notice_version,
        channel, captured_by, captured_at, status, created_at
      ) VALUES (
        'con_demo_cust_01', $1, 'CUSTOMER', 'cust_demo_01', 'CONTACT', 'V1.0',
        'EMAIL', 'usr_demo_01', now(), 'ACTIVE', now()
      )
      ON CONFLICT (id) DO NOTHING
    `,
      [tenantId],
    );
    console.log('Consent for cust_demo_01 inserted successfully');
  } catch (err) {
    console.error('Error inserting demo records:', err);
  } finally {
    await client.end();
  }
}

main();
