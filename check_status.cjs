// Read-only status check for one hosted application and its lender cases.
//
// The connection string is never stored in this file. Set HOSTED_CHECK_DATABASE_URL in the shell for the run, from the password
// manager or the approved secret store (docs/SECURITY_CREDENTIAL_ROTATION.md). The script prints results only, never the connection
// string, and it runs select statements only.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- a CommonJS script run with node; the package has no ESM for .cjs
const { Client } = require('pg');
// eslint-disable-next-line @typescript-eslint/no-require-imports -- as above
const { readFileSync } = require('node:fs');

const APP_ID = process.argv[2] || 'app_01M60KBHCY91ENFSQRRYPPQ9QH';
const url = process.env.HOSTED_CHECK_DATABASE_URL;

if (!url) {
  console.error(
    'HOSTED_CHECK_DATABASE_URL is not set. Export it in this shell for the run. This script does not read credentials from its source.',
  );
  process.exit(1);
}

// TLS is always verified. The pooler's CA comes from HOSTED_CHECK_CA_FILE: the certificate from the Supabase dashboard, a file on the
// operator's machine, never stored here. Without it the system trust store is used, and the connection fails if that store does not trust
// the pooler. Never set this to skip the check (docs/SECURITY_CREDENTIAL_ROTATION.md, section 3).
const caFile = process.env.HOSTED_CHECK_CA_FILE;
let ca;
if (caFile) {
  try {
    ca = readFileSync(caFile, 'utf8');
  } catch {
    console.error(
      `HOSTED_CHECK_CA_FILE is set but cannot be read (${caFile}). Point it at the pooler CA certificate file.`,
    );
    process.exit(1);
  }
}

const client = new Client({
  connectionString: url,
  ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
});

async function main() {
  await client.connect();
  try {
    const app = await client.query('select id, status, updated_at from app.loan_application where id = $1', [
      APP_ID,
    ]);
    console.log('Application:', app.rows[0]);
    const cases = await client.query(
      'select id, application_id, lender_id, status, channel, lender_reference, submitted_at, sanction_id from app.lender_case where application_id = $1',
      [APP_ID],
    );
    console.log('Lender Cases:', cases.rows);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Status check failed:', err.message);
  process.exitCode = 1;
});
