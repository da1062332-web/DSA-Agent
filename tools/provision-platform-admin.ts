// Platform operator provisioning CLI — owner: Dev 1 — MODULE 1 and MODULE 40 (platform realm, migration 0050).
// Creates ONE platform operator: a Supabase Auth account whose trusted app_metadata.tenant_id is the platform tenant, the matching
// app_user in the platform tenant's branch, and the platform role assignment. There is no default or shared account, and no password
// is ever chosen, stored or printed: the person sets their own through a one-time link (or an invitation e-mail), then enrols TOTP at
// first sign-in (MFA is mandatory for every platform permission, so the app refuses access until they have).
//
//   npm run provision:platform-admin -w @dsa/tools -- --email you@company.com --name "Your Name" --project-ref <ref>            # DRY RUN
//   npm run provision:platform-admin -w @dsa/tools -- --email you@company.com --name "Your Name" --project-ref <ref> --apply    # writes
//
// Options: --role superadmin|support (default superadmin)   --delivery link|invite (default link)   --new-link (re-issue a link)
// Needs in the environment (never in the repository): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL (the dsa_api role).
// The run is safe to repeat: every step checks first, so a run that stopped half way is completed by running it again. An Auth account
// that this run created is deleted again if the database step fails. An existing Auth account is never changed unless it already
// belongs to the platform tenant.
import { parseArgs } from 'node:util';
import { PLATFORM_TENANT_ID } from '@dsa/contracts';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import { ulid } from 'ulid';

const ACTOR = 'SYSTEM:provision-platform-admin';
const ROLE_CODES = { superadmin: 'ROLE-PLATFORM-SUPERADMIN', support: 'ROLE-PLATFORM-SUPPORT' } as const;
const FORBIDDEN_DB_USERS = /^(postgres|supabase_admin|service_role)(\..*)?$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type PlatformRole = keyof typeof ROLE_CODES;

/** The few Supabase Admin API calls the tool uses, so tests can supply a fake. */
export interface AuthAdmin {
  listUsers(
    page: number,
    perPage: number,
  ): Promise<{
    users: { id: string; email?: string | null; app_metadata?: Record<string, unknown> | null }[];
  }>;
  createUser(input: {
    email: string;
    email_confirm: boolean;
    app_metadata: Record<string, unknown>;
    user_metadata: Record<string, unknown>;
  }): Promise<{ id: string }>;
  inviteUser(email: string, displayName: string): Promise<{ id: string }>;
  setAppMetadata(id: string, app_metadata: Record<string, unknown>): Promise<void>;
  generateRecoveryLink(email: string): Promise<string>;
  deleteUser(id: string): Promise<void>;
}

export interface ProvisionInput {
  email: string;
  displayName: string;
  role: PlatformRole;
  apply: boolean;
  delivery: 'link' | 'invite';
  /** Issue a fresh one-time link even though the account is already fully provisioned. */
  newLink?: boolean;
}

export interface ProvisionResult {
  mode: 'DRY_RUN' | 'APPLIED';
  email: string;
  roleCode: string;
  authUser: 'WOULD_CREATE' | 'CREATED' | 'REUSED';
  appUser: 'WOULD_CREATE' | 'CREATED' | 'EXISTS';
  roleAssignment: 'WOULD_CREATE' | 'CREATED' | 'EXISTS';
  authUserId?: string;
  appUserId?: string;
  /** A one-time sign-in link. Secret: shown once, never stored, never to be pasted into chat or a ticket. */
  oneTimeLink?: string;
  warnings: string[];
}

export class ProvisionError extends Error {}

const id = (prefix: string) => `${prefix}_${ulid()}`;

/** Runs `fn` in a transaction whose tenant is the platform tenant, so RLS applies to the tool as it does to the API. */
async function inPlatformTx<T>(db: pg.Client, fn: () => Promise<T>): Promise<T> {
  await db.query('BEGIN');
  try {
    await db.query(`select set_config('app.tenant_id', $1, true)`, [PLATFORM_TENANT_ID]);
    const out = await fn();
    await db.query('COMMIT');
    return out;
  } catch (err) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw err;
  }
}

