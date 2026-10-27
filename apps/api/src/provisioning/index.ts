// Provisioning worker package entry (owner: platform; Architecture B), exported as "@dsa/api/provisioning". Imported by
// tools/provisioning-worker.ts and tools/identity-binding.ts only. The HTTP API (server.ts, app.ts, modules/) never imports it, which
// apps/api/test/service-key-boundary.spec.ts checks.
import { createAuditPort, createIdGenerator } from '@dsa/kernel';
import { hostname } from 'node:os';
import { createDb } from '../kernel-min/db';
import { createTxRunner } from '../kernel-min/tx-runner';
import { createSupabaseAuthAdmin } from './auth-admin';
import type { ProvisioningConfig } from './config';
import type { InvitationDeliveryDeps } from './invitation-delivery';

export * from './auth-admin';
export * from './config';
export * from './invitation-delivery';
export * from './sign-in-erasure';

/** Builds the worker's dependencies from its configuration. Call `close()` to release the database pool. */
export function createProvisioningRuntime(config: ProvisioningConfig): {
  deps: InvitationDeliveryDeps;
  close: () => Promise<void>;
} {
  const db = createDb(config.DATABASE_URL, { poolMax: 2 });
  const deps: InvitationDeliveryDeps = {
    txRunner: createTxRunner(db),
    audit: createAuditPort(createIdGenerator()),
    authAdmin: createSupabaseAuthAdmin({
      supabaseUrl: config.SUPABASE_URL,
      serviceRoleKey: config.SUPABASE_SERVICE_ROLE_KEY,
    }),
    redirectTo: config.INVITE_REDIRECT_URL,
    workerId: config.PROVISIONING_WORKER_ID ?? `${hostname()}:${process.pid}`.slice(0, 64),
  };
  return { deps, close: () => db.destroy() };
}
