/**
 * tools/feed-notion-real-data.ts
 *
 * Feeds the real authoritative demo dataset from the Notion Specification:
 * "00 — Setup, accounts and shared demo data" and "End-to-end golden path (all roles)"
 * into the PostgreSQL database for tenant `demo-alpha`.
 *
 * Dataset injected:
 * 1. Lender: Demo Bank (Type: BANK, Status: ACTIVE)
 * 2. Loan Products: Personal Loan (PL), Home Loan (HL), Business Loan (BL)
 * 3. Shared Leads:
 *    - Lead A: Kavya Deshmukh (PL, ₹3,00,000, MUM01, Walk-in / Branch booth)
 *    - Lead D: Arjun Mehta (BL, ₹12,00,000, PUN01, Referral)
 *    - Lead E: Neha Iyer (HL, ₹45,00,000, MUM01, Website)
 * 4. DPDP Statutory Consent Records (Loan processing, Contact, Notice v1.0, In person)
 * 5. Rule Set: TST Demo lead routing
 * 6. Supabase Auth passwords synchronized for all demo users to `DemoPassword123!`
 */
import crypto from 'node:crypto';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

const { Client } = pg;

const DATABASE_URL =
  process.env.VERIFY_DATABASE_URL ||
  process.env.DATABASE_URL;

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mlpkwwhnagxzinaohdxg.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const sha256Bytes = (val: string): Buffer => crypto.createHash('sha256').update(val).digest();

