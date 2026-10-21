// MOD-TEN tenant lifecycle on the platform surface (owner: Dev 1; DSA Notion MODULE 1; M-082). Platform realm only.
//   API-TEN-001 POST /platform/v1/tenants                     platform.tenant.create; Idempotency-Key; 409 TENANT_SLUG_TAKEN.
//               Creates the tenant, organisation, head-office branch, a ROLE-TENANT-ADMIN role and the first administrator
//               as INVITED. The Auth account (with app_metadata.tenant_id) is created by the operator tool; the user is bound
//               to it at first sign-in with the invited email.
//   API-TEN-003 POST /platform/v1/tenants/{id}/suspension     platform.tenant.suspend; Idempotency-Key; reason
//   API-TEN-004 POST /platform/v1/tenants/{id}/reactivation   platform.tenant.suspend; Idempotency-Key; reason
//   API-TEN-005 POST /platform/v1/tenants/{id}/offboarding    platform.tenant.offboard; Idempotency-Key; two approvers: the
//               first call records the request (202), a different operator's call moves the tenant to OFFBOARDING (200).
//   API-TEN-006 PUT  /platform/v1/tenants/{id}/entitlements   platform.tenant.entitlements; If-Match (entitlements version)
// Every change needs a recent authenticator check (step-up) and is audited in the platform tenant's trail.
import { AppError, type PermissionCode, type RequestContext, type Tx } from '@dsa/contracts';
import { withIdempotency } from '@dsa/kernel';
import type { Router } from 'express';
import { sql } from 'kysely';
import { z } from 'zod';
import { idempotencyKey, ifMatchVersion, requireCtx } from '../../http/request';
import type { ApiDeps } from '../types';

/** Module codes a tenant can be entitled to; the gate in app.ts maps request paths to them. */
export const ENTITLEMENT_MODULES = [
  'MOD-WFA',
  'MOD-COM',
  'MOD-PAY',
  'MOD-REC',
  'MOD-INV',
  'MOD-LED',
  'MOD-RPT',
  'MOD-IMP',
  'MOD-CON',
  'MOD-CPT',
  'MOD-PERF',
  'MOD-VER',
  'MOD-DSH',
  'MOD-API',
] as const;

const Reason = z.string().trim().min(3).max(500);

export const TenantProvision = z
  .object({
    slug: z.string().regex(/^[a-z0-9-]{3,40}$/),
    legalName: z.string().trim().min(3).max(200),
    tenantType: z.enum(['DSA_ORG', 'NBFC_DISTRIBUTION']),
    dataRegion: z.literal('IN').default('IN'),
    timezone: z
      .string()
      .regex(/^[A-Za-z]+\/[A-Za-z_]+$/)
      .default('Asia/Kolkata'),
    admin: z.object({ email: z.string().email(), displayName: z.string().trim().min(2).max(100) }).strict(),
  })
  .strict();
export const TenantStatusChange = z.object({ reason: Reason }).strict();
export const TenantEntitlementsPut = z
  .object({ modules: z.record(z.enum(ENTITLEMENT_MODULES), z.boolean()) })
  .strict();

type Guard = (ctx: RequestContext, code: PermissionCode) => Promise<void>;

/** P0001 raised by the M-082 functions carries the API error code in its hint. */
function mapDbError(err: unknown): never {
  const e = err as { code?: string; hint?: string; message?: string };
  if (e?.code === '23505') throw AppError.of('TENANT_SLUG_TAKEN', 'That tenant slug is already taken.');
  if (e?.code === 'P0001' && e.hint) {
    const code = e.hint as 'INVALID_TRANSITION' | 'INVALID_STATE' | 'SOD_VIOLATION' | 'VERSION_CONFLICT';
    throw AppError.of(code, (e.message ?? 'Refused.').replace(/^.*?: /, ''));
  }
  throw err;
}

async function audit(
  deps: ApiDeps,
  tx: Tx,
  ctx: RequestContext,
  action: string,
  tenantId: string,
  extra: object,
  code: string,
) {
  await deps.audit.record(tx, ctx, {
    action,
    entityType: 'TENANT',
    entityId: tenantId,
    permissionUsed: code,
    ...extra,
  });
}

