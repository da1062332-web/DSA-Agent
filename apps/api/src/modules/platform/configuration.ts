// MOD-CFG tenant configuration (owner: Dev 1; DSA Notion MODULE 6; M-082). Reads: any staff. Writes: config.manage.
//   API-CFG-001 GET  /v1/settings/effective?branchId=&userId=   each known key resolved tenant → organisation → branch → user,
//               with the level it came from; a locked value stops lower levels overriding it.
//   API-CFG-002 PUT  /v1/settings/{scope}/{key}   scope is TENANT, ORGANISATION:<id>, BRANCH:<id> or USER:<id>; If-Match
//               (0 when the key is not set at that scope). Values are validated by the key's schema; changes audited as diffs.
//   API-CFG-003 PUT  /v1/labels                   the label set of one locale, replaced whole; If-Match (0 for a new locale).
//               GET /v1/labels?locale= reads it.
//   API-CFG-004 GET  /v1/calendars                API-CFG-005 PUT /v1/calendars/{id}   If-Match (0 creates).
//   API-CFG-006 GET  /v1/picklists/{category}     API-CFG-007 POST /v1/picklists/{category}/values   Idempotency-Key.
//   API-CFG-008 POST /v1/config-bundles/export    Idempotency-Key; the tenant's settings, labels, calendars and picklists.
//   API-CFG-009 POST /v1/config-bundles/import    validated and kept as a draft (config_bundle_draft); nothing is applied.
import { AppError, type RequestContext, type Tx } from '@dsa/contracts';
import { withIdempotency } from '@dsa/kernel';
import type { Router } from 'express';
import { sql } from 'kysely';
import { z, type ZodTypeAny } from 'zod';
import { idempotencyKey, ifMatchVersion, requireCtx, sendResource } from '../../http/request';
import type { ApiDeps } from '../types';

type Row = Record<string, unknown>;

/** The settings a tenant may set, each with its schema and platform default. */
export const SETTING_KEYS: Record<string, { schema: ZodTypeAny; default: unknown; description: string }> = {
  'lead.followUpDefaultHours': {
    schema: z.number().int().min(1).max(168),
    default: 24,
    description: 'Default follow-up delay',
  },
  'lead.contactAttemptsBeforeUnreachable': {
    schema: z.number().int().min(1).max(20),
    default: 5,
    description: 'Attempts before a lead may be marked not contactable',
  },
  'messaging.quietHoursEnabled': {
    schema: z.boolean(),
    default: true,
    description: 'Respect calendar quiet hours',
  },
  'locale.default': {
    schema: z.enum(['en-IN', 'hi-IN', 'mr-IN', 'ta-IN']),
    default: 'en-IN',
    description: 'Default locale',
  },
  'ui.dateFormat': {
    schema: z.enum(['DD/MM/YYYY', 'YYYY-MM-DD', 'DD-MMM-YYYY']),
    default: 'DD/MM/YYYY',
    description: 'Dates',
  },
  'task.defaultPriority': {
    schema: z.enum(['LOW', 'MEDIUM', 'HIGH']),
    default: 'MEDIUM',
    description: 'New task priority',
  },
};

const LEVELS = ['TENANT', 'ORGANISATION', 'BRANCH', 'USER'] as const;
type Level = (typeof LEVELS)[number];

export const SettingPut = z.object({ value: z.unknown(), locked: z.boolean().default(false) }).strict();
export const EffectiveSettingsQuery = z.object({
  branchId: z.string().optional(),
  userId: z.string().optional(),
});

const Hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const Interval = z
  .object({ start: Hhmm, end: Hhmm })
  .strict()
  .refine((i) => i.start < i.end, 'start must be before end');
const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
export const CalendarPut = z
  .object({
    name: z.string().trim().min(3).max(80),
    timezone: z
      .string()
      .regex(/^[A-Za-z]+\/[A-Za-z_]+$/)
      .default('Asia/Kolkata'),
    weeklyHours: z.record(z.enum(DAYS), z.array(Interval).max(4)),
    holidays: z
      .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
      .max(100)
      .default([]),
    quietHours: Interval.nullable().default(null),
  })
  .strict();