export async function feedRealData() {
  console.log('--- Feeding Real Data into DB (Notion Baseline) ---');

  if (!DATABASE_URL) {
    throw new Error('Missing DATABASE_URL or VERIFY_DATABASE_URL in environment.');
  }
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY in environment.');
  }

  // 1. Sync Supabase Auth Passwords for demo-alpha
  console.log('1. Syncing Supabase Auth passwords for demo-alpha users...');
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const demoEmails = [
    'admin@alpha.com',
    'owner@alpha.com',
    'branchmgr@alpha.com',
    'teammgr@alpha.com',
    'rm1@alpha.com',
    'rm2@alpha.com',
    'sales1@alpha.com',
    'loanops@alpha.com',
    'compliance@alpha.com',
    'ruleauthor@alpha.com',
    'ruleapprover@alpha.com'
  ];

  const { data: userList, error: authListErr } = await supabase.auth.admin.listUsers({ page: 1, perPage: 100 });
  if (authListErr) {
    console.warn('Warning: Could not list auth users:', authListErr.message);
  } else {
    for (const email of demoEmails) {
      const user = userList.users.find(u => u.email?.toLowerCase() === email.toLowerCase());
      if (user) {
        await supabase.auth.admin.updateUserById(user.id, { password: 'DemoPassword123!' });
      }
    }
    console.log('Auth passwords synchronized to "DemoPassword123!" for demo-alpha users.');
  }

  // 2. Connect to Database directly
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  try {
    const tenantSlug = 'demo-alpha';
    const tenantRes = await client.query(`SELECT id FROM app.tenant WHERE slug = $1`, [tenantSlug]);
    if (tenantRes.rows.length === 0) {
      throw new Error(`Tenant "${tenantSlug}" does not exist in app.tenant.`);
    }
    const tenantId = tenantRes.rows[0].id;
    console.log(`Found tenant "${tenantSlug}" -> ID: ${tenantId}`);

    // Resolve branch IDs
    const branches = await client.query(`SELECT id, code FROM app.branch WHERE tenant_id = $1`, [tenantId]);
    const branchMap = new Map<string, string>();
    for (const b of branches.rows) branchMap.set(b.code, b.id);

    const mum01Id = branchMap.get('MUM01');
    const pun01Id = branchMap.get('PUN01');
    if (!mum01Id) throw new Error('Branch MUM01 missing for demo-alpha');

    // Resolve user IDs
    const users = await client.query(`SELECT id, email FROM app.app_user WHERE tenant_id = $1`, [tenantId]);
    const userMap = new Map<string, string>();
    for (const u of users.rows) userMap.set(u.email?.toLowerCase(), u.id);

    const sales1Id = userMap.get('sales1@alpha.com');
    const rm1Id = userMap.get('rm1@alpha.com');
    const ownerId = userMap.get('owner@alpha.com');
    const adminId = userMap.get('admin@alpha.com');
    const rmpuneId = userMap.get('rmpune@alpha.com') || sales1Id;

    // Resolve queue IDs
    const queues = await client.query(`SELECT id, code FROM app.work_queue WHERE tenant_id = $1`, [tenantId]);
    const queueMap = new Map<string, string>();
    for (const q of queues.rows) queueMap.set(q.code, q.id);
    const mumIntakeQueue = queueMap.get('MUM01-INTAKE');
    const punIntakeQueue = queueMap.get('PUN01-INTAKE');

    // 3. Upsert "Demo Bank" Lender
    console.log('2. Upserting Lender "Demo Bank"...');
    const demoBankId = 'lnd_demo_bank_alpha_01';
    await client.query(`
      INSERT INTO app.lender (
        id, tenant_id, name, lender_type, regulator_ref, status, lock_version, created_by, updated_by
      ) VALUES ($1, $2, $3, $4, $5, $6, 0, 'SYSTEM', 'SYSTEM')
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        lender_type = EXCLUDED.lender_type,
        status = EXCLUDED.status;
    `, [demoBankId, tenantId, 'Demo Bank', 'BANK', 'RBI-DEMO-001', 'ACTIVE']);

    // 4. Upsert Loan Products (PL, BL, HL)
    console.log('3. Upserting Loan Products (PL, BL, HL)...');
    const products = [
      { id: 'prd_demo_bank_pl_01', name: 'Demo Personal Loan', cat: 'PL', secured: false },
      { id: 'prd_demo_bank_bl_01', name: 'Demo Business Loan', cat: 'BL', secured: false },
      { id: 'prd_demo_bank_hl_01', name: 'Demo Home Loan', cat: 'HL', secured: true },
    ];
    for (const p of products) {
      await client.query(`
        INSERT INTO app.loan_product (
          id, tenant_id, lender_id, name, category, applicant_types, secured, status, lock_version, created_by, updated_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE', 0, 'SYSTEM', 'SYSTEM')
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          category = EXCLUDED.category,
          status = EXCLUDED.status;
      `, [p.id, tenantId, demoBankId, p.name, p.cat, ['SALARIED', 'INDIVIDUAL', 'SELF_EMPLOYED_PROFESSIONAL'], p.secured]);
    }

    // 5. Upsert Shared Demo Leads
    console.log('4. Upserting Notion Shared Demo Leads...');

    // Lead A: Kavya Deshmukh
    const leadAId = 'lead_demo_kavya_deshmukh_01';
    await client.query(`
      INSERT INTO app.lead (
        id, tenant_id, branch_id, full_name, mobile_e164, mobile_hash, email, email_hash,
        product_category, indicative_amount, amount_currency, pincode, source, sub_source,
        state, priority, owner_user_id, duplicate_flag, contact_attempts, lock_version,
        created_by, updated_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'INR', $11, $12, $13,
        $14, $15, $16, 'NONE', 0, 0, 'SYSTEM', 'SYSTEM'
      )
      ON CONFLICT (id) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        state = EXCLUDED.state,
        owner_user_id = EXCLUDED.owner_user_id;
    `, [
      leadAId,
      tenantId,
      mum01Id,
      'Kavya Deshmukh',
      '+919876501234',
      sha256Bytes('+919876501234'),
      'kavya.deshmukh@example.com',
      sha256Bytes('kavya.deshmukh@example.com'),
      'PL',
      300000.00,
      '400008',
      'WALK_IN',
      'Branch booth',
      'NEW',
      'HIGH',
      sales1Id
    ]);

    // Lead A Consents (Loan processing & Contact)
    await client.query(`
      INSERT INTO app.consent_record (
        id, tenant_id, subject_type, subject_id, purpose, notice_version, channel,
        captured_by, captured_at, status
      ) VALUES
        ('cnst_demo_kavya_proc_01', $1, 'LEAD', $2, 'LOAN_PROCESSING', 'V1.0', 'IN_PERSON', $3, NOW(), 'ACTIVE'),
        ('cnst_demo_kavya_cont_01', $1, 'LEAD', $2, 'CONTACT', 'V1.0', 'IN_PERSON', $3, NOW(), 'ACTIVE')
      ON CONFLICT (id) DO NOTHING;
    `, [tenantId, leadAId, sales1Id || adminId]);

    // Lead D: Arjun Mehta (Pune Camp)
    if (pun01Id) {
      await client.query(`
        INSERT INTO app.lead (
          id, tenant_id, branch_id, full_name, mobile_e164, mobile_hash, email, email_hash,
          product_category, indicative_amount, amount_currency, pincode, source,
          state, priority, owner_user_id, duplicate_flag, contact_attempts, lock_version, created_by, updated_by
        ) VALUES (
          'lead_demo_arjun_mehta_01', $1, $2, 'Arjun Mehta', '+919876509876', $3,
          'arjun.mehta@example.com', $4, 'BL', 1200000.00, 'INR', '411001', 'REFERRAL',
          'NEW', 'MEDIUM', $5, 'NONE', 0, 0, 'SYSTEM', 'SYSTEM'
        )
        ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, owner_user_id = EXCLUDED.owner_user_id;
      `, [
        tenantId,
        pun01Id,
        sha256Bytes('+919876509876'),
        sha256Bytes('arjun.mehta@example.com'),
        rmpuneId
      ]);
    }

    // Lead E: Neha Iyer (Mumbai Central)
    await client.query(`
      INSERT INTO app.lead (
        id, tenant_id, branch_id, full_name, mobile_e164, mobile_hash, email, email_hash,
        product_category, indicative_amount, amount_currency, pincode, source,
        state, priority, owner_user_id, duplicate_flag, contact_attempts, lock_version, created_by, updated_by
      ) VALUES (
        'lead_demo_neha_iyer_01', $1, $2, 'Neha Iyer', '+919876511111', $3,
        'neha.iyer@example.com', $4, 'HL', 4500000.00, 'INR', '400008', 'WEBSITE',
        'NEW', 'HIGH', $5, 'NONE', 0, 0, 'SYSTEM', 'SYSTEM'
      )
      ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, owner_user_id = EXCLUDED.owner_user_id;
    `, [
      tenantId,
      mum01Id,
      sha256Bytes('+919876511111'),
      sha256Bytes('neha.iyer@example.com'),
      sales1Id
    ]);

    console.log('✅ Real data successfully fed into DB for demo-alpha!');
  } finally {
    await client.end();
  }
}

// Allow direct CLI execution:
if (process.argv[1] && import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  feedRealData()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Failed to feed real data:', err);
      process.exit(1);
    });
}