export function registerTenantLifecycleRoutes(router: Router, deps: ApiDeps, requirePlatform: Guard): void {
  // API-TEN-001
  router.post('/v1/tenants', async (req, res) => {
    const ctx = requireCtx(req);
    await requirePlatform(ctx, 'platform.tenant.create');
    deps.authz.requireStepUp(ctx);
    const key = idempotencyKey(req);
    const input = TenantProvision.parse(req.body);
    const result = await deps.txRunner
      .withTenantTx(ctx, (tx) =>
        withIdempotency(
          tx,
          ctx,
          { key, method: 'POST', path: '/platform/v1/tenants', body: input },
          async () => {
            const r = await sql<{ tenant_id: string; admin_user_id: string }>`
            select * from app.platform_provision_tenant(${input.slug}, ${input.legalName}, ${input.tenantType}, ${input.dataRegion},
                                                        ${input.timezone}, ${input.admin.email}, ${input.admin.displayName},
                                                        ${ctx.principal.id})`.execute(tx);
            const row = r.rows[0]!;
            await audit(
              deps,
              tx,
              ctx,
              'tenant.provisioned',
              row.tenant_id,
              { after: { slug: input.slug, tenantType: input.tenantType } },
              'platform.tenant.create',
            );
            const body = {
              id: row.tenant_id,
              slug: input.slug,
              legalName: input.legalName,
              tenantType: input.tenantType,
              status: 'ACTIVE',
              adminUserId: row.admin_user_id,
              adminStatus: 'INVITED',
            };
            return { status: 201, body, resourceRef: row.tenant_id };
          },
        ),
      )
      .catch(mapDbError);
    if (result.replayed) res.set('Idempotent-Replayed', 'true');
    res.status(result.status).json(result.body);
  });

  for (const [suffix, status, action] of [
    ['suspension', 'SUSPENDED', 'tenant.suspended'],
    ['reactivation', 'ACTIVE', 'tenant.reactivated'],
  ] as const) {
    // API-TEN-003, API-TEN-004
    router.post(`/v1/tenants/:id/${suffix}`, async (req, res) => {
      const ctx = requireCtx(req);
      await requirePlatform(ctx, 'platform.tenant.suspend');
      deps.authz.requireStepUp(ctx);
      const key = idempotencyKey(req);
      const input = TenantStatusChange.parse(req.body);
      const result = await deps.txRunner
        .withTenantTx(ctx, (tx) =>
          withIdempotency(
            tx,
            ctx,
            { key, method: 'POST', path: `/platform/v1/tenants/${req.params.id}/${suffix}`, body: input },
            async () => {
              const r = await sql<{ id: string; status: string }>`
              select * from app.platform_set_tenant_status(${req.params.id}, ${status}, ${input.reason}, ${ctx.principal.id})`.execute(
                tx,
              );
              if (!r.rows[0]) throw AppError.of('NOT_FOUND', 'Tenant not found.');
              await audit(
                deps,
                tx,
                ctx,
                action,
                req.params.id,
                { after: { status }, reason: input.reason },
                'platform.tenant.suspend',
              );
              return { status: 200, body: { id: req.params.id, status } };
            },
          ),
        )
        .catch(mapDbError);
      res.status(result.status).json(result.body);
    });
  }

  // API-TEN-005
  router.post('/v1/tenants/:id/offboarding', async (req, res) => {
    const ctx = requireCtx(req);
    await requirePlatform(ctx, 'platform.tenant.offboard');
    deps.authz.requireStepUp(ctx);
    const key = idempotencyKey(req);
    const input = TenantStatusChange.parse(req.body);
    const result = await deps.txRunner
      .withTenantTx(ctx, (tx) =>
        withIdempotency(
          tx,
          ctx,
          { key, method: 'POST', path: `/platform/v1/tenants/${req.params.id}/offboarding`, body: input },
          async () => {
            const r = await sql<{ offboarding_id: string; state: string }>`
            select * from app.platform_request_offboarding(${req.params.id}, ${input.reason}, ${ctx.principal.id})`.execute(
              tx,
            );
            const row = r.rows[0];
            if (!row) throw AppError.of('NOT_FOUND', 'Tenant not found.');
            const approved = row.state === 'OFFBOARDING';
            await audit(
              deps,
              tx,
              ctx,
              approved ? 'tenant.offboarding_approved' : 'tenant.offboarding_requested',
              req.params.id,
              { after: { state: row.state, offboardingId: row.offboarding_id }, reason: input.reason },
              'platform.tenant.offboard',
            );
            return {
              status: approved ? 200 : 202,
              body: { id: req.params.id, offboardingId: row.offboarding_id, state: row.state },
            };
          },
        ),
      )
      .catch(mapDbError);
    res.status(result.status).json(result.body);
  });

  // API-TEN-006
  router.put('/v1/tenants/:id/entitlements', async (req, res) => {
    const ctx = requireCtx(req);
    await requirePlatform(ctx, 'platform.tenant.entitlements');
    deps.authz.requireStepUp(ctx);
    const version = ifMatchVersion(req);
    const input = TenantEntitlementsPut.parse(req.body);
    const body = await deps.txRunner
      .withTenantTx(ctx, async (tx) => {
        const r = await sql<{
          id: string;
          entitlements: Record<string, boolean>;
          entitlements_version: number;
        }>`
          select * from app.platform_set_entitlements(${req.params.id}, ${JSON.stringify(input.modules)}::jsonb, ${version},
                                                      ${ctx.principal.id})`.execute(tx);
        const row = r.rows[0];
        if (!row) throw AppError.of('NOT_FOUND', 'Tenant not found.');
        await audit(
          deps,
          tx,
          ctx,
          'tenant.entitlements_set',
          req.params.id,
          { after: { modules: input.modules } },
          'platform.tenant.entitlements',
        );
        return { id: row.id, modules: row.entitlements, version: Number(row.entitlements_version) };
      })
      .catch(mapDbError);
    res.set('ETag', `"${body.version}"`);
    res.json(body);
  });
}
