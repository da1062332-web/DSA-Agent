import pg from 'pg';
import crypto from 'node:crypto';

const CONNECTION_STRING =
  process.env.VERIFY_DATABASE_URL ??
  (() => {
    throw new Error('VERIFY_DATABASE_URL is not set. This script writes to the database it is pointed at.');
  })();
const TENANT_ID = 'ten_demo_01';
const BRANCH_ID = 'br_demo_01';
const USER_ID = 'usr_demo_01';
const USER_APPROVER = 'usr_demo_02';

function blindIndex(val: string): Buffer {
  return crypto.createHmac('sha256', 'mock_blind_index_salt_for_local_dev_only').update(val.trim().toUpperCase()).digest();
}

function encryptAes(val: string): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', crypto.scryptSync('mock_encryption_master_key_local_dev', 'salt', 32), iv);
  const encrypted = Buffer.concat([cipher.update(val, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]);
}

async function run() {
  const client = new pg.Client({ connectionString: CONNECTION_STRING });
  await client.connect();

  console.log('--- Seeding MOD-CON Demo Records for ten_demo_01 ---');

  // Ensure usr_demo_02 exists as finance approver / branch officer
  await client.query(`
    INSERT INTO app.app_user (
      id, tenant_id, idp_subject, email, mobile_e164, display_name, user_type, status, availability, primary_branch_id, lock_version, created_by, updated_by
    ) VALUES (
      $1, $2, 'a0000000-0000-0000-0000-000000000002', 'finance@dsa.com', '+919876543211', 'Finance Approver (Priya)', 'STAFF', 'ACTIVE', 'AVAILABLE', $3, 0, 'SYSTEM', 'SYSTEM'
    ) ON CONFLICT (id) DO NOTHING
  `, [USER_APPROVER, TENANT_ID, BRANCH_ID]);

  // Connectors
  const conActiveId = 'con_demo_active_01';
  const conDraftId = 'con_demo_draft_01';
  const conSuspId = 'con_demo_susp_01';

  await client.query(`
    INSERT INTO app.connector (
      id, tenant_id, connector_type, legal_name, contact_person, mobile_e164, mobile_hash, email, email_hash,
      encrypted_pan, pan_hash, pan_masked, gstin, primary_branch_id, relationship_owner_user_id, status, lock_version, created_by, updated_by
    ) VALUES 
    (
      $1, $2, 'LLP', 'Sharma Financial Consultants LLP', 'Rajesh Sharma', '+919811122233', $3, 'rajesh@sharmafin.in', $4,
      $5, $6, 'ABCDE****F', '27ABCDE1234F1Z5', $7, $8, 'ACTIVE', 0, $8, $8
    ),
    (
      $9, $2, 'INDIVIDUAL', 'Apex Wealth Advisors', 'Ananya Iyer', '+919822233344', $10, 'ananya@apexwealth.in', $11,
      $12, $13, 'BCDEF****G', NULL, $7, $8, 'DRAFT', 0, $8, $8
    ),
    (
      $14, $2, 'PVT_LTD', 'QuickCapital India Pvt Ltd', 'Vikram Malhotra', '+919833344455', $15, 'vikram@quickcapital.in', $16,
      $17, $18, 'CDEFG****H', '27CDEFG5678H1Z8', $7, $8, 'SUSPENDED', 0, $8, $8
    )
    ON CONFLICT (id) DO NOTHING
  `, [
    conActiveId, TENANT_ID,
    blindIndex('+919811122233'), blindIndex('rajesh@sharmafin.in'), encryptAes('ABCDE1234F'), blindIndex('ABCDE1234F'),
    BRANCH_ID, USER_ID,
    conDraftId,
    blindIndex('+919822233344'), blindIndex('ananya@apexwealth.in'), encryptAes('BCDEF2345G'), blindIndex('BCDEF2345G'),
    conSuspId,
    blindIndex('+919833344455'), blindIndex('vikram@quickcapital.in'), encryptAes('CDEFG3456H'), blindIndex('CDEFG3456H'),
  ]);
  console.log('Connectors seeded.');

  // Bank Accounts for Active Connector
  // 1 Active (Approved) + 1 Pending Approval
  await client.query(`
    INSERT INTO app.connector_bank_account (
      id, tenant_id, connector_id, account_holder_name, encrypted_account_number, account_hash, account_masked,
      ifsc_code, status, cooling_until, approved_by, approved_at, created_by, updated_by
    ) VALUES 
    (
      'cba_demo_approved_01', $1, $2, 'Sharma Financial Consultants LLP', $3, $4, 'XXXXXXXX6789',
      'HDFC0001234', 'ACTIVE', now() + interval '24 hours', $5, now(), $6, $5
    ),
    (
      'cba_demo_pending_01', $1, $2, 'Sharma Fin Consultants Secondary', $7, $8, 'XXXXXXXX4321',
      'ICIC0000987', 'PENDING_APPROVAL', NULL, NULL, NULL, $6, $6
    )
    ON CONFLICT (id) DO NOTHING
  `, [
    TENANT_ID, conActiveId,
    encryptAes('12345678906789'), blindIndex('12345678906789'),
    USER_APPROVER, USER_ID,
    encryptAes('98765432104321'), blindIndex('98765432104321'),
  ]);
  console.log('Bank accounts seeded.');

  // Active Agreement
  await client.query(`
    INSERT INTO app.connector_agreement (
      id, tenant_id, connector_id, version, valid_from, valid_to, permitted_products,
      share_rule_scope, evidence_ref, status, created_by, updated_by
    ) VALUES (
      'cag_demo_active_01', $1, $2, 1, now() - interval '30 days', now() + interval '335 days',
      ARRAY['HL', 'LAP', 'BL'], 'DEFAULT_STANDARD_RATE', 'upl_evidence_agreement_sharma_2026', 'ACTIVE', $3, $3
    ) ON CONFLICT (id) DO NOTHING
  `, [TENANT_ID, conActiveId, USER_ID]);
  console.log('Agreements seeded.');

  // Attribution Change Request (SOD-09) on lead_demo_01
  await client.query(`
    INSERT INTO app.attribution_change_request (
      id, tenant_id, lead_id, previous_connector_id, proposed_connector_id, reason,
      evidence_ref, status, requester_id, created_by, updated_by
    ) VALUES (
      'car_demo_req_01', $1, 'lead_demo_01', NULL, $2, 'Referral submitted at branch counter by agent',
      'upl_evidence_attribution_req_01', 'PENDING', $3, $3, $3
    ) ON CONFLICT (id) DO NOTHING
  `, [TENANT_ID, conActiveId, USER_ID]);
  console.log('Attribution change request seeded.');

  // Attribution Dispute on lead_demo_01
  await client.query(`
    INSERT INTO app.attribution_dispute (
      id, tenant_id, lead_id, claimant_connector_ids, status, created_by, updated_by
    ) VALUES (
      'cdp_demo_disp_01', $1, 'lead_demo_01', ARRAY[$2, $3], 'OPEN', $4, $4
    ) ON CONFLICT (id) DO NOTHING
  `, [TENANT_ID, conDraftId, conActiveId, USER_ID]);
  console.log('Attribution dispute seeded.');

  await client.end();
  console.log('--- Done Seeding Demo Records ---');
}

run().catch((err) => {
  console.error('Seed error:', err);
  process.exit(1);
});
