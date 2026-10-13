// MOD-TEN read model and MOD-ORG organisation (owner: Dev 1).
// API-TEN (caller's tenant, read-only) · API-ORG-001 GET /v1/organisations · API-ORG-002 PATCH /v1/organisations/{id}.
// /v1/tenant: any signed-in user. Organisations (read and write): config.manage — the profile is S2/S3 data.
import { AppError } from '@dsa/contracts';
import type { Router } from 'express';
import { sql } from 'kysely';
import { ifMatchVersion, requireCtx, sendResource } from '../../http/request';
import type { ApiDeps } from '../types';
import { iso, loadForUpdate, updateVersioned, type Row } from './db';
import { OrganisationPatch, type Organisation, type Tenant } from './schemas';

const toTenant = (r: Row): Tenant => ({
  id: String(r.id),
  slug: String(r.slug),
  legalName: String(r.legal_name),
  tenantType: String(r.tenant_type),
  dataRegion: String(r.data_region),
  timezone: String(r.timezone),
  status: String(r.status),
  createdAt: iso(r.created_at),
});

const toOrganisation = (r: Row): Organisation => ({
  id: String(r.id),
  legalName: String(r.legal_name),
  constitution: r.constitution as Organisation['constitution'],
  status: String(r.status),
  version: Number(r.lock_version),
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

export function registerOrganisationRoutes(router: Router, deps: ApiDeps): void {
  router.get('/tenant', async (req, res) => {
    const ctx = requireCtx(req);
    const tenant = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const r = await sql<Row>`select * from tenant where id = ${ctx.principal.tenantId}`.execute(tx);
      return r.rows[0];
    });
    if (!tenant) throw AppError.of('NOT_FOUND', 'Tenant not found.');
    res.json(toTenant(tenant));
  });

  router.get('/organisations', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'config.manage');
    const rows = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const r = await sql<Row>`select * from organisation order by created_at, id limit 200`.execute(tx);
      return r.rows;
    });
    res.json({ data: rows.map(toOrganisation), meta: { nextCursor: null, limit: 200 } });
  });

  router.get('/organisations/:id', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'config.manage');
    const row = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const r = await sql<Row>`select * from organisation where id = ${req.params.id}`.execute(tx);
      return r.rows[0];
    });
    if (!row) throw AppError.of('NOT_FOUND', 'Organisation not found.');
    sendResource(res, 200, toOrganisation(row));
  });

  router.patch('/organisations/:id', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'config.manage');
    const version = ifMatchVersion(req);
    const input = OrganisationPatch.parse(req.body);

    const updated = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const current = await loadForUpdate(tx, 'organisation', req.params.id, 'Organisation');
      const row = await updateVersioned(tx, ctx, 'organisation', current, version, {
        legal_name: input.legalName,
        constitution: input.constitution,
      });
      await deps.audit.record(tx, ctx, {
        action: 'organisation.updated',
        entityType: 'ORGANISATION',
        entityId: String(row.id),
        before: { legalName: current.legal_name, constitution: current.constitution },
        after: { legalName: row.legal_name, constitution: row.constitution },
        permissionUsed: 'config.manage',
      });
      return row;
    });
    sendResource(res, 200, toOrganisation(updated));
  });
}
