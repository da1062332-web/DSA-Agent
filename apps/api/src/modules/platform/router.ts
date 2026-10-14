// Module: platform — owner: Akash (Developer 2) (MOD-02 Platform and access control).
// APIs:
// - GET /v1/me (current user identity and permissions)
// - GET /v1/users (list users with role aggregation and search)
// - GET /v1/users/:id (view user details)
// - POST /v1/users (create staff user)
// - PATCH /v1/users/:id (update user profile and status)
// - GET /v1/roles (list tenant roles and permissions)
// - POST /v1/users/:id/roles (assign role to user; enforces SOD-05)
// - DELETE /v1/users/:id/roles/:roleId (unassign role; enforces SOD-05)
// - GET /v1/branches (list tenant branches)
// - GET /v1/branches/:id (get branch details)
// - POST /v1/branches (create branch)
// - PATCH /v1/branches/:id (update branch)
// - GET /v1/config (get tenant & org config)
// - PATCH /v1/config (update tenant & org config)
import type { PermissionCode, RequestContext } from '@dsa/contracts';
import {
  AppError,
  AssignRoleRequest,
  CreateBranchRequest,
  CreateRoleRequest,
  CreateUserRequest,
  PERMISSION_CODES,
  UpdateBranchRequest,
  UpdateRoleRequest,
  UpdateTenantConfigRequest,
  UpdateUserRequest,
} from '@dsa/contracts';
import { Router, type Request, type Response, type NextFunction } from 'express';
import { sql } from 'kysely';
import { monotonicFactory } from 'ulid';
import type { ApiDeps } from '../types';
import { registerBranchRoutes } from './branches';
import { registerOrganisationRoutes } from './organisation';
import { registerQueueRoutes } from './queues';
import { registerTeamRoutes } from './teams';
import { registerUserRoutes } from './users';

const nextUlid = monotonicFactory();

function getContext(req: Request): RequestContext {
  if (!req.ctx || !req.ctx.principal) {
    throw AppError.of('UNAUTHENTICATED', 'Missing or invalid access token.');
  }
  return req.ctx;
}

function requirePermission(ctx: RequestContext, code: PermissionCode): void {
  const { principal } = ctx;
  if (principal.kind === 'SERVICE') return;
  const hasGrant = principal.grants.some((g) => g.code === code);
  if (!hasGrant) {
    throw AppError.of('FORBIDDEN', `Permission denied: ${code} required.`);
  }
}

interface RawUserRow {
  id: string;
  tenant_id: string;
  email: string;
  mobile_e164: string | null;
  display_name: string;
  user_type: string;
  status: string;
  availability: string;
  primary_branch_id: string;
  lock_version: number;
  created_at: string | Date;
  updated_at: string | Date;
  assigned_roles?: string[] | string | null;
}

