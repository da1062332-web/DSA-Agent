// MOD-BRE reference lists (owner: Dev 2; DSA Notion SUB-BRE.09; M-080).
//   API-BRE-028 GET  /v1/reference-lists                      rule.author (or rule.simulate); lists with their versions
//   API-BRE-029 POST /v1/reference-lists/{listId}/versions    config.manage; Idempotency-Key. Publishes the next version.
// {listId} is a list id, or the code of a new list; a new list also needs name and valueType in the body. Up to 1,000
// values per version, each matching the list's value type (VALIDATION_ERROR with LIST_TOO_LARGE or TYPE_MISMATCH).
// Published versions are immutable (M-080 trigger) and kept while any rule may reference them.
import crypto from 'node:crypto';
import { AppError, type RequestContext } from '@dsa/contracts';
import { withIdempotency } from '@dsa/kernel';
import type { Router } from 'express';
import { sql } from 'kysely';
import { z } from 'zod';
import { idempotencyKey, requireCtx } from '../../../http/request';
import type { ApiDeps } from '../../types';

type Row = Record<string, unknown>;
const VALUE_TYPES = ['STRING', 'NUMBER', 'PINCODE', 'CODE'] as const;
const MAX_VALUES = 1000;

export const ReferenceListVersionCreate = z
  .object({
    values: z.array(z.union([z.string(), z.number()])),
    name: z.string().trim().min(3).max(120).optional(),
    valueType: z.enum(VALUE_TYPES).optional(),
  })
  .strict();

const fits: Record<(typeof VALUE_TYPES)[number], (v: unknown) => boolean> = {
  STRING: (v) => typeof v === 'string' && v.length >= 1 && v.length <= 200,
  NUMBER: (v) => typeof v === 'number' && Number.isFinite(v),
  PINCODE: (v) => typeof v === 'string' && /^[1-9][0-9]{5}$/.test(v),
  CODE: (v) => typeof v === 'string' && /^[A-Z0-9_]{1,40}$/.test(v),
};

function requireAny(ctx: RequestContext, codes: string[]): void {
  if (!ctx.principal.grants.some((g) => codes.includes(g.code))) {
    throw AppError.of('FORBIDDEN', `Permission denied: ${codes.join(' or ')} required.`);
  }
}

export function registerReferenceListRoutes(router: Router, deps: ApiDeps): void {
  // API-BRE-028
  router.get('/reference-lists', async (req, res) => {
    const ctx = requireCtx(req);
    requireAny(ctx, ['rule.author', 'rule.simulate']);
    const data = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const lists = await sql<Row>`select * from reference_list order by code`.execute(tx);
      const versions = await sql<Row>`
        select id, list_id, version_no, value_count, content_hash, published_by, published_at
          from reference_list_version order by list_id, version_no desc`.execute(tx);
      return lists.rows.map((l) => ({
        id: String(l.id),
        code: String(l.code),
        name: String(l.name),
        valueType: String(l.value_type),
        versions: versions.rows
          .filter((v) => v.list_id === l.id)
          .map((v) => ({
            id: String(v.id),
            versionNo: Number(v.version_no),
            valueCount: Number(v.value_count),
            contentHash: String(v.content_hash),
            publishedBy: String(v.published_by),
            publishedAt: new Date(String(v.published_at)).toISOString(),
          })),
      }));
    });
    res.json({ data, meta: { nextCursor: null, limit: data.length } });
  });

  // API-BRE-029
  router.post('/reference-lists/:listId/versions', async (req, res) => {
    const ctx = requireCtx(req);
    requireAny(ctx, ['config.manage']);
    const key = idempotencyKey(req);
    const input = ReferenceListVersionCreate.parse(req.body);
    if (input.values.length > MAX_VALUES) {
      throw AppError.of('VALIDATION_ERROR', `A list version holds at most ${MAX_VALUES} values.`, [
        { field: 'values', issue: 'LIST_TOO_LARGE', meta: { max: MAX_VALUES } },
      ]);
    }
    const listRef = req.params.listId;
    const result = await deps.txRunner.withTenantTx(ctx, (tx) =>
      withIdempotency(
        tx,
        ctx,
        { key, method: 'POST', path: `/v1/reference-lists/${listRef}/versions`, body: input },
        async () => {
          let list = (
            await sql<Row>`select * from reference_list where id = ${listRef} or code = ${listRef}`.execute(
              tx,
            )
          ).rows[0];
          if (!list) {
            if (!/^[A-Z][A-Z0-9_]{2,40}$/.test(listRef) || !input.name || !input.valueType) {
              throw AppError.of(
                'NOT_FOUND',
                'Reference list not found. A new list needs a code in the path, a name and a valueType.',
              );
            }
            list = (
              await sql<Row>`
              insert into reference_list (id, tenant_id, code, name, value_type, created_by)
              values (${deps.ids.next('rfl')}, ${ctx.principal.tenantId}, ${listRef}, ${input.name}, ${input.valueType}, ${ctx.principal.id})
              returning *`.execute(tx)
            ).rows[0]!;
          } else if (input.valueType && input.valueType !== list.value_type) {
            throw AppError.of('VALIDATION_ERROR', 'The value type of a list cannot change.', [
              { field: 'valueType', issue: 'TYPE_MISMATCH' },
            ]);
          }
          const type = list.value_type as (typeof VALUE_TYPES)[number];
          const bad = input.values.findIndex((v) => !fits[type](v));
          if (bad >= 0) {
            throw AppError.of('VALIDATION_ERROR', `Every value must be a ${type}.`, [
              { field: `values.${bad}`, issue: 'TYPE_MISMATCH' },
            ]);
          }
          const values = [...new Set(input.values.map((v) => JSON.stringify(v)))].map(
            (v) => JSON.parse(v) as string | number,
          );
          const contentHash = crypto.createHash('sha256').update(JSON.stringify(values)).digest('hex');
          const next = await sql<{ n: number }>`
          select coalesce(max(version_no), 0)::int + 1 as n from reference_list_version where list_id = ${String(list.id)}`.execute(
            tx,
          );
          const id = deps.ids.next('rlv');
          const v = (
            await sql<Row>`
            insert into reference_list_version (id, tenant_id, list_id, version_no, "values", value_count, content_hash, published_by)
            values (${id}, ${ctx.principal.tenantId}, ${String(list.id)}, ${next.rows[0]!.n}, ${JSON.stringify(values)}::jsonb,
                    ${values.length}, ${contentHash}, ${ctx.principal.id})
            returning *`.execute(tx)
          ).rows[0]!;
          await deps.audit.record(tx, ctx, {
            action: 'reference_list.version_published',
            entityType: 'REFERENCE_LIST',
            entityId: String(list.id),
            after: { versionNo: Number(v.version_no), valueCount: values.length, contentHash },
            permissionUsed: 'config.manage',
          });
          const body = {
            id,
            listId: String(list.id),
            code: String(list.code),
            versionNo: Number(v.version_no),
            valueCount: values.length,
            contentHash,
            publishedAt: new Date(String(v.published_at)).toISOString(),
          };
          return { status: 201, body, resourceRef: id };
        },
      ),
    );
    if (result.replayed) res.set('Idempotent-Replayed', 'true');
    res.status(result.status).json(result.body);
  });
}