export const LabelsPut = z
  .object({
    locale: z.string().regex(/^[a-z]{2}-[A-Z]{2}$/),
    entries: z
      .array(
        z
          .object({
            canonicalKey: z.string().regex(/^[A-Z][A-Z0-9_.]{1,80}$/),
            label: z.string().trim().min(1).max(120),
            subStageOf: z
              .string()
              .regex(/^[A-Z][A-Z0-9_.]{1,80}$/)
              .nullable()
              .default(null),
          })
          .strict(),
      )
      .max(500),
  })
  .strict()
  .refine((b) => new Set(b.entries.map((e) => e.canonicalKey)).size === b.entries.length, {
    message: 'canonicalKey must be unique',
  });

export const PicklistValueCreate = z
  .object({ code: z.string().regex(/^[A-Z0-9][A-Z0-9_]{0,39}$/), label: z.string().trim().min(1).max(120) })
  .strict();

export const ConfigBundle = z
  .object({
    format: z.literal('dsa-config-bundle'),
    version: z.literal(1),
    settings: z
      .array(
        z.object({
          scopeType: z.enum(LEVELS),
          scopeId: z.string(),
          key: z.string(),
          value: z.unknown(),
          locked: z.boolean(),
        }),
      )
      .max(2000),
    labels: z.array(LabelsPut.innerType()).max(20),
    calendars: z.array(CalendarPut.extend({ id: z.string() })).max(100),
    picklists: z
      .array(z.object({ category: z.string(), code: z.string(), label: z.string(), active: z.boolean() }))
      .max(5000),
  })
  .strict();

function requireConfig(ctx: RequestContext): void {
  if (!ctx.principal.grants.some((g) => g.code === 'config.manage')) {
    throw AppError.of('FORBIDDEN', 'Permission denied: config.manage required.');
  }
}

function staleIf(current: number, given: number): void {
  if (current !== given) {
    throw AppError.of('VERSION_CONFLICT', 'The record was changed by someone else. Reload and try again.', [
      { field: 'If-Match', issue: 'STALE', meta: { currentVersion: current } },
    ]);
  }
}

function parseScope(raw: string): { type: Level; id: string } {
  if (raw === 'TENANT') return { type: 'TENANT', id: '-' };
  const m = /^(ORGANISATION|BRANCH|USER):([A-Za-z0-9_]{3,64})$/.exec(raw);
  if (!m)
    throw AppError.of('VALIDATION_ERROR', 'Scope is TENANT, ORGANISATION:<id>, BRANCH:<id> or USER:<id>.', [
      { field: 'scope', issue: 'INVALID' },
    ]);
  return { type: m[1] as Level, id: m[2]! };
}

async function requireScopeTarget(tx: Tx, scope: { type: Level; id: string }): Promise<void> {
  const table = { ORGANISATION: 'organisation', BRANCH: 'branch', USER: 'app_user' } as const;
  if (scope.type === 'TENANT') return;
  const r = await sql`select 1 from ${sql.table(table[scope.type])} where id = ${scope.id}`.execute(tx);
  if (!r.rows.length) throw AppError.of('NOT_FOUND', `${scope.type.toLowerCase()} not found.`);
}

/** pg returns a date column as local midnight; toISOString would move it to the previous day east of UTC. */
const dateOnly = (d: string | Date): string =>
  d instanceof Date
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    : String(d);

const toCalendar = (r: Row) => ({
  id: String(r.id),
  name: String(r.name),
  timezone: String(r.timezone),
  weeklyHours: r.weekly_hours,
  holidays: ((r.holidays as (string | Date)[]) ?? []).map(dateOnly),
  quietHours: r.quiet_hours ?? null,
  version: Number(r.lock_version),
});

