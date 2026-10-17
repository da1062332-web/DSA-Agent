import { createDb } from '../src/kernel-min/db';

const API_BASE = 'http://localhost:3000';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://mlpkwwhnagxzinaohdxg.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1scGt3d2huYWd4emluYW9oZHhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE2MDc3OTYsImV4cCI6MjEwNzE4Mzc5Nn0.yDzb9PBSPedoRJi1CSJswNMSJw8rJHwBSAPlB90_hzI';

async function main() {
  const loginRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@dsa.com', password: 'admin@123' }),
  });
  const { access_token } = await loginRes.json();

  // Create schedule
  const createRes = await fetch(`${API_BASE}/v1/report-schedules`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
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
    headers: { Authorization: `Bearer ${access_token}` },
  });
  console.log('Delete status:', delRes.status);
  const delBody = await delRes.text();
  console.log('Delete body:', delBody);
}

main().catch(console.error);
