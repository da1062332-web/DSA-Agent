// Identity binding (D5) — owner: platform. Before the API stops matching tokens by e-mail (IDENTITY_EMAIL_FALLBACK=false), every
// application user must be bound by app_user.idp_subject to the immutable id of its own Supabase Auth account, in its own tenant.
//
//   npm run identity:inventory -w @dsa/tools                                     # Phase 1: read-only report
//   npm run identity:bind -w @dsa/tools                                          # Phase 2: dry run, shows what would be bound
//   npm run identity:bind -w @dsa/tools -- --apply --project-ref <ref> --expect <n>  # Phase 2: binds exactly the n rows shown
//
// The inventory reads the database in read-only transactions and lists Auth accounts; it changes nothing anywhere. Binding writes only
// rows classified BINDABLE: the user has no valid binding, exactly one Auth account has the user's e-mail address, that account carries
// the user's own tenant claim, and no other user is bound to it. Everything else (no account, another tenant's account, an account
// without a claim, an account bound to someone else, a binding that points at the wrong account) is reported for a person to resolve.
// Binding re-checks every row at the moment of writing and refuses if the count differs from --expect.
//
// Needs (apps/api/.env.provisioning, never committed): DATABASE_URL (the dsa_api role), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Prints user ids, tenant ids, categories and masked e-mail addresses: never a full address, a token or the key.
import { parseArgs } from 'node:util';
import { PLATFORM_TENANT_ID } from '@dsa/contracts';
import { createSupabaseAuthAdmin, type AuthAccount } from '@dsa/api/provisioning';
import pg from 'pg';
import { ulid } from 'ulid';

const ACTOR = 'SYSTEM:identity-binding';
const FORBIDDEN_DB_USERS = /^(postgres|supabase_admin|service_role)(\..*)?$/;
const UNBOUND_PREFIX = 'invite:';

export interface AppUserRecord {
  id: string;
  tenantId: string;
  email: string;
  idpSubject: string;
  status: string;
}

export type BindingCategory =
  /** idp_subject is an Auth account with the user's e-mail address and tenant claim. Nothing to do. */
  | 'BOUND'
  /** A new invitation: the provisioning worker binds it when it sends the e-mail. Nothing to do. */
  | 'PENDING_INVITATION'
  /** A deleted account (its details erased). Nothing to bind. */
  | 'ERASED'
  /** Not bound; exactly one account fits. Phase 2 binds it. */
  | 'BINDABLE'
  /** idp_subject names an Auth account whose e-mail address or tenant claim differs. Manual. */
  | 'BOUND_MISMATCH'
  /** Not bound and no Auth account has this e-mail address. Manual (invite the person again). */
  | 'NO_ACCOUNT'
  /** The account with this e-mail address belongs to another tenant. Manual. */
  | 'CROSS_TENANT'
  /** The account with this e-mail address has no tenant claim. Manual: never adopted automatically. */
  | 'NO_CLAIM'
  /** The account fits, but another user is already bound to it. Manual. */
  | 'ACCOUNT_TAKEN'
  /** More than one account has this e-mail address. Manual. */
  | 'AMBIGUOUS';

export interface Classified {
  user: AppUserRecord;
  category: BindingCategory;
  /** For BINDABLE: the account id to bind to. */
  proposedSubject?: string;
}

export const MANUAL: ReadonlySet<BindingCategory> = new Set([
  'BOUND_MISMATCH',
  'NO_ACCOUNT',
  'CROSS_TENANT',
  'NO_CLAIM',
  'ACCOUNT_TAKEN',
  'AMBIGUOUS',
]);

