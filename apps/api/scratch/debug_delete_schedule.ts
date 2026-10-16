
const API_BASE = 'http://localhost:3000';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? (() => { throw new Error('VITE_SUPABASE_URL is not set. This script talks to a real Supabase project: set it explicitly, there is no built-in default.'); })();
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? (() => { throw new Error('VITE_SUPABASE_PUBLISHABLE_KEY is not set. This script talks to a real Supabase project: set it explicitly, there is no built-in default.'); })();

async function main() {
  const loginRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'apikey': SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@dsa.com', password: 'admin@123' }),
  });
  const { access_token } = await loginRes.json();

  // Create schedule
  const createRes = await fetch(`${API_BASE}/v1/report-schedules`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reportCode: 'RPT_LEAD_PIPELINE',
      frequency: 'WEEKLY',
      recipientEmails: ['analyst@dsa.com'],
      recipientScope: 'TENANT',
      filters: {},
    }),
  });
  const created = await createRes.json();
  console.log('Created schedule:', created);

  // Try Delete
  const delRes = await fetch(`${API_BASE}/v1/report-schedules/${created.id}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${access_token}` },
  });
  console.log('Delete status:', delRes.status);
  const delBody = await delRes.text();
  console.log('Delete body:', delBody);
}

main().catch(console.error);
