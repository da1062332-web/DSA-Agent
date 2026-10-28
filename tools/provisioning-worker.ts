// Provisioning worker — owner: platform (API-USR-001; Architecture B, migration 0093). The only process that holds the Supabase
// service-role key and the only writer of app_metadata.tenant_id for invited staff (ADR-SB-02). The HTTP API records invitations; this
// worker sends them: it creates or reuses the Auth account, writes the tenant claim, binds the user and asks Supabase for the e-mail.
//
//   npm run provisioning:worker -w @dsa/tools            # runs until stopped (Ctrl+C)
//   npm run provisioning:worker -w @dsa/tools -- --once  # one pass, then exits (for a scheduler)
//
// Configuration comes from apps/api/.env.provisioning (never committed): PROVISIONING_WORKER_ENABLED=true, DATABASE_URL (the dsa_api
// role), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INVITE_REDIRECT_URL. It prints invitation ids, tenant ids and short codes only:
// never an e-mail address, a link, a token or the key.
import { parseArgs } from 'node:util';
import {
  createProvisioningRuntime,
  loadProvisioningConfig,
  runInvitationDeliveries,
  runSignInErasures,
  type DeliveryOutcome,
} from '@dsa/api/provisioning';

/** Replaces the key, wherever it appears, before anything is printed. */
export function redact(text: string, secrets: string[]): string {
  return secrets.filter((s) => s.length >= 8).reduce((out, s) => out.split(s).join('[redacted]'), text);
}

export function describeOutcome(o: DeliveryOutcome): string {
  return [
    o.result,
    `invitation=${o.invitationId}`,
    `tenant=${o.tenantId}`,
    o.failure && `failure=${o.failure}`,
    o.provider && `supabase=${o.provider.replace(/ /g, ':')}`,
    o.authAccount && `account=${o.authAccount}`,
  ]
    .filter(Boolean)
    .join(' ');
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { once: { type: 'boolean', default: false } } });
  const config = loadProvisioningConfig();
  const secrets = [config.SUPABASE_SERVICE_ROLE_KEY];
  const log = (line: string) => console.log(`${new Date().toISOString()} ${redact(line, secrets)}`);
  const { deps, close } = createProvisioningRuntime(config);
  deps.onError = (invitationId, err) =>
    log(`ERROR invitation=${invitationId} ${err instanceof Error ? err.message : 'unknown error'}`);

  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => (stopping = true));
  log(`provisioning worker started (worker=${deps.workerId})`);
  try {
    do {
      try {
        for (const outcome of await runInvitationDeliveries(deps)) log(describeOutcome(outcome));
        // Deleted users: their Supabase sign-in account is deleted here (POST /v1/users/:id/erasure).
        for (const o of await runSignInErasures(deps))
          log(`SIGN_IN_${o.result} user=${o.userId} tenant=${o.tenantId}`);
      } catch (err) {
        log(`ERROR pass failed: ${err instanceof Error ? err.message : 'unknown error'}`);
      }
      if (values.once) break;
      await new Promise((r) => setTimeout(r, config.PROVISIONING_POLL_MS));
    } while (!stopping);
  } finally {
    await close();
    log('provisioning worker stopped');
  }
}

// Run only when executed directly (tests import the helpers).
if (process.argv[1] && /provisioning-worker\.[cm]?[jt]s$/.test(process.argv[1].replace(/\\/g, '/'))) {
  main().catch((err: unknown) => {
    console.error(`\nFAILED: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
