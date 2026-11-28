// MOD-LND lender pack profile (owner: Dipanshu; task P2-04, migration M-121). How one lender wants its submission pack: the
// document type order and the file name pattern. A lender without a row uses defaultPackProfile (version 0).
//   GET /v1/lenders/{id}/pack-profile               lender.read, lender.manage, config.manage or lender_case.submit
//   PUT /v1/lenders/{id}/pack-profile (If-Match)    lender.manage or config.manage; If-Match "0" creates the lender's profile
// Every write is audited in the same transaction (Contracts §4.1). A profile holds document type codes and a pattern only.
import {
  AppError,
  LenderPackProfilePutSchema,
  defaultPackProfile,
  type LenderPackProfile,
  type Tx,
} from '@dsa/contracts';
import type { Router } from 'express';
import { sql } from 'kysely';
import { hasAnyPermission, requireAnyPermission } from '../../../http/permissions';
import { ifMatchVersion, requireCtx, sendResource } from '../../../http/request';
import type { ApiDeps } from '../../types';
import { iso, type Row } from './db';

export const toPackProfile = (r: Row): LenderPackProfile => ({
  lenderId: String(r.lender_id),
  isDefault: false,
  documentOrder: (r.document_order as string[]) ?? [],
  filenamePattern: String(r.filename_pattern),
  version: Number(r.lock_version),
  updatedAt: iso(r.updated_at),
  updatedBy: String(r.updated_by),
});

/** The lender's profile, or the default when it has none. null when the lender is not in the caller's tenant. */
export async function loadPackProfile(
  tx: Tx,
  lenderId: string,
  forUpdate = false,
): Promise<LenderPackProfile | null> {
  const lender = forUpdate
    ? await sql<Row>`select id from lender where id = ${lenderId} for update`.execute(tx)
    : await sql<Row>`select id from lender where id = ${lenderId}`.execute(tx);
  if (!lender.rows[0]) return null;
  const r = await sql<Row>`select * from lender_pack_profile where lender_id = ${lenderId}`.execute(tx);
  return r.rows[0] ? toPackProfile(r.rows[0]) : defaultPackProfile(lenderId);
}

export function registerLenderPackProfileRoutes(router: Router, deps: ApiDeps): void {
  router.get('/lenders/:id/pack-profile', async (req, res) => {
    const ctx = requireCtx(req);
    requireAnyPermission(deps.authz, ctx, [
      'lender.read',
      'lender.manage',
      'config.manage',
      'lender_case.submit',
    ]);
    const profile = await deps.txRunner.withTenantTx(ctx, (tx) => loadPackProfile(tx, req.params.id));
    if (!profile) throw AppError.of('NOT_FOUND', 'Lender not found.');
    sendResource(res, 200, profile);
  });

  router.put('/lenders/:id/pack-profile', async (req, res) => {
    const ctx = requireCtx(req);
    requireAnyPermission(deps.authz, ctx, ['lender.manage', 'config.manage']);
    const version = ifMatchVersion(req);
    const input = LenderPackProfilePutSchema.parse(req.body);

    const profile = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      // Locking the lender row serialises the first save, so two "If-Match: 0" saves cannot both insert.
      const before = await loadPackProfile(tx, req.params.id, true);
      if (!before) throw AppError.of('NOT_FOUND', 'Lender not found.');
      if (before.version !== version) {
        throw AppError.of(
          'VERSION_CONFLICT',
          'The pack profile was changed by someone else. Reload and try again.',
          [{ field: 'If-Match', issue: 'STALE', meta: { currentVersion: before.version } }],
        );
      }
      const order = JSON.stringify(input.documentOrder);
      const r = before.isDefault
        ? await sql<Row>`
            insert into lender_pack_profile (id, tenant_id, lender_id, document_order, filename_pattern, lock_version,
                                             created_by, updated_by)
            values (${deps.ids.next('lpp')}, ${ctx.principal.tenantId}, ${req.params.id}, ${order}::jsonb,
                    ${input.filenamePattern}, 1, ${ctx.principal.id}, ${ctx.principal.id})
            returning *`.execute(tx)
        : await sql<Row>`
            update lender_pack_profile
               set document_order = ${order}::jsonb, filename_pattern = ${input.filenamePattern}, updated_by = ${ctx.principal.id}
             where lender_id = ${req.params.id}
            returning *`.execute(tx);
      const after = toPackProfile(r.rows[0]!);
      await deps.audit.record(tx, ctx, {
        action: before.isDefault ? 'lender_pack_profile.created' : 'lender_pack_profile.updated',
        entityType: 'LENDER',
        entityId: req.params.id,
        before: before.isDefault
          ? undefined
          : { documentOrder: before.documentOrder, filenamePattern: before.filenamePattern },
        after: { documentOrder: after.documentOrder, filenamePattern: after.filenamePattern },
        permissionUsed: hasAnyPermission(deps.authz, ctx, ['lender.manage'])
          ? 'lender.manage'
          : 'config.manage',
      });
      return after;
    });
    sendResource(res, 200, profile);
  });
}
