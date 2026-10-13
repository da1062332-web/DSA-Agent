// Tenant provisioning CLI — owner: Dev 1 — TASK-103.
// Creates the two demo tenants with identical natural keys (Contracts §13 isolation scenario) from
// seeds/demo/platform.ts: tenant, organisation, branches, users, team, roles, role grants and queues.
// For each user it creates the Supabase Auth user through the Admin API with app_metadata.tenant_id
// (SUPABASE_SERVICE_ROLE_KEY, tools only) and the matching app_user row. If anything fails, the Auth users
// created by this run are deleted again and the database transaction rolls back (Migration Plan §0).
//
// Runs as a SERVICE principal (SYSTEM:platform) over DATABASE_URL (dsa_api), with app.tenant_id set per
// transaction, so RLS applies to the CLI too. RulesSeederPort: PORT_RULES_SEEDER=noop until Dev 2 switches it
// to real at INT-005, so no rules are seeded yet.
//
//   npm run provision:tenant -w @dsa/tools                 # both demo tenants
//   npm run provision:tenant -w @dsa/tools -- --tenant demo-alpha
//
// Set DEMO_USER_PASSWORD in .env to choose the demo password; otherwise one is generated and printed.
// Re-running against an already provisioned database fails (emails exist); run `npm run db:reset` first.
import crypto from 'node:crypto';
import { parseArgs } from 'node:util';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import pg from 'pg';
import { ulid } from 'ulid';
import {
  BRANCHES,
  QUEUE_MEMBERS,
  QUEUES,
  ROLES,
  TEAM,
  TENANTS,
  USERS,
  emailFor,
  type TenantSeed,
} from '../seeds/demo/platform';

const ACTOR = 'SYSTEM:platform';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const id = (prefix: string) => `${prefix}_${ulid()}`;

interface ProvisionedUser {
  email: string;
  userId: string;
  idpSubject: string;
}

async function createAuthUsers(
  admin: SupabaseClient,
  tenant: TenantSeed,
  tenantId: string,
  password: string,
  created: string[],
): Promise<Map<string, ProvisionedUser>> {
  const users = new Map<string, ProvisionedUser>();
  for (const u of USERS) {
    const email = emailFor(tenant, u.handle);
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { tenant_id: tenantId },
      user_metadata: { display_name: u.displayName },
    });
    if (error || !data.user) throw new Error(`Auth user ${email}: ${error?.message ?? 'not created'}`);
    created.push(data.user.id);
    users.set(u.handle, { email, userId: id('usr'), idpSubject: data.user.id });
  }
  return users;
}

