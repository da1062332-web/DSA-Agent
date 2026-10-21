// MOD-LCS lender reason map (owner: Dev 3; DSA Notion SUB-LCS.05, API-LND-007; M-079).
//   GET /v1/lenders/{id}/reason-map   the map (any signed-in staff)
//   PUT /v1/lenders/{id}/reason-map   replace it (config.manage; If-Match on the lender version)
// Each entry maps the lender's own decline wording to one normalised decline reason code (lender_case.decline_reason_code).
// mapLenderReason() is what a status update uses to normalise a reason; the match ignores case and surrounding spaces.
import { AppError } from '@dsa/contracts';
import type { Router } from 'express';
import { sql } from 'kysely';
import { z } from 'zod';
import { ifMatchVersion, requireCtx, sendResource } from '../../../http/request';
import type { ApiDeps } from '../../types';
import { loadForUpdate, updateVersioned, type Row } from './db';

export const DECLINE_REASON_CODES = [
  'POLICY',
  'INCOME',
  'CREDIT_HISTORY',
  'DOCUMENTATION',
  'LOCATION',
  'CUSTOMER_DECLINED',
  'OTHER',
] as const;

const NO_S3 = [/[A-Z]{5}[0-9]{4}[A-Z]/i, /\b\d{4}\s?\d{4}\s?\d{4}\b/, /\b\d{9,18}\b/];

export const ReasonMapPut = z
  .object({
    mappings: z
      .array(
        z
          .object({
            lenderReason: z
              .string()
              .trim()
              .min(2)
              .max(100)
              .refine((s) => !NO_S3.some((p) => p.test(s)), 'must not contain identity or account numbers'),
            reasonCode: z.enum(DECLINE_REASON_CODES),
          })
          .strict(),
      )
      .max(200),
  })
  .strict()
  .refine((b) => new Set(b.mappings.map((m) => m.lenderReason.toLowerCase())).size === b.mappings.length, {
    message: 'each lenderReason may appear once',
  });

type Mapping = { lenderReason: string; reasonCode: (typeof DECLINE_REASON_CODES)[number] };

/** The normalised code for a lender's wording, or OTHER when the map has no entry. */
export function mapLenderReason(map: Mapping[], lenderReason: string): Mapping['reasonCode'] {
  const k = lenderReason.trim().toLowerCase();
  return map.find((m) => m.lenderReason.toLowerCase() === k)?.reasonCode ?? 'OTHER';
}

const toBody = (r: Row) => ({
  lenderId: String(r.id),
  mappings: (r.reason_map as Mapping[]) ?? [],
  version: Number(r.lock_version),
});

export function registerReasonMapRoutes(router: Router, deps: ApiDeps): void {
  router.get('/lenders/:id/reason-map', async (req, res) => {
    const ctx = requireCtx(req);
    const row = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const r =
        await sql<Row>`select id, reason_map, lock_version from lender where id = ${req.params.id}`.execute(
          tx,
        );
      if (!r.rows[0]) throw AppError.of('NOT_FOUND', 'Lender not found.');
      return r.rows[0];
    });
    sendResource(res, 200, toBody(row));
  });

  // API-LND-007
  router.put('/lenders/:id/reason-map', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'config.manage');
    const version = ifMatchVersion(req);
    const input = ReasonMapPut.parse(req.body);
    const row = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const lender = await loadForUpdate(tx, 'lender', req.params.id, 'Lender');
      const updated = await updateVersioned(tx, ctx.principal.id, 'lender', lender, version, {
        reason_map: JSON.stringify(input.mappings),
      });
      await deps.audit.record(tx, ctx, {
        action: 'lender.reason_map_changed',
        entityType: 'LENDER',
        entityId: String(lender.id),
        before: { entries: ((lender.reason_map as Mapping[]) ?? []).length },
        after: { entries: input.mappings.length },
        permissionUsed: 'config.manage',
      });
      return updated;
    });
    sendResource(res, 200, toBody(row));
  });
}