async function findAuthUser(admin: AuthAdmin, email: string) {
  for (let page = 1; ; page++) {
    const { users } = await admin.listUsers(page, 200);
    const hit = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit;
    if (users.length < 200) return undefined;
  }
}

export async function provisionPlatformAdmin(
  admin: AuthAdmin,
  db: pg.Client,
  input: ProvisionInput,
): Promise<ProvisionResult> {
  const email = input.email.trim().toLowerCase();
  if (!EMAIL.test(email)) throw new ProvisionError('The e-mail address is not valid.');
  if (input.displayName.trim().length < 2)
    throw new ProvisionError('A display name of at least 2 characters is required.');
  const roleCode = ROLE_CODES[input.role];
  const warnings: string[] = [];

  // 1. What the database must already have (migration 0050). Read-only.
  const prerequisites = await inPlatformTx(db, async () => {
    const tenant = await db.query(`select status, tenant_type from tenant where id = $1`, [
      PLATFORM_TENANT_ID,
    ]);
    const branch = await db.query(
      `select id from branch where tenant_id = $1 and code = 'PLATFORM' and status = 'ACTIVE'`,
      [PLATFORM_TENANT_ID],
    );
    const role = await db.query(`select id from role where tenant_id = $1 and code = $2`, [
      PLATFORM_TENANT_ID,
      roleCode,
    ]);
    const user = await db.query(`select id, idp_subject, status, user_type from app_user where email = $1`, [
      email,
    ]);
    return {
      tenant: tenant.rows[0],
      branchId: branch.rows[0]?.id as string | undefined,
      roleId: role.rows[0]?.id as string | undefined,
      user: user.rows[0],
    };
  });
  if (
    !prerequisites.tenant ||
    prerequisites.tenant.tenant_type !== 'PLATFORM' ||
    prerequisites.tenant.status !== 'ACTIVE'
  ) {
    throw new ProvisionError(
      'The platform tenant is missing or not ACTIVE. Apply migration 0050 first (supabase/migrations/20261001000050_platform_realm.sql).',
    );
  }
  // An e-mail that already belongs to a connector portal login is refused before anything is written: such a login holds no role.
  if (prerequisites.user && prerequisites.user.user_type !== 'STAFF')
    throw new ProvisionError(
      'This e-mail belongs to a connector portal login, which cannot hold a platform role.',
    );
  if (!prerequisites.branchId)
    throw new ProvisionError('The platform branch is missing. Apply migration 0050 first.');
  if (!prerequisites.roleId)
    throw new ProvisionError(
      `${roleCode} does not exist in the platform tenant. Apply migration 0050 first.`,
    );

  // 2. The Auth account, if any. An account that belongs to another tenant is never touched.
  const existingAuth = await findAuthUser(admin, email);
  const authTenant = existingAuth?.app_metadata?.tenant_id;
  if (existingAuth && authTenant !== PLATFORM_TENANT_ID) {
    throw new ProvisionError(
      `${email} already has a Supabase Auth account${authTenant ? ` in tenant ${String(authTenant)}` : ' with no tenant'}. ` +
        "Emails are unique across the project and this tool never changes another tenant's account. Use a different e-mail address.",
    );
  }
  if (prerequisites.user && existingAuth && prerequisites.user.idp_subject !== existingAuth.id) {
    throw new ProvisionError(
      `The app_user for ${email} points at a different Auth account. Resolve this by hand; nothing was changed.`,
    );
  }
  if (prerequisites.user && !existingAuth) {
    throw new ProvisionError(
      `An app_user for ${email} exists but its Auth account does not. Resolve this by hand; nothing was changed.`,
    );
  }

  const assignmentExists = prerequisites.user
    ? await inPlatformTx(db, async () => {
        const r = await db.query(
          `select 1 from user_role_assignment where user_id = $1 and role_id = $2 and effective_range @> now()`,
          [prerequisites.user.id, prerequisites.roleId],
        );
        return r.rows.length > 0;
      })
    : false;

  const plan = {
    authUser: existingAuth ? ('REUSED' as const) : ('WOULD_CREATE' as const),
    appUser: prerequisites.user ? ('EXISTS' as const) : ('WOULD_CREATE' as const),
    roleAssignment: assignmentExists ? ('EXISTS' as const) : ('WOULD_CREATE' as const),
  };
  if (!input.apply) {
    return {
      mode: 'DRY_RUN',
      email,
      roleCode,
      ...plan,
      authUserId: existingAuth?.id,
      appUserId: prerequisites.user?.id,
      warnings,
    };
  }

  // 3. Write. Auth first (it has no transaction), then the database in one transaction; undo the Auth account on failure.
  let authUserId = existingAuth?.id;
  let createdAuth = false;
  let oneTimeLink: string | undefined;
  try {
    if (!authUserId) {
      if (input.delivery === 'invite') {
        authUserId = (await admin.inviteUser(email, input.displayName.trim())).id;
        await admin.setAppMetadata(authUserId, { tenant_id: PLATFORM_TENANT_ID });
      } else {
        // No password: the account cannot sign in until its owner sets one through the link.
        authUserId = (
          await admin.createUser({
            email,
            email_confirm: true,
            app_metadata: { tenant_id: PLATFORM_TENANT_ID },
            user_metadata: { display_name: input.displayName.trim() },
          })
        ).id;
      }
      createdAuth = true;
    }

    const written = await inPlatformTx(db, async () => {
      let appUserId = prerequisites.user?.id as string | undefined;
      let appUser: ProvisionResult['appUser'] = 'EXISTS';
      if (!appUserId) {
        appUserId = id('usr');
        await db.query(
          `insert into app_user (id, tenant_id, idp_subject, email, display_name, primary_branch_id, created_by, updated_by)
           values ($1, $2, $3, $4, $5, $6, $7, $7)`,
          [
            appUserId,
            PLATFORM_TENANT_ID,
            authUserId,
            email,
            input.displayName.trim(),
            prerequisites.branchId,
            ACTOR,
          ],
        );
        appUser = 'CREATED';
      }
      let roleAssignment: ProvisionResult['roleAssignment'] = 'EXISTS';
      if (!assignmentExists) {
        // created_by is the SYSTEM actor, never the user (SOD-05 CHECK: created_by <> user_id).
        await db.query(
          `insert into user_role_assignment (id, tenant_id, user_id, role_id, scope_type, scope_branch_ids, created_by)
           values ($1, $2, $3, $4, 'TENANT', '{}', $5)`,
          [id('ura'), PLATFORM_TENANT_ID, appUserId, prerequisites.roleId, ACTOR],
        );
        roleAssignment = 'CREATED';
      }
      return { appUserId, appUser, roleAssignment };
    });

    // Everything is written. From here nothing is undone: a failure only costs the link, and `--new-link` reissues it.
    if (input.delivery === 'link' && (createdAuth || input.newLink)) {
      try {
        oneTimeLink = await admin.generateRecoveryLink(email);
      } catch (linkErr) {
        warnings.push(
          `The account is provisioned but the one-time link could not be generated (${(linkErr as Error).message}). Run again with --new-link.`,
        );
      }
    }
    if (createdAuth && input.delivery === 'invite')
      warnings.push('An invitation e-mail was sent. The person sets their password from it.');
    return {
      mode: 'APPLIED',
      email,
      roleCode,
      authUser: createdAuth ? 'CREATED' : 'REUSED',
      appUser: written.appUser,
      roleAssignment: written.roleAssignment,
      authUserId,
      appUserId: written.appUserId,
      oneTimeLink,
      warnings,
    };
  } catch (err) {
    if (createdAuth && authUserId) {
      try {
        await admin.deleteUser(authUserId);
      } catch {
        throw new ProvisionError(
          `Provisioning failed (${(err as Error).message}) AND the Auth account ${authUserId} created by this run could not be deleted. ` +
            'Delete it in the Supabase dashboard (Authentication, Users) before running again.',
        );
      }
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------------------------------------------------------------
function supabaseAdmin(url: string, serviceRoleKey: string): AuthAdmin {
  const client = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const admin = client.auth.admin;
  return {
    async listUsers(page, perPage) {
      const { data, error } = await admin.listUsers({ page, perPage });
      if (error) throw new ProvisionError(`list auth users: ${error.message}`);
      return { users: data.users.map((u) => ({ id: u.id, email: u.email, app_metadata: u.app_metadata })) };
    },
    async createUser(input) {
      const { data, error } = await admin.createUser(input);
      if (error || !data.user)
        throw new ProvisionError(`create auth user: ${error?.message ?? 'not created'}`);
      return { id: data.user.id };
    },
    async inviteUser(email, displayName) {
      const { data, error } = await admin.inviteUserByEmail(email, { data: { display_name: displayName } });
      if (error || !data.user)
        throw new ProvisionError(`invite auth user: ${error?.message ?? 'not invited'}`);
      return { id: data.user.id };
    },
    async setAppMetadata(userId, appMetadata) {
      const { error } = await admin.updateUserById(userId, { app_metadata: appMetadata });
      if (error) throw new ProvisionError(`set app_metadata: ${error.message}`);
    },
    async generateRecoveryLink(email) {
      const { data, error } = await admin.generateLink({ type: 'recovery', email });
      if (error || !data.properties?.action_link)
        throw new ProvisionError(`generate link: ${error?.message ?? 'no link'}`);
      return data.properties.action_link;
    },
    async deleteUser(userId) {
      const { error } = await admin.deleteUser(userId);
      if (error) throw new ProvisionError(`delete auth user: ${error.message}`);
    },
  };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
      role: { type: 'string', default: 'superadmin' },
      delivery: { type: 'string', default: 'link' },
      'project-ref': { type: 'string' },
      apply: { type: 'boolean', default: false },
      'new-link': { type: 'boolean', default: false },
    },
  });
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const databaseUrl = process.env.DATABASE_URL;
  if (!values.email || !values.name || !values['project-ref']) {
    throw new ProvisionError(
      'Required: --email, --name and --project-ref. Add --apply to write; without it this is a dry run.',
    );
  }
  if (!url || !serviceRoleKey || !databaseUrl) {
    throw new ProvisionError(
      'SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and DATABASE_URL must be set in the environment (apps/api/.env).',
    );
  }
  if (!(values.role! in ROLE_CODES)) throw new ProvisionError('--role must be superadmin or support.');
  if (values.delivery !== 'link' && values.delivery !== 'invite')
    throw new ProvisionError('--delivery must be link or invite.');
  // Guard against the wrong project: the ref you typed must be the one in SUPABASE_URL.
  if (new URL(url).hostname.split('.')[0] !== values['project-ref']) {
    throw new ProvisionError(
      `--project-ref ${values['project-ref']} does not match SUPABASE_URL (${new URL(url).hostname}). Nothing was changed.`,
    );
  }
  // The tool writes as the API's own database role, so row-level security applies to it too.
  const dbUser = decodeURIComponent(new URL(databaseUrl).username);
  if (FORBIDDEN_DB_USERS.test(dbUser)) {
    throw new ProvisionError(
      'DATABASE_URL must connect as dsa_api, never as postgres or service_role (it would bypass row-level security).',
    );
  }

  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const result = await provisionPlatformAdmin(supabaseAdmin(url, serviceRoleKey), db, {
      email: values.email,
      displayName: values.name,
      role: values.role as PlatformRole,
      apply: values.apply!,
      delivery: values.delivery,
      newLink: values['new-link'],
    });
    const { oneTimeLink, ...safe } = result;
    console.log(JSON.stringify(safe, null, 2));
    if (result.mode === 'DRY_RUN') {
      console.log('\nDry run: nothing was written. Re-run with --apply to create the account.');
    } else {
      console.log(
        '\nNext: the person opens the one-time link, sets a password, signs in, and enrols an authenticator app when asked (TOTP is mandatory).',
      );
      console.log('Then check GET /v1/me shows the platform permissions, and that /platform-admin opens.');
    }
    if (oneTimeLink) {
      console.log(
        '\nONE-TIME SIGN-IN LINK (secret: give it only to the account owner, do not paste it anywhere else):',
      );
      console.log(oneTimeLink);
    }
  } finally {
    await db.end();
  }
}

// Run only when executed directly (tests import provisionPlatformAdmin).
if (process.argv[1] && /provision-platform-admin\.[cm]?[jt]s$/.test(process.argv[1].replace(/\\/g, '/'))) {
  main().catch((err: unknown) => {
    console.error(`\nFAILED: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
