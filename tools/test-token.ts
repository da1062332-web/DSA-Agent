// Test-token minter — owner: Dev 1 — TASK-102.
// Prints a Supabase-shaped access token signed with the LOCAL SUPABASE_JWT_SECRET, for integration tests and the
// E2E harness (Dev 4). Refuses to run unless SUPABASE_URL points at the local stack (Contracts §7).
//
//   npm run test-token -w @dsa/tools -- --sub <auth-user-uuid> --tenant ten_… [--aal aal2] [--ttl 3600]
//
// --sub is the idp_subject of an ACTIVE app_user in that tenant (provision-tenant prints them).
// --aal aal2 adds a fresh TOTP amr entry, which satisfies step-up for 900 s.
import { parseArgs } from 'node:util';
import { mintTestToken } from '@dsa/kernel/testing';

const { values } = parseArgs({
  options: {
    sub: { type: 'string' },
    tenant: { type: 'string' },
    aal: { type: 'string', default: 'aal1' },
    ttl: { type: 'string', default: '3600' },
  },
});

try {
  const { SUPABASE_URL, SUPABASE_JWT_SECRET } = process.env;
  if (!SUPABASE_URL || !SUPABASE_JWT_SECRET)
    throw new Error('set SUPABASE_URL and SUPABASE_JWT_SECRET in .env');
  if (!values.sub || !values.tenant) throw new Error('--sub and --tenant are required');
  if (values.aal !== 'aal1' && values.aal !== 'aal2') throw new Error('--aal must be aal1 or aal2');

  const token = await mintTestToken({
    supabaseUrl: SUPABASE_URL,
    jwtSecret: SUPABASE_JWT_SECRET,
    sub: values.sub,
    tenantId: values.tenant,
    aal: values.aal,
    ttlSeconds: Number(values.ttl),
  });
  process.stdout.write(`${token}\n`);
} catch (err) {
  console.error(`test-token: ${(err as Error).message}`);
  process.exit(1);
}