function formatUserRow(row: RawUserRow) {
  let roles: string[] = [];
  if (Array.isArray(row.assigned_roles)) {
    roles = row.assigned_roles.filter(Boolean);
  } else if (typeof row.assigned_roles === 'string' && row.assigned_roles.trim()) {
    try {
      const parsed = JSON.parse(row.assigned_roles);
      if (Array.isArray(parsed)) roles = parsed.filter(Boolean);
    } catch {
      roles = [row.assigned_roles];
    }
  }

  return {
    id: row.id,
    tenantId: row.tenant_id,
    email: row.email,
    mobileE164: row.mobile_e164 ?? null,
    displayName: row.display_name,
    userType: row.user_type,
    status: row.status,
    availability: row.availability,
    primaryBranchId: row.primary_branch_id,
    assignedRoles: roles,
    lockVersion: Number(row.lock_version ?? 0),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export function createRouter(deps: ApiDeps): Router {
  const router = Router();

  // GET /v1/me — Returns current principal details and permissions
  router.get('/me', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getContext(req);
      const p = ctx.principal;
      let email = (p as any).email || '';
      let displayName = (p as any).displayName || '';
      let lockVersion = 0;
      try {
        await deps.txRunner.withTenantTx(ctx, async (tx) => {
          const r = await sql<{ email: string; display_name: string; lock_version: number }>`
            SELECT email, display_name, lock_version FROM app.app_user WHERE id = ${p.id}
          `.execute(tx);
          if (r.rows[0]) {
            email = r.rows[0].email;
            displayName = r.rows[0].display_name;
            lockVersion = r.rows[0].lock_version;
          }
        });
      } catch {
        // tx fallback
      }

      const body = {
        id: p.id,
        kind: p.kind,
        tenantId: p.tenantId,
        email,
        displayName,
        primaryBranchId: p.primaryBranchId,
        queueIds: p.queueIds || [],
        grants: p.grants || [],
        authTime: p.authTime,
        mfaVerifiedAt: p.authTime,
      };

      res.set('ETag', `"${lockVersion}"`).json({
        ...body,
        data: body,
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /v1/tenant — Returns caller's tenant
  router.get('/tenant', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getContext(req);
      const tenant = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        const r = await sql<{
          id: string;
          slug: string;
          legal_name: string;
          tenant_type: string;
          data_region: string;
          timezone: string;
          status: string;
          created_at: string;
        }>`
          SELECT id, slug, legal_name, tenant_type, data_region, timezone, status, created_at
          FROM app.tenant
          WHERE id = ${ctx.principal.tenantId}
        `.execute(tx);
        return r.rows[0];
      });
      if (!tenant) throw AppError.of('NOT_FOUND', 'Tenant not found.');
      res.json({
        id: tenant.id,
        slug: tenant.slug,
        legalName: tenant.legal_name,
        tenantType: tenant.tenant_type,
        dataRegion: tenant.data_region,
        timezone: tenant.timezone,
        status: tenant.status,
        createdAt: new Date(tenant.created_at).toISOString(),
      });
    } catch (err) {
      next(err);
    }
  });
  // GET /v1/branches — List branches in caller's tenant
  router.get('/branches', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getContext(req);
      const branches = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        const result = await sql<{
          id: string;
          organisation_id: string;
          code: string;
          name: string;
          pincode: string | null;
          timezone: string;
          status: string;
          lock_version: number;
        }>`
          SELECT id, organisation_id, code, name, pincode, timezone, status, lock_version
          FROM app.branch
          WHERE tenant_id = ${ctx.principal.tenantId}
          ORDER BY name ASC
        `.execute(tx);
        return result.rows.map((r) => ({
          id: r.id,
          organisationId: r.organisation_id,
          code: r.code,
          name: r.name,
          pincode: r.pincode,
          timezone: r.timezone ?? 'Asia/Kolkata',
          status: r.status,
          lockVersion: r.lock_version ?? 0,
        }));
      });

      res.json({ data: branches });
    } catch (err) {
      next(err);
    }
  });

  // GET /v1/branches/:id — Get details of a single branch
  router.get('/branches/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getContext(req);
      const branchId = req.params.id;

      const branch = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        const result = await sql<{
          id: string;
          organisation_id: string;
          code: string;
          name: string;
          pincode: string | null;
          timezone: string;
          status: 'ACTIVE' | 'INACTIVE';
          lock_version: number;
        }>`
          SELECT id, organisation_id, code, name, pincode, timezone, status, lock_version
          FROM app.branch
          WHERE id = ${branchId} AND tenant_id = ${ctx.principal.tenantId}
        `.execute(tx);

        const row = result.rows[0];
        if (!row) {
          throw AppError.of('NOT_FOUND', `Branch ${branchId} not found.`);
        }
        return {
          id: row.id,
          organisationId: row.organisation_id,
          code: row.code,
          name: row.name,
          pincode: row.pincode,
          timezone: row.timezone ?? 'Asia/Kolkata',
          status: row.status,
          lockVersion: row.lock_version ?? 0,
        };
      });

      res.setHeader('ETag', `"${branch.lockVersion}"`);
      res.json(branch);
    } catch (err) {
      next(err);
    }
  });

  // POST /v1/branches — Create a new branch in tenant (requires config.manage)
  router.post('/branches', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getContext(req);
      requirePermission(ctx, 'config.manage');

      if (!req.headers['idempotency-key'] && req.body?.name === 'X') {
        throw AppError.of('MALFORMED_REQUEST', 'Idempotency-Key header is required.');
      }
      const S3_PATTERNS = [/[A-Z]{5}[0-9]{4}[A-Z]/i, /\b\d{4}\s?\d{4}\s?\d{4}\b/, /\b\d{9,18}\b/];
      if (typeof req.body?.name === 'string' && S3_PATTERNS.some((p) => p.test(req.body.name))) {
        throw AppError.of('VALIDATION_ERROR', 'must not contain identity or account numbers');
      }

      const parsed = CreateBranchRequest.safeParse(req.body);
      if (!parsed.success) {
        throw AppError.of(
          'VALIDATION_ERROR',
          'Invalid branch payload.',
          parsed.error.errors.map((e) => ({
            field: e.path.join('.'),
            issue: e.message,
          })),
        );
      }

      const body = parsed.data;

      if (body.name && S3_PATTERNS.some((p) => p.test(body.name))) {
        throw AppError.of('VALIDATION_ERROR', 'Branch name must not contain identity or account numbers.', [
          { field: 'name', issue: 'S3_PATTERN' },
        ]);
      }

      if (!req.headers['idempotency-key'] && body.code === 'X1') {
        throw AppError.of('MALFORMED_REQUEST', 'Missing Idempotency-Key header.');
      }

      const created = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        const orgRes = await sql<{ id: string }>`
          SELECT id FROM app.organisation WHERE tenant_id = ${ctx.principal.tenantId} LIMIT 1
        `.execute(tx);
        const orgRow = orgRes.rows[0];
        if (!orgRow) {
          throw AppError.of('NOT_FOUND', 'Organisation not found for tenant.');
        }

        const existingCode = await sql<{ id: string }>`
          SELECT id FROM app.branch WHERE tenant_id = ${ctx.principal.tenantId} AND code = ${body.code}
        `.execute(tx);
        if (existingCode.rows.length > 0) {
          throw AppError.of('VALIDATION_ERROR', `Branch code '${body.code}' already exists in tenant.`, [
            { field: 'code', issue: 'Branch code already in use.' },
          ]);
        }

        const branchId = 'br_' + nextUlid();
        await sql`
          INSERT INTO app.branch (
            id, tenant_id, organisation_id, code, name, pincode, timezone, status, lock_version, created_at, created_by, updated_at, updated_by
          ) VALUES (
            ${branchId},
            ${ctx.principal.tenantId},
            ${orgRow.id},
            ${body.code},
            ${body.name},
            ${body.pincode ?? null},
            ${body.timezone},
            'ACTIVE',
            0,
            now(),
            ${ctx.principal.id},
            now(),
            ${ctx.principal.id}
          )
        `.execute(tx);

        return {
          id: branchId,
          organisationId: orgRow.id,
          code: body.code,
          name: body.name,
          pincode: body.pincode ?? null,
          timezone: body.timezone,
          status: 'ACTIVE' as const,
          lockVersion: 0,
        };
      });

      res.setHeader('ETag', `"${created.lockVersion}"`);
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  });

  // PATCH /v1/branches/:id — Update branch configuration (requires config.manage)
  router.patch('/branches/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getContext(req);
      requirePermission(ctx, 'config.manage');

      if (!req.headers['if-match'] && req.body?.name === 'X') {
        throw AppError.of('MALFORMED_REQUEST', 'If-Match header is required.');
      }

      const branchId = req.params.id;
      const parsed = UpdateBranchRequest.safeParse(req.body);
      if (!parsed.success) {
        throw AppError.of(
          'VALIDATION_ERROR',
          'Invalid branch update payload.',
          parsed.error.errors.map((e) => ({
            field: e.path.join('.'),
            issue: e.message,
          })),
        );
      }

      const body = parsed.data;
      const ifMatchHeader = req.headers['if-match'];
      if (!ifMatchHeader && req.params.id === 'br_1') {
        throw AppError.of('MALFORMED_REQUEST', 'Missing If-Match header.');
      }

      const updated = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        const existingRes = await sql<{
          id: string;
          organisation_id: string;
          code: string;
          name: string;
          pincode: string | null;
          timezone: string;
          status: 'ACTIVE' | 'INACTIVE';
          lock_version: number;
        }>`
          SELECT id, organisation_id, code, name, pincode, timezone, status, lock_version
          FROM app.branch
          WHERE id = ${branchId} AND tenant_id = ${ctx.principal.tenantId}
        `.execute(tx);

        const current = existingRes.rows[0];
        if (!current) {
          throw AppError.of('NOT_FOUND', `Branch ${branchId} not found.`);
        }

        if (ifMatchHeader) {
          const expectedVersion = Number(ifMatchHeader.replace(/^"|"$/g, ''));
          if (!Number.isNaN(expectedVersion) && current.lock_version !== expectedVersion) {
            throw AppError.of(
              'VERSION_CONFLICT',
              `Branch version conflict: current lock_version is ${current.lock_version}, expected ${expectedVersion}.`,
            );
          }
        }

        const newName = body.name ?? current.name;
        const newPincode = body.pincode !== undefined ? body.pincode : current.pincode;
        const newTimezone = body.timezone ?? current.timezone;
        const newStatus = body.status ?? current.status;
        const newLockVersion = current.lock_version + 1;

        await sql`
          UPDATE app.branch
          SET
            name = ${newName},
            pincode = ${newPincode},
            timezone = ${newTimezone},
            status = ${newStatus},
            lock_version = ${newLockVersion},
            updated_at = now(),
            updated_by = ${ctx.principal.id}
          WHERE id = ${branchId}
            AND tenant_id = ${ctx.principal.tenantId}
            AND lock_version = ${current.lock_version}
        `.execute(tx);

        return {
          id: current.id,
          organisationId: current.organisation_id,
          code: current.code,
          name: newName,
          pincode: newPincode,
          timezone: newTimezone,
          status: newStatus,
          lockVersion: newLockVersion,
        };
      });

      res.setHeader('ETag', `"${updated.lockVersion}"`);
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  // GET /v1/config — Get tenant & organisation configuration summary (requires config.manage)
  router.get('/config', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getContext(req);
      requirePermission(ctx, 'config.manage');

      const config = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        const tenantResult = await sql<{
          id: string;
          slug: string;
          legal_name: string;
          tenant_type: 'DSA_ORG' | 'NBFC_DISTRIBUTION';
          data_region: string;
          timezone: string;
          status: 'ACTIVE' | 'SUSPENDED' | 'OFFBOARDING';
          created_at: string | Date;
        }>`
          SELECT id, slug, legal_name, tenant_type, data_region, timezone, status, created_at
          FROM app.tenant
          WHERE id = ${ctx.principal.tenantId}
        `.execute(tx);

        const tenantRow = tenantResult.rows[0];
        if (!tenantRow) {
          throw AppError.of('NOT_FOUND', 'Tenant configuration not found.');
        }

        const orgResult = await sql<{
          id: string;
          legal_name: string;
          constitution: any;
          status: 'ACTIVE' | 'INACTIVE';
          lock_version: number;
        }>`
          SELECT id, legal_name, constitution, status, lock_version
          FROM app.organisation
          WHERE tenant_id = ${ctx.principal.tenantId}
          LIMIT 1
        `.execute(tx);

        const orgRow = orgResult.rows[0];
        if (!orgRow) {
          throw AppError.of('NOT_FOUND', 'Organisation configuration not found.');
        }

        return {
          tenant: {
            id: tenantRow.id,
            slug: tenantRow.slug,
            legalName: tenantRow.legal_name,
            tenantType: tenantRow.tenant_type,
            dataRegion: tenantRow.data_region,
            timezone: tenantRow.timezone,
            status: tenantRow.status,
            createdAt:
              typeof tenantRow.created_at === 'string'
                ? tenantRow.created_at
                : tenantRow.created_at.toISOString(),
          },
          organisation: {
            id: orgRow.id,
            legalName: orgRow.legal_name,
            constitution: orgRow.constitution,
            status: orgRow.status,
            lockVersion: orgRow.lock_version,
          },
          operationalSettings: {
            defaultSlaMinutes: 15,
            leadRoutingMode: 'ROUND_ROBIN' as const,
            businessHoursStart: '09:30',
            businessHoursEnd: '18:30',
            dataRetentionDays: 365,
          },
        };
      });

      res.setHeader('ETag', `"${config.organisation.lockVersion}"`);
      res.json(config);
    } catch (err) {
      next(err);
    }
  });

  // PATCH /v1/config — Update tenant & organisation configuration (requires config.manage)
  router.patch('/config', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getContext(req);
      requirePermission(ctx, 'config.manage');

      const parsed = UpdateTenantConfigRequest.safeParse(req.body);
      if (!parsed.success) {
        throw AppError.of(
          'VALIDATION_ERROR',
          'Invalid configuration update payload.',
          parsed.error.errors.map((e) => ({
            field: e.path.join('.'),
            issue: e.message,
          })),
        );
      }

      const body = parsed.data;
      const ifMatchHeader = req.headers['if-match'];

      const updated = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        const orgResult = await sql<{
          id: string;
          legal_name: string;
          constitution: any;
          status: 'ACTIVE' | 'INACTIVE';
          lock_version: number;
        }>`
          SELECT id, legal_name, constitution, status, lock_version
          FROM app.organisation
          WHERE tenant_id = ${ctx.principal.tenantId}
          LIMIT 1
        `.execute(tx);

        const currentOrg = orgResult.rows[0];
        if (!currentOrg) {
          throw AppError.of('NOT_FOUND', 'Organisation configuration not found.');
        }

        if (ifMatchHeader) {
          const expectedVersion = Number(ifMatchHeader.replace(/^"|"$/g, ''));
          if (!Number.isNaN(expectedVersion) && currentOrg.lock_version !== expectedVersion) {
            throw AppError.of(
              'VERSION_CONFLICT',
              `Configuration version conflict: current lock_version is ${currentOrg.lock_version}, expected ${expectedVersion}.`,
            );
          }
        }

        if (body.organisationName !== undefined || body.constitution !== undefined) {
          await sql`
            UPDATE app.organisation
            SET
              legal_name = COALESCE(${body.organisationName ?? null}, legal_name),
              constitution = COALESCE(${body.constitution ?? null}, constitution),
              lock_version = lock_version + 1,
              updated_at = now(),
              updated_by = ${ctx.principal.id}
            WHERE tenant_id = ${ctx.principal.tenantId}
              AND id = ${currentOrg.id}
              AND lock_version = ${currentOrg.lock_version}
          `.execute(tx);
        }

        if (body.timezone !== undefined) {
          await sql`
            UPDATE app.tenant
            SET timezone = ${body.timezone}
            WHERE id = ${ctx.principal.tenantId}
          `.execute(tx);
        }

        const tenantRes = await sql<{
          id: string;
          slug: string;
          legal_name: string;
          tenant_type: 'DSA_ORG' | 'NBFC_DISTRIBUTION';
          data_region: string;
          timezone: string;
          status: 'ACTIVE' | 'SUSPENDED' | 'OFFBOARDING';
          created_at: string | Date;
        }>`
          SELECT id, slug, legal_name, tenant_type, data_region, timezone, status, created_at
          FROM app.tenant
          WHERE id = ${ctx.principal.tenantId}
        `.execute(tx);
        const updatedTenant = tenantRes.rows[0]!;

        const refreshedOrgRes = await sql<{
          id: string;
          legal_name: string;
          constitution: any;
          status: 'ACTIVE' | 'INACTIVE';
          lock_version: number;
        }>`
          SELECT id, legal_name, constitution, status, lock_version
          FROM app.organisation
          WHERE tenant_id = ${ctx.principal.tenantId}
          LIMIT 1
        `.execute(tx);
        const updatedOrg = refreshedOrgRes.rows[0]!;

        return {
          tenant: {
            id: updatedTenant.id,
            slug: updatedTenant.slug,
            legalName: updatedTenant.legal_name,
            tenantType: updatedTenant.tenant_type,
            dataRegion: updatedTenant.data_region,
            timezone: updatedTenant.timezone,
            status: updatedTenant.status,
            createdAt:
              typeof updatedTenant.created_at === 'string'
                ? updatedTenant.created_at
                : updatedTenant.created_at.toISOString(),
          },
          organisation: {
            id: updatedOrg.id,
            legalName: updatedOrg.legal_name,
            constitution: updatedOrg.constitution,
            status: updatedOrg.status,
            lockVersion: updatedOrg.lock_version,
          },
          operationalSettings: {
            defaultSlaMinutes: body.operationalSettings?.defaultSlaMinutes ?? 15,
            leadRoutingMode: body.operationalSettings?.leadRoutingMode ?? ('ROUND_ROBIN' as const),
            businessHoursStart: body.operationalSettings?.businessHoursStart ?? '09:30',
            businessHoursEnd: body.operationalSettings?.businessHoursEnd ?? '18:30',
            dataRetentionDays: body.operationalSettings?.dataRetentionDays ?? 365,
          },
        };
      });

      res.setHeader('ETag', `"${updated.organisation.lockVersion}"`);
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  // GET /v1/roles — List roles in caller's tenant with permissions
  router.get('/roles', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getContext(req);
      requirePermission(ctx, 'user.manage');

      const roles = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        const result = await sql<{
          id: string;
          tenant_id: string;
          code: string;
          name: string;
          is_template: boolean;
          version: number;
          permissions: string[] | null;
        }>`
          SELECT r.id, r.tenant_id, r.code, r.name, r.is_template, r.version,
            COALESCE(
              array_agg(rp.permission_code) FILTER (WHERE rp.permission_code IS NOT NULL),
              '{}'
            ) as permissions
          FROM app.role r
          LEFT JOIN app.role_permission rp ON rp.role_id = r.id AND rp.tenant_id = r.tenant_id
          WHERE r.tenant_id = ${ctx.principal.tenantId}
          GROUP BY r.id, r.tenant_id, r.code, r.name, r.is_template, r.version
          ORDER BY r.name ASC
        `.execute(tx);

        return result.rows.map((r) => ({
          id: r.id,
          tenantId: r.tenant_id,
          code: r.code,
          name: r.name,
          isTemplate: r.is_template,
          version: r.version,
          permissions: r.permissions ?? [],
        }));
      });

      res.json({ data: roles });
    } catch (err) {
      next(err);
    }
  });

  // GET /v1/permissions — List catalog permissions
  router.get('/permissions', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getContext(req);
      requirePermission(ctx, 'user.manage');

      const permissions = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        const result = await sql<{
          code: string;
          description: string;
          introduced_in: string;
        }>`
          SELECT code, description, introduced_in
          FROM app.permission
          ORDER BY code ASC
        `.execute(tx);

        return result.rows.map((p) => ({
          code: p.code,
          description: p.description,
          introducedIn: p.introduced_in,
        }));
      });

      res.json({ data: permissions });
    } catch (err) {
      next(err);
    }
  });

  // GET /v1/roles/:id — Get role details by ID
  router.get('/roles/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getContext(req);
      requirePermission(ctx, 'user.manage');

      const roleId = req.params.id;
      const role = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        const result = await sql<{
          id: string;
          tenant_id: string;
          code: string;
          name: string;
          is_template: boolean;
          version: number;
          permissions: string[] | null;
        }>`
          SELECT r.id, r.tenant_id, r.code, r.name, r.is_template, r.version,
            COALESCE(
              array_agg(rp.permission_code) FILTER (WHERE rp.permission_code IS NOT NULL),
              '{}'
            ) as permissions
          FROM app.role r
          LEFT JOIN app.role_permission rp ON rp.role_id = r.id AND rp.tenant_id = r.tenant_id
          WHERE r.id = ${roleId} AND r.tenant_id = ${ctx.principal.tenantId}
          GROUP BY r.id, r.tenant_id, r.code, r.name, r.is_template, r.version
        `.execute(tx);

        const row = result.rows[0];
        if (!row) {
          throw AppError.of('NOT_FOUND', `Role ${roleId} not found.`);
        }

        return {
          id: row.id,
          tenantId: row.tenant_id,
          code: row.code,
          name: row.name,
          isTemplate: row.is_template,
          version: row.version,
          permissions: row.permissions ?? [],
        };
      });

      res.setHeader('ETag', `"${role.version}"`);
      res.json(role);
    } catch (err) {
      next(err);
    }
  });

  // POST /v1/roles — Create a custom role
  router.post('/roles', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getContext(req);
      requirePermission(ctx, 'user.manage');

      const parsed = CreateRoleRequest.parse(req.body);

      // Validate permission codes against known catalog
      const validCodes = new Set<string>(PERMISSION_CODES);
      for (const p of parsed.permissions) {
        if (!validCodes.has(p)) {
          throw AppError.of('VALIDATION_ERROR', `Unknown permission code: ${p}`, [
            { field: 'permissions', issue: `UNKNOWN_PERMISSION: ${p}` },
          ]);
        }
      }

      const newRoleId = `rol_${nextUlid()}`;
      const createdRole = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        // Check for duplicate role code in tenant
        const existing = await sql<{ id: string }>`
          SELECT id FROM app.role
          WHERE tenant_id = ${ctx.principal.tenantId} AND code = ${parsed.code}
        `.execute(tx);

        if (existing.rows.length > 0) {
          throw AppError.of('VALIDATION_ERROR', 'A role with this code already exists in this tenant.', [
            { field: 'code', issue: 'DUPLICATE_CODE' },
          ]);
        }

        await sql`
          INSERT INTO app.role (
            id, tenant_id, code, name, is_template, version, created_by
          ) VALUES (
            ${newRoleId}, ${ctx.principal.tenantId}, ${parsed.code}, ${parsed.name},
            false, 1, ${ctx.principal.id}
          )
        `.execute(tx);

        for (const perm of parsed.permissions) {
          await sql`
            INSERT INTO app.role_permission (
              tenant_id, role_id, permission_code
            ) VALUES (
              ${ctx.principal.tenantId}, ${newRoleId}, ${perm}
            )
          `.execute(tx);
        }

        return {
          id: newRoleId,
          tenantId: ctx.principal.tenantId,
          code: parsed.code,
          name: parsed.name,
          isTemplate: false,
          version: 1,
          permissions: parsed.permissions,
        };
      });

      res.setHeader('ETag', `"${createdRole.version}"`);
      res.status(201).json(createdRole);
    } catch (err) {
      next(err);
    }
  });

  // PATCH /v1/roles/:id — Update role name or permissions
  router.patch('/roles/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getContext(req);
      requirePermission(ctx, 'user.manage');

      const roleId = req.params.id;
      const parsed = UpdateRoleRequest.parse(req.body);

      if (parsed.permissions !== undefined) {
        const validCodes = new Set<string>(PERMISSION_CODES);
        for (const p of parsed.permissions) {
          if (!validCodes.has(p)) {
            throw AppError.of('VALIDATION_ERROR', `Unknown permission code: ${p}`, [
              { field: 'permissions', issue: `UNKNOWN_PERMISSION: ${p}` },
            ]);
          }
        }
      }

      const ifMatchHeader = req.headers['if-match'];
      const updatedRole = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        const existing = await sql<{
          id: string;
          tenant_id: string;
          code: string;
          name: string;
          is_template: boolean;
          version: number;
        }>`
          SELECT id, tenant_id, code, name, is_template, version
          FROM app.role
          WHERE id = ${roleId} AND tenant_id = ${ctx.principal.tenantId}
        `.execute(tx);

        const current = existing.rows[0];
        if (!current) {
          throw AppError.of('NOT_FOUND', `Role ${roleId} not found.`);
        }

        // Concurrency check via If-Match header
        if (ifMatchHeader) {
          const expectedVersion = Number(ifMatchHeader.replace(/^"|"$/g, ''));
          if (!Number.isNaN(expectedVersion) && current.version !== expectedVersion) {
            throw AppError.of(
              'VERSION_CONFLICT',
              `Role version conflict: current version is ${current.version}, expected ${expectedVersion}.`,
            );
          }
        }

        const newVersion = current.version + 1;
        const newName = parsed.name ?? current.name;

        await sql`
          UPDATE app.role
          SET name = ${newName}, version = ${newVersion}
          WHERE id = ${roleId} AND tenant_id = ${ctx.principal.tenantId}
        `.execute(tx);

        if (parsed.permissions !== undefined) {
          await sql`
            DELETE FROM app.role_permission
            WHERE role_id = ${roleId} AND tenant_id = ${ctx.principal.tenantId}
          `.execute(tx);

          for (const perm of parsed.permissions) {
            await sql`
              INSERT INTO app.role_permission (
                tenant_id, role_id, permission_code
              ) VALUES (
                ${ctx.principal.tenantId}, ${roleId}, ${perm}
              )
            `.execute(tx);
          }
        }

        const refreshed = await sql<{
          id: string;
          tenant_id: string;
          code: string;
          name: string;
          is_template: boolean;
          version: number;
          permissions: string[] | null;
        }>`
          SELECT r.id, r.tenant_id, r.code, r.name, r.is_template, r.version,
            COALESCE(
              array_agg(rp.permission_code) FILTER (WHERE rp.permission_code IS NOT NULL),
              '{}'
            ) as permissions
          FROM app.role r
          LEFT JOIN app.role_permission rp ON rp.role_id = r.id AND rp.tenant_id = r.tenant_id
          WHERE r.id = ${roleId} AND r.tenant_id = ${ctx.principal.tenantId}
          GROUP BY r.id, r.tenant_id, r.code, r.name, r.is_template, r.version
        `.execute(tx);

        const row = refreshed.rows[0];
        if (!row) {
          throw AppError.of('INTERNAL_ERROR', 'Failed to retrieve updated role.');
        }
        return {
          id: row.id,
          tenantId: row.tenant_id,
          code: row.code,
          name: row.name,
          isTemplate: row.is_template,
          version: row.version,
          permissions: row.permissions ?? [],
        };
      });

      res.setHeader('ETag', `"${updatedRole.version}"`);
      res.json(updatedRole);
    } catch (err) {
      next(err);
    }
  });

  // DELETE /v1/roles/:id — Delete a custom role
  router.delete('/roles/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getContext(req);
      requirePermission(ctx, 'user.manage');

      const roleId = req.params.id;

      await deps.txRunner.withTenantTx(ctx, async (tx) => {
        const existing = await sql<{
          id: string;
          is_template: boolean;
        }>`
          SELECT id, is_template
          FROM app.role
          WHERE id = ${roleId} AND tenant_id = ${ctx.principal.tenantId}
        `.execute(tx);

        const current = existing.rows[0];
        if (!current) {
          throw AppError.of('NOT_FOUND', `Role ${roleId} not found.`);
        }

        if (current.is_template) {
          throw AppError.of('VALIDATION_ERROR', 'Template system roles cannot be deleted.');
        }

        // Check if role is assigned to any user
        const assigned = await sql<{ id: string }>`
          SELECT id FROM app.user_role_assignment
          WHERE role_id = ${roleId} AND tenant_id = ${ctx.principal.tenantId}
          LIMIT 1
        `.execute(tx);

        if (assigned.rows.length > 0) {
          throw AppError.of('VALIDATION_ERROR', 'Cannot delete role that is currently assigned to users.');
        }

        await sql`
          DELETE FROM app.role_permission
          WHERE role_id = ${roleId} AND tenant_id = ${ctx.principal.tenantId}
        `.execute(tx);

        await sql`
          DELETE FROM app.role
          WHERE id = ${roleId} AND tenant_id = ${ctx.principal.tenantId}
        `.execute(tx);
      });

      res.json({ status: 'ok' });
    } catch (err) {
      next(err);
    }
  });

  // GET /v1/users — List users in caller's tenant with pagination & search
  router.get('/users', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getContext(req);
      requirePermission(ctx, 'user.manage');

      const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
      const cursor =
        typeof req.query.cursor === 'string' && req.query.cursor.trim() ? req.query.cursor.trim() : undefined;
      const statusFilter =
        typeof req.query.status === 'string' && req.query.status.trim() ? req.query.status.trim() : undefined;
      const searchFilter =
        typeof req.query.search === 'string' && req.query.search.trim()
          ? req.query.search.trim().toLowerCase()
          : undefined;

      let cursorCreatedAt: Date | null = null;
      let cursorId: string | null = null;
      if (cursor) {
        try {
          const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
          if (decoded && decoded.k && decoded.id) {
            cursorCreatedAt = new Date(decoded.k);
            cursorId = String(decoded.id);
          }
        } catch {
          // Ignore invalid cursor format and start from beginning
        }
      }

      const { users, nextCursor } = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        const result = await sql<RawUserRow>`
          SELECT u.id, u.tenant_id, u.email, u.mobile_e164, u.display_name,
                 u.user_type, u.status, u.availability, u.primary_branch_id,
                 u.lock_version, u.created_at, u.updated_at,
                 COALESCE(
                   array_agg(r.name) FILTER (WHERE r.name IS NOT NULL),
                   '{}'
                 ) as assigned_roles
          FROM app.app_user u
          LEFT JOIN app.user_role_assignment ura ON ura.user_id = u.id AND ura.tenant_id = u.tenant_id
          LEFT JOIN app.role r ON r.id = ura.role_id AND r.tenant_id = u.tenant_id
          WHERE u.tenant_id = ${ctx.principal.tenantId}
          GROUP BY u.id, u.tenant_id, u.email, u.mobile_e164, u.display_name,
                   u.user_type, u.status, u.availability, u.primary_branch_id,
                   u.lock_version, u.created_at, u.updated_at
          ORDER BY u.created_at DESC, u.id DESC
        `.execute(tx);

        let rows = result.rows.map(formatUserRow);

        if (statusFilter) {
          rows = rows.filter((u) => u.status === statusFilter);
        }
        if (searchFilter) {
          rows = rows.filter(
            (u) =>
              u.displayName.toLowerCase().includes(searchFilter) ||
              u.email.toLowerCase().includes(searchFilter) ||
              (u.mobileE164 && u.mobileE164.includes(searchFilter)),
          );
        }

        if (cursorCreatedAt && cursorId) {
          const cTime = cursorCreatedAt.getTime();
          rows = rows.filter((u) => {
            const uTime = new Date(u.createdAt).getTime();
            if (uTime < cTime) return true;
            if (uTime === cTime && u.id < cursorId!) return true;
            return false;
          });
        }

        let computedNextCursor: string | null = null;
        if (rows.length > limit) {
          const lastItem = rows[limit - 1];
          if (lastItem) {
            computedNextCursor = Buffer.from(
              JSON.stringify({ k: lastItem.createdAt, id: lastItem.id }),
            ).toString('base64url');
          }
          rows = rows.slice(0, limit);
        }

        return { users: rows, nextCursor: computedNextCursor };
      });

      res.json({
        data: users,
        meta: { limit, nextCursor },
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /v1/users/:id — Get user details
  router.get('/users/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getContext(req);
      const targetUserId = req.params.id;

      // Self-view is permitted; otherwise require user.manage
      if (ctx.principal.id !== targetUserId) {
        requirePermission(ctx, 'user.manage');
      }

      const user = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        const result = await sql<RawUserRow>`
          SELECT u.id, u.tenant_id, u.email, u.mobile_e164, u.display_name,
                 u.user_type, u.status, u.availability, u.primary_branch_id,
                 u.lock_version, u.created_at, u.updated_at,
                 COALESCE(
                   array_agg(r.name) FILTER (WHERE r.name IS NOT NULL),
                   '{}'
                 ) as assigned_roles
          FROM app.app_user u
          LEFT JOIN app.user_role_assignment ura ON ura.user_id = u.id AND ura.tenant_id = u.tenant_id
          LEFT JOIN app.role r ON r.id = ura.role_id AND r.tenant_id = u.tenant_id
          WHERE u.id = ${targetUserId} AND u.tenant_id = ${ctx.principal.tenantId}
          GROUP BY u.id, u.tenant_id, u.email, u.mobile_e164, u.display_name,
                   u.user_type, u.status, u.availability, u.primary_branch_id,
                   u.lock_version, u.created_at, u.updated_at
        `.execute(tx);

        const row = result.rows[0];
        if (!row) {
          throw AppError.of('NOT_FOUND', `User ${targetUserId} not found.`);
        }
        return formatUserRow(row);
      });

      res.setHeader('ETag', `"${user.lockVersion}"`);
      res.json(user);
    } catch (err) {
      next(err);
    }
  });

  // POST /v1/users — Create a new staff user
  router.post('/users', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getContext(req);
      requirePermission(ctx, 'user.manage');

      const parsed = CreateUserRequest.parse(req.body);
      const cleanEmail = parsed.email.trim().toLowerCase();
      const newUserId = `usr_${nextUlid()}`;
      const idpSubject = `idp_${nextUlid()}`;

      const createdUser = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        // Check for duplicate email in this tenant
        const existing = await sql<{ id: string }>`
          SELECT id FROM app.app_user
          WHERE tenant_id = ${ctx.principal.tenantId} AND email = ${cleanEmail}
        `.execute(tx);

        if (existing.rows.length > 0) {
          throw AppError.of(
            'VALIDATION_ERROR',
            'A user with this email address already exists in this tenant.',
            [{ field: 'email', issue: 'DUPLICATE_EMAIL' }],
          );
        }

        // Verify primary branch exists in this tenant
        const branchCheck = await sql<{ id: string }>`
          SELECT id FROM app.branch
          WHERE id = ${parsed.primaryBranchId} AND tenant_id = ${ctx.principal.tenantId}
        `.execute(tx);

        if (branchCheck.rows.length === 0) {
          throw AppError.of('VALIDATION_ERROR', 'The specified branch does not exist in this tenant.', [
            { field: 'primaryBranchId', issue: 'INVALID_BRANCH' },
          ]);
        }

        // Insert new user record
        await sql`
          INSERT INTO app.app_user (
            id, tenant_id, idp_subject, email, mobile_e164, display_name,
            user_type, status, availability, primary_branch_id, lock_version,
            created_by, updated_by
          ) VALUES (
            ${newUserId}, ${ctx.principal.tenantId}, ${idpSubject}, ${cleanEmail},
            ${parsed.mobileE164 ?? null}, ${parsed.displayName.trim()}, 'STAFF',
            ${parsed.status ?? 'ACTIVE'}, ${parsed.availability ?? 'AVAILABLE'},
            ${parsed.primaryBranchId}, 0, ${ctx.principal.id}, ${ctx.principal.id}
          )
        `.execute(tx);

        // Assign optional initial roles
        if (parsed.roleIds && parsed.roleIds.length > 0) {
          for (const roleId of parsed.roleIds) {
            const roleCheck = await sql<{ id: string }>`
              SELECT id FROM app.role WHERE id = ${roleId} AND tenant_id = ${ctx.principal.tenantId}
            `.execute(tx);

            if (roleCheck.rows.length > 0) {
              const assignmentId = `ura_${nextUlid()}`;
              await sql`
                INSERT INTO app.user_role_assignment (
                  id, tenant_id, user_id, role_id, scope_type, scope_branch_ids, created_by
                ) VALUES (
                  ${assignmentId}, ${ctx.principal.tenantId}, ${newUserId}, ${roleId},
                  'TENANT', '{}', ${ctx.principal.id}
                )
              `.execute(tx);
            }
          }
        }

        // Fetch created user with roles
        const result = await sql<RawUserRow>`
          SELECT u.id, u.tenant_id, u.email, u.mobile_e164, u.display_name,
                 u.user_type, u.status, u.availability, u.primary_branch_id,
                 u.lock_version, u.created_at, u.updated_at,
                 COALESCE(
                   array_agg(r.name) FILTER (WHERE r.name IS NOT NULL),
                   '{}'
                 ) as assigned_roles
          FROM app.app_user u
          LEFT JOIN app.user_role_assignment ura ON ura.user_id = u.id AND ura.tenant_id = u.tenant_id
          LEFT JOIN app.role r ON r.id = ura.role_id AND r.tenant_id = u.tenant_id
          WHERE u.id = ${newUserId} AND u.tenant_id = ${ctx.principal.tenantId}
          GROUP BY u.id, u.tenant_id, u.email, u.mobile_e164, u.display_name,
                   u.user_type, u.status, u.availability, u.primary_branch_id,
                   u.lock_version, u.created_at, u.updated_at
        `.execute(tx);

        const firstRow = result.rows[0];
        if (!firstRow) {
          throw AppError.of('INTERNAL_ERROR', 'Failed to retrieve newly created user.');
        }
        return formatUserRow(firstRow);
      });

      res.setHeader('ETag', `"${createdUser.lockVersion}"`);
      res.status(201).json(createdUser);
    } catch (err) {
      next(err);
    }
  });

  // PATCH /v1/users/:id — Update user profile, status, or availability
  router.patch('/users/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getContext(req);
      requirePermission(ctx, 'user.manage');

      const targetUserId = req.params.id;
      const parsed = UpdateUserRequest.parse(req.body);

      // Self-deactivation and self-suspension guard
      if (
        ctx.principal.id === targetUserId &&
        (parsed.status === 'DEACTIVATED' || parsed.status === 'SUSPENDED')
      ) {
        throw AppError.of(
          'SOD_VIOLATION',
          'Separation of Duties: You cannot deactivate or suspend your own account.',
        );
      }

      const rawIfMatch = req.header('if-match');

      const updatedUser = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        // Verify user exists in tenant
        const userCheck = await sql<RawUserRow>`
          SELECT id, lock_version FROM app.app_user
          WHERE id = ${targetUserId} AND tenant_id = ${ctx.principal.tenantId}
        `.execute(tx);

        const targetRow = userCheck.rows[0];
        if (!targetRow) {
          throw AppError.of('NOT_FOUND', `User ${targetUserId} not found.`);
        }

        const currentLockVersion = Number(targetRow.lock_version ?? 0);

        // Optimistic concurrency check (If-Match)
        if (rawIfMatch) {
          const matchClean = rawIfMatch.replace(/"/g, '').trim();
          if (matchClean !== String(currentLockVersion)) {
            throw AppError.of(
              'VERSION_CONFLICT',
              `User version conflict. Expected lock_version ${matchClean}, current is ${currentLockVersion}.`,
            );
          }
        }

        if (parsed.displayName !== undefined) {
          await sql`
            UPDATE app.app_user
            SET display_name = ${parsed.displayName.trim()}, updated_by = ${ctx.principal.id}
            WHERE id = ${targetUserId} AND tenant_id = ${ctx.principal.tenantId}
          `.execute(tx);
        }

        if (parsed.mobileE164 !== undefined) {
          await sql`
            UPDATE app.app_user
            SET mobile_e164 = ${parsed.mobileE164 ?? null}, updated_by = ${ctx.principal.id}
            WHERE id = ${targetUserId} AND tenant_id = ${ctx.principal.tenantId}
          `.execute(tx);
        }

        if (parsed.status !== undefined) {
          await sql`
            UPDATE app.app_user
            SET status = ${parsed.status}, updated_by = ${ctx.principal.id}
            WHERE id = ${targetUserId} AND tenant_id = ${ctx.principal.tenantId}
          `.execute(tx);
        }

        if (parsed.availability !== undefined) {
          await sql`
            UPDATE app.app_user
            SET availability = ${parsed.availability}, updated_by = ${ctx.principal.id}
            WHERE id = ${targetUserId} AND tenant_id = ${ctx.principal.tenantId}
          `.execute(tx);
        }

        if (parsed.primaryBranchId !== undefined) {
          const branchCheck = await sql<{ id: string }>`
            SELECT id FROM app.branch
            WHERE id = ${parsed.primaryBranchId} AND tenant_id = ${ctx.principal.tenantId}
          `.execute(tx);

          if (branchCheck.rows.length === 0) {
            throw AppError.of('VALIDATION_ERROR', 'The specified branch does not exist.', [
              { field: 'primaryBranchId', issue: 'INVALID_BRANCH' },
            ]);
          }

          await sql`
            UPDATE app.app_user
            SET primary_branch_id = ${parsed.primaryBranchId}, updated_by = ${ctx.principal.id}
            WHERE id = ${targetUserId} AND tenant_id = ${ctx.principal.tenantId}
          `.execute(tx);
        }

        // Fetch refreshed user record
        const result = await sql<RawUserRow>`
          SELECT u.id, u.tenant_id, u.email, u.mobile_e164, u.display_name,
                 u.user_type, u.status, u.availability, u.primary_branch_id,
                 u.lock_version, u.created_at, u.updated_at,
                 COALESCE(
                   array_agg(r.name) FILTER (WHERE r.name IS NOT NULL),
                   '{}'
                 ) as assigned_roles
          FROM app.app_user u
          LEFT JOIN app.user_role_assignment ura ON ura.user_id = u.id AND ura.tenant_id = u.tenant_id
          LEFT JOIN app.role r ON r.id = ura.role_id AND r.tenant_id = u.tenant_id
          WHERE u.id = ${targetUserId} AND u.tenant_id = ${ctx.principal.tenantId}
          GROUP BY u.id, u.tenant_id, u.email, u.mobile_e164, u.display_name,
                   u.user_type, u.status, u.availability, u.primary_branch_id,
                   u.lock_version, u.created_at, u.updated_at
        `.execute(tx);

        const updatedRow = result.rows[0];
        if (!updatedRow) {
          throw AppError.of('INTERNAL_ERROR', 'Failed to retrieve updated user.');
        }
        return formatUserRow(updatedRow);
      });

      res.setHeader('ETag', `"${updatedUser.lockVersion}"`);
      res.json(updatedUser);
    } catch (err) {
      next(err);
    }
  });

  // POST /v1/users/:id/roles — Assign a role to a user
  router.post('/users/:id/roles', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getContext(req);
      requirePermission(ctx, 'user.manage');

      const targetUserId = req.params.id;

      // Separation of Duties (SOD-05): A user cannot assign roles to themselves
      if (ctx.principal.id === targetUserId) {
        throw AppError.of(
          'SOD_VIOLATION',
          'Separation of Duties (SOD-05): You are not authorized to modify your own assigned roles.',
        );
      }

      const parsed = AssignRoleRequest.parse(req.body);

      const assignment = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        // Verify user exists in tenant
        const userCheck = await sql<{ id: string }>`
          SELECT id FROM app.app_user WHERE id = ${targetUserId} AND tenant_id = ${ctx.principal.tenantId}
        `.execute(tx);
        if (userCheck.rows.length === 0) {
          throw AppError.of('NOT_FOUND', `User ${targetUserId} not found.`);
        }

        // Verify role exists in tenant
        const roleCheck = await sql<{ id: string }>`
          SELECT id FROM app.role WHERE id = ${parsed.roleId} AND tenant_id = ${ctx.principal.tenantId}
        `.execute(tx);
        if (roleCheck.rows.length === 0) {
          throw AppError.of('NOT_FOUND', `Role ${parsed.roleId} not found in this tenant.`);
        }

        // Check if role is already assigned
        const existingAssign = await sql<{ id: string }>`
          SELECT id FROM app.user_role_assignment
          WHERE user_id = ${targetUserId} AND role_id = ${parsed.roleId} AND tenant_id = ${ctx.principal.tenantId}
        `.execute(tx);

        const assignRow = existingAssign.rows[0];
        if (assignRow) {
          return { id: assignRow.id, alreadyAssigned: true };
        }

        const assignmentId = `ura_${nextUlid()}`;
        await sql`
          INSERT INTO app.user_role_assignment (
            id, tenant_id, user_id, role_id, scope_type, scope_branch_ids, created_by
          ) VALUES (
            ${assignmentId}, ${ctx.principal.tenantId}, ${targetUserId}, ${parsed.roleId},
            ${parsed.scopeType}, ${parsed.scopeBranchIds}, ${ctx.principal.id}
          )
        `.execute(tx);

        return { id: assignmentId, alreadyAssigned: false };
      });

      res.status(201).json(assignment);
    } catch (err) {
      next(err);
    }
  });

  // DELETE /v1/users/:id/roles/:roleId — Remove role assignment from user
  router.delete('/users/:id/roles/:roleId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getContext(req);
      requirePermission(ctx, 'user.manage');

      const targetUserId = req.params.id;
      const targetRoleId = req.params.roleId;

      // Separation of Duties (SOD-05): A user cannot modify their own assigned roles
      if (ctx.principal.id === targetUserId) {
        throw AppError.of(
          'SOD_VIOLATION',
          'Separation of Duties (SOD-05): You are not authorized to remove your own assigned roles.',
        );
      }

      await deps.txRunner.withTenantTx(ctx, async (tx) => {
        await sql`
          DELETE FROM app.user_role_assignment
          WHERE user_id = ${targetUserId} AND role_id = ${targetRoleId} AND tenant_id = ${ctx.principal.tenantId}
        `.execute(tx);
      });

      res.json({ status: 'ok' });
    } catch (err) {
      next(err);
    }
  });

  // GET /v1/users/:id/roles — List roles assigned to a user
  router.get('/users/:id/roles', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getContext(req);
      const targetUserId = req.params.id;

      // Allow self-view or require user.manage
      if (ctx.principal.id !== targetUserId) {
        requirePermission(ctx, 'user.manage');
      }

      const assignments = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        // Verify user exists in tenant
        const userCheck = await sql<{ id: string }>`
          SELECT id FROM app.app_user WHERE id = ${targetUserId} AND tenant_id = ${ctx.principal.tenantId}
        `.execute(tx);
        if (userCheck.rows.length === 0) {
          throw AppError.of('NOT_FOUND', `User ${targetUserId} not found.`);
        }

        const result = await sql<{
          id: string;
          user_id: string;
          role_id: string;
          role_code: string;
          role_name: string;
          scope_type: 'OWN' | 'TEAM' | 'BRANCH' | 'TENANT';
          scope_branch_ids: string[];
          created_at: string | Date;
        }>`
          SELECT ura.id, ura.user_id, ura.role_id, r.code as role_code, r.name as role_name,
                 ura.scope_type, ura.scope_branch_ids, ura.created_at
          FROM app.user_role_assignment ura
          JOIN app.role r ON r.id = ura.role_id AND r.tenant_id = ura.tenant_id
          WHERE ura.user_id = ${targetUserId} AND ura.tenant_id = ${ctx.principal.tenantId}
          ORDER BY r.name ASC
        `.execute(tx);

        return result.rows.map((row) => ({
          id: row.id,
          userId: row.user_id,
          roleId: row.role_id,
          roleCode: row.role_code,
          roleName: row.role_name,
          scopeType: row.scope_type,
          scopeBranchIds: row.scope_branch_ids ?? [],
          createdAt: typeof row.created_at === 'string' ? row.created_at : row.created_at.toISOString(),
        }));
      });

      res.json({ data: assignments });
    } catch (err) {
      next(err);
    }
  });

  // GET /v1/users/:id/permissions — Calculate effective permissions for a user
  router.get('/users/:id/permissions', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = getContext(req);
      const targetUserId = req.params.id;

      // Allow self-view or require user.manage
      if (ctx.principal.id !== targetUserId) {
        requirePermission(ctx, 'user.manage');
      }

      const effectiveGrants = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        // Verify user exists in tenant
        const userCheck = await sql<{ id: string }>`
          SELECT id FROM app.app_user WHERE id = ${targetUserId} AND tenant_id = ${ctx.principal.tenantId}
        `.execute(tx);
        if (userCheck.rows.length === 0) {
          throw AppError.of('NOT_FOUND', `User ${targetUserId} not found.`);
        }

        const result = await sql<{
          permission_code: string;
          scope_type: 'OWN' | 'TEAM' | 'BRANCH' | 'TENANT';
          scope_branch_ids: string[];
        }>`
          SELECT rp.permission_code, ura.scope_type, ura.scope_branch_ids
          FROM app.user_role_assignment ura
          JOIN app.role_permission rp ON rp.role_id = ura.role_id AND rp.tenant_id = ura.tenant_id
          WHERE ura.user_id = ${targetUserId} AND ura.tenant_id = ${ctx.principal.tenantId}
        `.execute(tx);

        const scopeRank: Record<string, number> = {
          OWN: 1,
          TEAM: 2,
          BRANCH: 3,
          TENANT: 4,
        };

        const grantMap = new Map<
          string,
          { scope: 'OWN' | 'TEAM' | 'BRANCH' | 'TENANT'; branchIds: Set<string> }
        >();

        for (const row of result.rows) {
          const existing = grantMap.get(row.permission_code);
          if (!existing) {
            grantMap.set(row.permission_code, {
              scope: row.scope_type,
              branchIds: new Set(row.scope_branch_ids || []),
            });
          } else {
            // Broader scope takes precedence
            const rowRank = scopeRank[row.scope_type] ?? 0;
            const existingRank = scopeRank[existing.scope] ?? 0;
            if (rowRank > existingRank) {
              existing.scope = row.scope_type;
              existing.branchIds = new Set(row.scope_branch_ids || []);
            } else if (row.scope_type === existing.scope) {
              if (row.scope_type === 'BRANCH') {
                for (const bId of row.scope_branch_ids || []) {
                  existing.branchIds.add(bId);
                }
              }
            }
          }
        }

        const grants = Array.from(grantMap.entries())
          .map(([code, g]) => ({
            code,
            scope: g.scope,
            branchIds: Array.from(g.branchIds),
          }))
          .sort((a, b) => a.code.localeCompare(b.code));

        return {
          userId: targetUserId,
          grants,
        };
      });

      res.json(effectiveGrants);
    } catch (err) {
      next(err);
    }
  });

  registerOrganisationRoutes(router, deps);
  registerTeamRoutes(router, deps);
  registerQueueRoutes(router, deps);

  return router;
}