async function insertTenant(
  db: pg.Client,
  tenant: TenantSeed,
  tenantId: string,
  users: Map<string, ProvisionedUser>,
): Promise<void> {
  const q = (text: string, values: unknown[]) => db.query(text, values);
  const user = (handle: string) => {
    const u = users.get(handle);
    if (!u) throw new Error(`seed references unknown user ${handle}`);
    return u.userId;
  };

  await q('BEGIN', []);
  try {
    // Transaction-local tenant (never session-level SET): RLS WITH CHECK accepts only this tenant's rows.
    await q(`select set_config('app.tenant_id', $1, true)`, [tenantId]);

    await q(
      `insert into tenant (id, slug, legal_name, tenant_type, created_by) values ($1, $2, $3, 'DSA_ORG', $4)`,
      [tenantId, tenant.slug, tenant.legalName, ACTOR],
    );

    const orgId = id('org');
    await q(
      `insert into organisation (id, tenant_id, legal_name, constitution, created_by, updated_by)
       values ($1, $2, $3, $4, $5, $5)`,
      [orgId, tenantId, tenant.organisation.legalName, tenant.organisation.constitution, ACTOR],
    );

    const branchIds = new Map<string, string>();
    for (const b of BRANCHES) {
      const branchId = id('br');
      branchIds.set(b.code, branchId);
      await q(
        `insert into branch (id, tenant_id, organisation_id, code, name, pincode, created_by, updated_by)
         values ($1, $2, $3, $4, $5, $6, $7, $7)`,
        [branchId, tenantId, orgId, b.code, b.name, b.pincode, ACTOR],
      );
    }
    const branch = (code: string) => {
      const b = branchIds.get(code);
      if (!b) throw new Error(`seed references unknown branch ${code}`);
      return b;
    };

    for (const u of USERS) {
      const p = users.get(u.handle)!;
      await q(
        `insert into app_user (id, tenant_id, idp_subject, email, display_name, primary_branch_id, created_by, updated_by)
         values ($1, $2, $3, $4, $5, $6, $7, $7)`,
        [p.userId, tenantId, p.idpSubject, p.email, u.displayName, branch(u.branch), ACTOR],
      );
    }

    const teamId = id('team');
    await q(
      `insert into team (id, tenant_id, name, branch_id, manager_user_id, created_by, updated_by)
       values ($1, $2, $3, $4, $5, $6, $6)`,
      [teamId, tenantId, TEAM.name, branch(TEAM.branch), user(TEAM.manager), ACTOR],
    );
    for (const m of TEAM.members) {
      await q(
        `insert into team_membership (id, tenant_id, team_id, user_id, created_by) values ($1, $2, $3, $4, $5)`,
        [id('tm'), tenantId, teamId, user(m), ACTOR],
      );
    }

    const roleIds = new Map<string, string>();
    for (const r of ROLES) {
      const roleId = id('role');
      roleIds.set(r.code, roleId);
      await q(`insert into role (id, tenant_id, code, name, created_by) values ($1, $2, $3, $4, $5)`, [
        roleId,
        tenantId,
        r.code,
        r.name,
        ACTOR,
      ]);
      for (const code of new Set(r.permissions)) {
        await q(`insert into role_permission (tenant_id, role_id, permission_code) values ($1, $2, $3)`, [
          tenantId,
          roleId,
          code,
        ]);
      }
    }

    for (const u of USERS) {
      for (const r of u.roles) {
        // created_by is the SYSTEM actor, never the user (SOD-05 CHECK).
        await q(
          `insert into user_role_assignment (id, tenant_id, user_id, role_id, scope_type, scope_branch_ids, created_by)
           values ($1, $2, $3, $4, $5, $6, $7)`,
          [
            id('ura'),
            tenantId,
            user(u.handle),
            roleIds.get(r.code),
            r.scope,
            (r.branches ?? []).map(branch),
            ACTOR,
          ],
        );
      }
    }

    for (const queue of QUEUES) {
      const queueId = id('wq');
      await q(
        `insert into work_queue (id, tenant_id, code, name, kind, branch_id, team_id, record_types, created_by, updated_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
        [
          queueId,
          tenantId,
          queue.code,
          queue.name,
          queue.kind,
          branch(queue.branch),
          queue.team ? teamId : null,
          [...queue.recordTypes],
          ACTOR,
        ],
      );
      for (const m of QUEUE_MEMBERS[queue.code] ?? []) {
        await q(
          `insert into work_queue_member (id, tenant_id, queue_id, user_id, can_assign, created_by)
           values ($1, $2, $3, $4, $5, $6)`,
          [id('wqm'), tenantId, queueId, user(m.handle), m.assign ?? false, ACTOR],
        );
      }
    }

    await q('COMMIT', []);
  } catch (err) {
    await q('ROLLBACK', []).catch(() => undefined);
    throw err;
  }
}

async function provision(admin: SupabaseClient, db: pg.Client, tenant: TenantSeed, password: string) {
  const tenantId = id('ten');
  const created: string[] = [];
  try {
    const users = await createAuthUsers(admin, tenant, tenantId, password, created);
    await insertTenant(db, tenant, tenantId, users);
    return { tenant, tenantId, users };
  } catch (err) {
    // Compensation: remove the Auth users this run created so a retry starts clean.
    for (const authId of created) await admin.auth.admin.deleteUser(authId).catch(() => undefined);
    throw err;
  }
}

async function main() {
  const { values } = parseArgs({ options: { tenant: { type: 'string' } } });
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL, DEMO_USER_PASSWORD } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !DATABASE_URL) {
    throw new Error('set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and DATABASE_URL in .env');
  }
  // Demo tenants are synthetic; they belong on the local stack only. Staging provisioning is REL-001.
  if (!LOCAL_HOSTS.has(new URL(SUPABASE_URL).hostname)) {
    throw new Error('demo provisioning runs only against the local Supabase stack');
  }
  const targets = values.tenant ? TENANTS.filter((t) => t.slug === values.tenant) : TENANTS;
  if (targets.length === 0)
    throw new Error(`unknown tenant ${values.tenant}; use ${TENANTS.map((t) => t.slug).join(' or ')}`);

  const password = DEMO_USER_PASSWORD ?? crypto.randomBytes(12).toString('base64url');
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  try {
    for (const t of targets) {
      const result = await provision(admin, db, t, password);
      console.log(`\n${result.tenant.slug}  tenant ${result.tenantId}`);
      console.table(
        [...result.users.entries()].map(([handle, u]) => ({
          handle,
          email: u.email,
          userId: u.userId,
          sub: u.idpSubject,
        })),
      );
    }
    console.log(
      `\nDemo password for every user: ${DEMO_USER_PASSWORD ? '(DEMO_USER_PASSWORD from .env)' : password}`,
    );
  } finally {
    await db.end();
  }
}

main().catch((err: Error) => {
  console.error(`provision-tenant: ${err.message}`);
  process.exit(1);
});
