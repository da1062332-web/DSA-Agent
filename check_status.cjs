// Read-only status check for one hosted application and its lender cases.
//
// The connection string is never stored in this file. Set HOSTED_CHECK_DATABASE_URL in the shell for the run, from the password
// manager or the approved secret store (docs/SECURITY_CREDENTIAL_ROTATION.md). The script prints results only, never the connection
// string, and it runs select statements only.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- a CommonJS script run with node; the package has no ESM for .cjs
const { Client } = require('pg');

const APP_ID = process.argv[2] || 'app_01M60KBHCY91ENFSQRRYPPQ9QH';
const url = process.env.HOSTED_CHECK_DATABASE_URL;

if (!url) {
  console.error(
    'HOSTED_CHECK_DATABASE_URL is not set. Export it in this shell for the run. This script does not read credentials from its source.',
  );
  process.exit(1);
}

const client = new Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
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