async function audit(
  deps: ApiDeps,
  tx: Tx,
  ctx: RequestContext,
  action: string,
  type: string,
  id: string | null,
  extra: object,
) {
  await deps.audit.record(tx, ctx, {
    action,
    entityType: type,
    entityId: id,
    permissionUsed: 'config.manage',
    ...extra,
  });
}

export function registerConfigurationRoutes(router: Router, deps: ApiDeps): void {
  // API-CFG-001
  router.get('/settings/effective', async (req, res) => {
    const ctx = requireCtx(req);
    const q = EffectiveSettingsQuery.parse(req.query);
    const data = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const branchId = q.branchId ?? ctx.principal.primaryBranchId;
      const userId = q.userId ?? (ctx.principal.kind === 'USER' ? ctx.principal.id : null);
      const org = branchId
        ? (await sql<Row>`select organisation_id from branch where id = ${branchId}`.execute(tx)).rows[0]
        : null;
      const rows = await sql<Row>`
        select * from setting
         where (scope_type = 'TENANT')
            or (scope_type = 'ORGANISATION' and scope_id = ${(org?.organisation_id as string | undefined) ?? '-'})
            or (scope_type = 'BRANCH' and scope_id = ${branchId ?? '-'})
            or (scope_type = 'USER' and scope_id = ${userId ?? '-'})`.execute(tx);
      return Object.entries(SETTING_KEYS).map(([key, def]) => {
        let value = def.default;
        let origin: { scopeType: string; scopeId: string | null } = { scopeType: 'PLATFORM', scopeId: null };
        let locked = false;
        for (const level of LEVELS) {
          const row = rows.rows.find((r) => r.key === key && r.scope_type === level);
          if (!row) continue;
          value = row.value;
          origin = { scopeType: level, scopeId: level === 'TENANT' ? null : String(row.scope_id) };
          if (row.locked) {
            locked = true;
            break;
          }
        }
        return { key, value, origin, locked, description: def.description };
      });
    });
    res.json({ data, meta: { nextCursor: null, limit: data.length } });
  });

  // API-CFG-002
  router.put('/settings/:scope/:key', async (req, res) => {
    const ctx = requireCtx(req);
    requireConfig(ctx);
    const version = ifMatchVersion(req);
    const scope = parseScope(String(req.params.scope));
    const key = String(req.params.key);
    const def = SETTING_KEYS[key];
    if (!def) throw AppError.of('NOT_FOUND', `Unknown setting '${key}'.`);
    const input = SettingPut.parse(req.body);
    const value = def.schema.safeParse(input.value);
    if (!value.success) {
      throw AppError.of('VALIDATION_ERROR', `Invalid value for ${key}.`, [
        { field: 'value', issue: value.error.issues[0]?.message ?? 'INVALID' },
      ]);
    }
    const body = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      await requireScopeTarget(tx, scope);
      const cur = (
        await sql<Row>`select * from setting where scope_type = ${scope.type} and scope_id = ${scope.id} and key = ${key} for update`.execute(
          tx,
        )
      ).rows[0];
      staleIf(cur ? Number(cur.lock_version) : 0, version);
      const row = cur
        ? (
            await sql<Row>`update setting set value = ${JSON.stringify(value.data)}::jsonb, locked = ${input.locked},
                                  updated_by = ${ctx.principal.id}
                            where id = ${String(cur.id)} returning *`.execute(tx)
          ).rows[0]!
        : (
            await sql<Row>`
              insert into setting (id, tenant_id, scope_type, scope_id, key, value, locked, created_by, updated_by)
              values (${deps.ids.next('set')}, ${ctx.principal.tenantId}, ${scope.type}, ${scope.id}, ${key},
                      ${JSON.stringify(value.data)}::jsonb, ${input.locked}, ${ctx.principal.id}, ${ctx.principal.id})
              returning *`.execute(tx)
          ).rows[0]!;
      await audit(deps, tx, ctx, 'setting.changed', 'SETTING', String(row.id), {
        before: cur ? { value: cur.value, locked: cur.locked } : undefined,
        after: { key, scope: scope.type, value: value.data, locked: input.locked },
      });
      return {
        key,
        scopeType: scope.type,
        scopeId: scope.type === 'TENANT' ? null : scope.id,
        value: row.value,
        locked: Boolean(row.locked),
        version: Number(row.lock_version),
      };
    });
    sendResource(res, 200, body);
  });

  router.get('/labels', async (req, res) => {
    const ctx = requireCtx(req);
    const locale = z
      .object({
        locale: z
          .string()
          .regex(/^[a-z]{2}-[A-Z]{2}$/)
          .default('en-IN'),
      })
      .parse(req.query).locale;
    const row = await deps.txRunner.withTenantTx(
      ctx,
      async (tx) => (await sql<Row>`select * from label_set where locale = ${locale}`.execute(tx)).rows[0],
    );
    const body = { locale, entries: row ? row.entries : [], version: row ? Number(row.lock_version) : 0 };
    sendResource(res, 200, body);
  });

  // API-CFG-003
  router.put('/labels', async (req, res) => {
    const ctx = requireCtx(req);
    requireConfig(ctx);
    const version = ifMatchVersion(req);
    const input = LabelsPut.parse(req.body);
    const body = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const cur = (
        await sql<Row>`select * from label_set where locale = ${input.locale} for update`.execute(tx)
      ).rows[0];
      staleIf(cur ? Number(cur.lock_version) : 0, version);
      const known = new Set(input.entries.map((e) => e.canonicalKey));
      const orphan = input.entries.find(
        (e) => e.subStageOf && !known.has(e.subStageOf) && !/^[A-Z_]+$/.test(e.subStageOf),
      );
      if (orphan)
        throw AppError.of('VALIDATION_ERROR', 'A sub-stage must name a canonical state.', [
          { field: 'entries', issue: 'UNKNOWN_PARENT' },
        ]);
      const row = cur
        ? (
            await sql<Row>`update label_set set entries = ${JSON.stringify(input.entries)}::jsonb, updated_by = ${ctx.principal.id}
                          where id = ${String(cur.id)} returning *`.execute(tx)
          ).rows[0]!
        : (
            await sql<Row>`
              insert into label_set (id, tenant_id, locale, entries, created_by, updated_by)
              values (${deps.ids.next('lbl')}, ${ctx.principal.tenantId}, ${input.locale}, ${JSON.stringify(input.entries)}::jsonb,
                      ${ctx.principal.id}, ${ctx.principal.id})
              returning *`.execute(tx)
          ).rows[0]!;
      await audit(deps, tx, ctx, 'labels.replaced', 'LABEL_SET', String(row.id), {
        before: { entries: cur ? (cur.entries as unknown[]).length : 0 },
        after: { locale: input.locale, entries: input.entries.length },
      });
      return { locale: input.locale, entries: row.entries, version: Number(row.lock_version) };
    });
    sendResource(res, 200, body);
  });

  // API-CFG-004
  router.get('/calendars', async (req, res) => {
    const ctx = requireCtx(req);
    const rows = await deps.txRunner.withTenantTx(
      ctx,
      async (tx) => (await sql<Row>`select * from business_calendar order by name, id`.execute(tx)).rows,
    );
    res.json({ data: rows.map(toCalendar), meta: { nextCursor: null, limit: rows.length } });
  });

  // API-CFG-005
  router.put('/calendars/:id', async (req, res) => {
    const ctx = requireCtx(req);
    requireConfig(ctx);
    const version = ifMatchVersion(req);
    const id = String(req.params.id);
    if (!/^cal_[A-Za-z0-9_-]{6,40}$/.test(id)) {
      throw AppError.of('VALIDATION_ERROR', 'A calendar id looks like cal_<6-40 characters>.', [
        { field: 'id', issue: 'INVALID' },
      ]);
    }
    const input = CalendarPut.parse(req.body);
    const body = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const cur = (await sql<Row>`select * from business_calendar where id = ${id} for update`.execute(tx))
        .rows[0];
      staleIf(cur ? Number(cur.lock_version) : 0, version);
      const vals = [
        input.name,
        input.timezone,
        JSON.stringify(input.weeklyHours),
        input.holidays,
        input.quietHours ? JSON.stringify(input.quietHours) : null,
      ] as const;
      const row = cur
        ? (
            await sql<Row>`
              update business_calendar set name = ${vals[0]}, timezone = ${vals[1]}, weekly_hours = ${vals[2]}::jsonb,
                     holidays = ${vals[3]}::date[], quiet_hours = ${vals[4]}::jsonb, updated_by = ${ctx.principal.id}
               where id = ${id} returning *`.execute(tx)
          ).rows[0]!
        : (
            await sql<Row>`
              insert into business_calendar (id, tenant_id, name, timezone, weekly_hours, holidays, quiet_hours, created_by, updated_by)
              values (${id}, ${ctx.principal.tenantId}, ${vals[0]}, ${vals[1]}, ${vals[2]}::jsonb, ${vals[3]}::date[], ${vals[4]}::jsonb,
                      ${ctx.principal.id}, ${ctx.principal.id})
              returning *`.execute(tx)
          ).rows[0]!;
      await audit(deps, tx, ctx, cur ? 'calendar.updated' : 'calendar.created', 'BUSINESS_CALENDAR', id, {
        after: { name: input.name, holidays: input.holidays.length },
      });
      return toCalendar(row);
    });
    sendResource(res, 200, body);
  });

  // API-CFG-006
  router.get('/picklists/:category', async (req, res) => {
    const ctx = requireCtx(req);
    const category = String(req.params.category);
    const rows = await deps.txRunner.withTenantTx(
      ctx,
      async (tx) =>
        (
          await sql<Row>`select * from picklist_value where category = ${category} order by label, code`.execute(
            tx,
          )
        ).rows,
    );
    const data = rows.map((r) => ({
      id: String(r.id),
      category,
      code: String(r.code),
      label: String(r.label),
      active: Boolean(r.active),
    }));
    res.json({ data, meta: { nextCursor: null, limit: data.length } });
  });

  // API-CFG-007
  router.post('/picklists/:category/values', async (req, res) => {
    const ctx = requireCtx(req);
    requireConfig(ctx);
    const key = idempotencyKey(req);
    const category = String(req.params.category);
    if (!/^[A-Z][A-Z_]{2,40}$/.test(category)) {
      throw AppError.of('VALIDATION_ERROR', 'A category is upper case, like CALL_OUTCOME.', [
        { field: 'category', issue: 'INVALID' },
      ]);
    }
    const input = PicklistValueCreate.parse(req.body);
    const result = await deps.txRunner.withTenantTx(ctx, (tx) =>
      withIdempotency(
        tx,
        ctx,
        { key, method: 'POST', path: `/v1/picklists/${category}/values`, body: input },
        async () => {
          const dup =
            await sql`select 1 from picklist_value where category = ${category} and code = ${input.code}`.execute(
              tx,
            );
          if (dup.rows.length)
            throw AppError.of('VALIDATION_ERROR', 'The code is already in this picklist.', [
              { field: 'code', issue: 'DUPLICATE' },
            ]);
          const id = deps.ids.next('pkv');
          await sql`
          insert into picklist_value (id, tenant_id, category, code, label, created_by)
          values (${id}, ${ctx.principal.tenantId}, ${category}, ${input.code}, ${input.label}, ${ctx.principal.id})`.execute(
            tx,
          );
          await audit(deps, tx, ctx, 'picklist.value_added', 'PICKLIST_VALUE', id, {
            after: { category, code: input.code },
          });
          return {
            status: 201,
            body: { id, category, code: input.code, label: input.label, active: true },
            resourceRef: id,
          };
        },
      ),
    );
    if (result.replayed) res.set('Idempotent-Replayed', 'true');
    res.status(result.status).json(result.body);
  });

  // API-CFG-008
  router.post('/config-bundles/export', async (req, res) => {
    const ctx = requireCtx(req);
    requireConfig(ctx);
    const key = idempotencyKey(req);
    const result = await deps.txRunner.withTenantTx(ctx, (tx) =>
      withIdempotency(
        tx,
        ctx,
        { key, method: 'POST', path: '/v1/config-bundles/export', body: {} },
        async () => {
          const settings = (
            await sql<Row>`select * from setting order by scope_type, scope_id, key`.execute(tx)
          ).rows;
          const labels = (await sql<Row>`select * from label_set order by locale`.execute(tx)).rows;
          const calendars = (await sql<Row>`select * from business_calendar order by id`.execute(tx)).rows;
          const picklists = (await sql<Row>`select * from picklist_value order by category, code`.execute(tx))
            .rows;
          const bundle = {
            format: 'dsa-config-bundle' as const,
            version: 1 as const,
            exportedAt: ctx.now.toISOString(),
            settings: settings.map((s) => ({
              scopeType: s.scope_type,
              scopeId: s.scope_id,
              key: s.key,
              value: s.value,
              locked: s.locked,
            })),
            labels: labels.map((l) => ({ locale: l.locale, entries: l.entries })),
            calendars: calendars.map((c) => {
              const { version: _v, ...rest } = toCalendar(c);
              return rest;
            }),
            picklists: picklists.map((p) => ({
              category: p.category,
              code: p.code,
              label: p.label,
              active: p.active,
            })),
          };
          await audit(deps, tx, ctx, 'config.exported', 'CONFIG_BUNDLE', null, {
            after: {
              settings: settings.length,
              labels: labels.length,
              calendars: calendars.length,
              picklists: picklists.length,
            },
          });
          return { status: 200, body: bundle };
        },
      ),
    );
    res.status(result.status).json(result.body);
  });

  // API-CFG-009
  router.post('/config-bundles/import', async (req, res) => {
    const ctx = requireCtx(req);
    requireConfig(ctx);
    const key = idempotencyKey(req);
    const { exportedAt: _exportedAt, ...raw } = (req.body ?? {}) as Record<string, unknown>;
    const bundle = ConfigBundle.parse(raw);
    const problems: { path: string; issue: string }[] = [];
    bundle.settings.forEach((s, i) => {
      const def = SETTING_KEYS[s.key];
      if (!def) problems.push({ path: `settings.${i}.key`, issue: 'UNKNOWN_SETTING' });
      else if (!def.schema.safeParse(s.value).success)
        problems.push({ path: `settings.${i}.value`, issue: 'INVALID_VALUE' });
    });
    if (problems.length)
      throw AppError.of(
        'VALIDATION_ERROR',
        'The bundle has invalid entries.',
        problems.slice(0, 50).map((p) => ({ field: p.path, issue: p.issue })),
      );
    const result = await deps.txRunner.withTenantTx(ctx, (tx) =>
      withIdempotency(
        tx,
        ctx,
        { key, method: 'POST', path: '/v1/config-bundles/import', body: bundle },
        async () => {
          const id = deps.ids.next('cbd');
          const counts = {
            settings: bundle.settings.length,
            labels: bundle.labels.length,
            calendars: bundle.calendars.length,
            picklists: bundle.picklists.length,
          };
          await sql`
          insert into config_bundle_draft (id, tenant_id, bundle, counts, created_by)
          values (${id}, ${ctx.principal.tenantId}, ${JSON.stringify(bundle)}::jsonb, ${JSON.stringify(counts)}::jsonb, ${ctx.principal.id})`.execute(
            tx,
          );
          await audit(deps, tx, ctx, 'config.imported_as_draft', 'CONFIG_BUNDLE', id, { after: counts });
          return { status: 202, body: { draftId: id, status: 'DRAFT', counts }, resourceRef: id };
        },
      ),
    );
    res.status(result.status).json(result.body);
  });
}
