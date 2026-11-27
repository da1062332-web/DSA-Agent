// eslint-disable-next-line @typescript-eslint/no-require-imports -- a CommonJS script run with node; the package has no ESM for .cjs
const { Client } = require('pg');

const TRIM_MAP = {
  'ROLE-LOAN-OPS': [
    'customer.read',
    'verification.perform',
    'eligibility.read',
    'lender.read',
    'product.read',
    'connector.read',
    'attendance.read',
    'activity.read',
    'privacy.read',
  ],
  'ROLE-DOC-VERIFIER': [
    'customer.read',
    'lender_case.read',
    'eligibility.read',
    'lender.read',
    'product.read',
    'connector.read',
    'attendance.read',
    'activity.read',
    'privacy.read',
  ],
  'ROLE-RM': [
    'lender_case.read',
    'connector.read',
    'attendance.read',
    'lender.read',
    'product.read',
  ],
  'ROLE-SALES-EXEC': [
    'connector.read',
    'attendance.read',
    'lender.read',
    'product.read',
    'privacy.read',
  ],
  'ROLE-FINANCE-EXEC': [
    'connector.read',
    'attendance.read',
    'lender.read',
    'product.read',
  ],
  'ROLE-COMMISSION-APPROVER': [
    'connector.read',
    'attendance.read',
    'lender.read',
    'product.read',
  ],
  'ROLE-RULE-AUTHOR': [
    'attendance.read',
    'lender.read',
    'product.read',
  ],
  'ROLE-RULE-APPROVER': [
    'attendance.read',
    'lender.read',
    'product.read',
  ],
  'ROLE-COMPLIANCE': [
    'connector.read',
    'attendance.read',
    'eligibility.read',
    'lender_case.read',
    'lender.read',
    'product.read',
  ],
  'ROLE-TEAM-MGR': [
    'connector.read',
    'lender_case.read',
    'lender.read',
    'product.read',
    'privacy.read',
  ],
};

async function applyTrim() {
  // The target comes from the environment only (TEST-SECRETS-01): no database URL or password is written in this file.
  const connectionString = process.env.VERIFY_DATABASE_URL;
  if (!connectionString) {
    console.error('Set VERIFY_DATABASE_URL to the database to trim. Nothing was changed.');
    process.exit(1);
  }
  const client = new Client({ connectionString });
  await client.connect();

  console.log('Connected to database. Starting permission trim for non-platform tenants...');

  for (const [roleCode, permsToRemove] of Object.entries(TRIM_MAP)) {
    const res = await client.query(
      `
      DELETE FROM app.role_permission
      WHERE role_id IN (
        SELECT r.id FROM app.role r
        JOIN app.tenant t ON r.tenant_id = t.id
        WHERE r.code = $1 AND t.tenant_type <> 'PLATFORM'
      )
      AND permission_code = ANY($2::text[])
      RETURNING tenant_id, role_id, permission_code;
    `,
      [roleCode, permsToRemove],
    );
    console.log(`Trimmed ${res.rowCount} permissions from ${roleCode}`);
  }

  console.log('\nTrim completed successfully.');
  await client.end();
}

applyTrim().catch(console.error);