export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 2)}***@${domain}`;
}

/** Pure: decides each user's category from the users and the Auth accounts. */
export function classifyBindings(users: AppUserRecord[], accounts: AuthAccount[]): Classified[] {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const byEmail = new Map<string, AuthAccount[]>();
  for (const a of accounts) {
    if (!a.email) continue;
    byEmail.set(a.email, [...(byEmail.get(a.email) ?? []), a]);
  }
  const ownerOfSubject = new Map(users.map((u) => [u.idpSubject, u.id]));

  return users.map((user): Classified => {
    const email = user.email.toLowerCase();
    const bound = byId.get(user.idpSubject);
    if (bound) {
      const fits = bound.email === email && bound.tenantId === user.tenantId;
      return { user, category: fits ? 'BOUND' : 'BOUND_MISMATCH' };
    }
    if (email.endsWith('@erased.invalid')) return { user, category: 'ERASED' };
    if (user.idpSubject.startsWith(UNBOUND_PREFIX) && user.status === 'INVITED') {
      return { user, category: 'PENDING_INVITATION' };
    }
    const matches = byEmail.get(email) ?? [];
    if (matches.length === 0) return { user, category: 'NO_ACCOUNT' };
    if (matches.length > 1) return { user, category: 'AMBIGUOUS' };
    const account = matches[0]!;
    if (account.tenantId === null) return { user, category: 'NO_CLAIM' };
    if (account.tenantId !== user.tenantId) return { user, category: 'CROSS_TENANT' };
    const owner = ownerOfSubject.get(account.id);
    if (owner !== undefined && owner !== user.id) return { user, category: 'ACCOUNT_TAKEN' };
    return { user, category: 'BINDABLE', proposedSubject: account.id };
  });
}

export function summarize(rows: Classified[]): Record<BindingCategory, number> {
  const counts = {
    BOUND: 0,
    PENDING_INVITATION: 0,
    ERASED: 0,
    BINDABLE: 0,
    BOUND_MISMATCH: 0,
    NO_ACCOUNT: 0,
    CROSS_TENANT: 0,
    NO_CLAIM: 0,
    ACCOUNT_TAKEN: 0,
    AMBIGUOUS: 0,
  } satisfies Record<BindingCategory, number>;
  for (const r of rows) counts[r.category]++;
  return counts;
}

/** Runs `fn` in a transaction scoped to `tenantId`, so row-level security applies to the tool as it does to the API. */
async function inTenantTx<T>(
  db: pg.Client,
  tenantId: string,
  readOnly: boolean,
  fn: () => Promise<T>,
): Promise<T> {
  await db.query(readOnly ? 'BEGIN TRANSACTION READ ONLY' : 'BEGIN');
  try {
    await db.query(`select set_config('app.tenant_id', $1, true)`, [tenantId]);
    await db.query(`select set_config('search_path', 'app, extensions, public', true)`);
    const out = await fn();
    await db.query('COMMIT');
    return out;
  } catch (err) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw err;
  }
}

/** Reads every application user, tenant by tenant, in read-only transactions. */
export async function readAppUsers(db: pg.Client): Promise<AppUserRecord[]> {
  const tenants = await inTenantTx(db, PLATFORM_TENANT_ID, true, async () =>
    (await db.query<{ id: string }>(`select id from tenant order by id`)).rows.map((r) => r.id),
  );
  const users: AppUserRecord[] = [];
  for (const tenantId of tenants) {
    const rows = await inTenantTx(
      db,
      tenantId,
      true,
      async () =>
        (
          await db.query<{
            id: string;
            tenant_id: string;
            email: string;
            idp_subject: string;
            status: string;
          }>(`select id, tenant_id, email::text as email, idp_subject, status from app_user order by id`)
        ).rows,
    );
    users.push(
      ...rows.map((r) => ({
        id: r.id,
        tenantId: r.tenant_id,
        email: r.email,
        idpSubject: r.idp_subject,
        status: r.status,
      })),
    );
  }
  return users;
}

export interface BindResult {
  /** Users bound in tenants whose transaction committed. */
  bound: string[];
  /** Why the run stopped: a count that differs from `expect` (nothing written), or a row that changed (its tenant rolled back). */
  refused?: string;
}

/**
 * Binds the BINDABLE rows, one transaction per tenant: each row is written only if its subject and e-mail address are still the ones
 * that were classified, and one audit record is written per binding. A changed row rolls back its tenant and stops the run. Refuses
 * before writing anything when the number of BINDABLE rows differs from `expect`.
 */
export async function applyBindings(db: pg.Client, rows: Classified[], expect: number): Promise<BindResult> {
  const bindable = rows.filter((r) => r.category === 'BINDABLE' && r.proposedSubject);
  if (bindable.length !== expect) {
    return {
      bound: [],
      refused: `${bindable.length} rows are bindable now, not the ${expect} expected. Run the dry run again.`,
    };
  }
  const byTenant = new Map<string, Classified[]>();
  for (const r of bindable) byTenant.set(r.user.tenantId, [...(byTenant.get(r.user.tenantId) ?? []), r]);
  const bound: string[] = [];
  for (const [tenantId, list] of byTenant) {
    try {
      bound.push(...(await bindTenant(db, tenantId, list)));
    } catch (err) {
      return { bound, refused: err instanceof Error ? err.message : String(err) };
    }
  }
  return { bound };
}

async function bindTenant(db: pg.Client, tenantId: string, list: Classified[]): Promise<string[]> {
  return inTenantTx(db, tenantId, false, async () => {
    const done: string[] = [];
    for (const r of list) {
      const updated = await db.query(
        `update app_user set idp_subject = $1, updated_by = $2
            where id = $3 and tenant_id = $4 and idp_subject = $5 and lower(email::text) = $6`,
        [r.proposedSubject, ACTOR, r.user.id, tenantId, r.user.idpSubject, r.user.email.toLowerCase()],
      );
      if (updated.rowCount !== 1)
        throw new Error(
          `user ${r.user.id} changed since it was checked; nothing was written in tenant ${tenantId}`,
        );
      await db.query(
        `insert into audit_event (id, tenant_id, actor_type, actor_id, action, entity_type, entity_id, before, after,
                                    external_side_effect, correlation_id)
           values ($1, $2, 'SERVICE', $3, 'user.identity_bound', 'USER', $4, $5::jsonb, $6::jsonb, false, $7)`,
        [
          `aud_${ulid()}`,
          tenantId,
          ACTOR,
          r.user.id,
          JSON.stringify({ idpSubject: r.user.idpSubject }),
          JSON.stringify({ idpSubject: r.proposedSubject }),
          `identity_binding_${ulid()}`,
        ],
      );
      done.push(r.user.id);
    }
    return done;
  });
}

function printReport(rows: Classified[]): void {
  console.log(JSON.stringify(summarize(rows), null, 2));
  for (const r of rows.filter((x) => !['BOUND', 'PENDING_INVITATION', 'ERASED'].includes(x.category))) {
    console.log(
      [
        r.category.padEnd(18),
        r.user.id,
        r.user.tenantId,
        r.user.status.padEnd(11),
        maskEmail(r.user.email),
      ].join('  '),
    );
  }
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      apply: { type: 'boolean', default: false },
      'project-ref': { type: 'string' },
      expect: { type: 'string' },
    },
  });
  const mode = positionals[0];
  if (mode !== 'inventory' && mode !== 'bind')
    throw new Error('Usage: identity-binding.ts inventory | bind [--apply ...]');
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !DATABASE_URL) {
    throw new Error(
      'SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and DATABASE_URL must be set (apps/api/.env.provisioning).',
    );
  }
  if (FORBIDDEN_DB_USERS.test(decodeURIComponent(new URL(DATABASE_URL).username))) {
    throw new Error('DATABASE_URL must connect as dsa_api, never as postgres or service_role.');
  }
  if (values.apply) {
    if (mode !== 'bind') throw new Error('--apply is for bind only.');
    if (new URL(SUPABASE_URL).hostname.split('.')[0] !== values['project-ref']) {
      throw new Error('--project-ref must match the project in SUPABASE_URL. Nothing was changed.');
    }
    if (!values.expect || !/^\d+$/.test(values.expect))
      throw new Error('--expect <number of rows from the dry run> is required.');
  }

  const auth = createSupabaseAuthAdmin({
    supabaseUrl: SUPABASE_URL,
    serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
  });
  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  try {
    console.log(
      `project ${new URL(SUPABASE_URL).hostname.split('.')[0]}, database host ${new URL(DATABASE_URL).hostname}`,
    );
    const rows = classifyBindings(await readAppUsers(db), await auth.listAccounts());
    printReport(rows);
    if (mode === 'inventory') {
      console.log('\nRead-only: nothing was changed.');
      return;
    }
    const bindable = rows.filter((r) => r.category === 'BINDABLE').length;
    if (!values.apply) {
      console.log(
        `\nDry run: ${bindable} row(s) would be bound. To bind them: --apply --project-ref <ref> --expect ${bindable}`,
      );
      return;
    }
    const result = await applyBindings(db, rows, Number(values.expect));
    if (result.refused) throw new Error(result.refused);
    console.log(`\nBound ${result.bound.length} user(s): ${result.bound.join(', ')}`);
  } finally {
    await db.end();
  }
}

if (process.argv[1] && /identity-binding\.[cm]?[jt]s$/.test(process.argv[1].replace(/\\/g, '/'))) {
  main().catch((err: unknown) => {
    console.error(`\nFAILED: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
