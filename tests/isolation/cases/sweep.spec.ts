// TEST-SEC-001 sweep (owner: Dev 1). Every /v1 operation in openapi/openapi.yaml is called as a tenant B user holding every
// permission at TENANT scope, with each path parameter set to the id of a real tenant A row (sweep-map.ts). Then:
//   - no response to tenant B contains a tenant A id or the tenant A tenant id;
//   - an operation addressed at a tenant A record never succeeds (no 2xx) and never fails with 500;
//   - after the sweep, every tenant A row in every tenant table is unchanged.
// It is the floor, not the ceiling: the module cases in this folder check each endpoint with a valid body.
import { PERMISSION_CODES, type PermissionCode } from '@dsa/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startIsolationEnv, v1Operations, type IsolationEnv, type Operation } from '../harness';
import { LITERAL_PARAMS, SEGMENT_TABLE, pathParams } from '../sweep-map';

let env: IsolationEnv;
let tenantTables: string[] = [];
const aIds: Map<string, string> = new Map();
const aIdSet: Set<string> = new Set();
let before: Map<string, string> = new Map();
const ABSENT = 'zz_iso_absent_1';

async function seedTenantA(): Promise<void> {
  const a = env.A;
  const u = a.userIds[0];
  const q = (text: string, values: unknown[]) => env.admin.query(text, values);
  await q(
    `insert into app.customer (id, tenant_id, party_type, full_name, home_branch_id, created_by, updated_by)
     values ('cust_swp_a1', $1, 'INDIVIDUAL', 'Sweep Customer', $2, $3, $3)`,
    [a.tenantId, a.branchId, u],
  );
  await q(
    `insert into app.lead (id, tenant_id, branch_id, full_name, mobile_e164, mobile_hash, product_category, source,
                           owner_user_id, created_by, updated_by)
     values ('lead_swp_a1', $1, $2, 'Sweep Lead', '+919876500099', decode('000000000000000000000000000000aa', 'hex'),
             'PL', 'PHONE', $3, $3, $3)`,
    [a.tenantId, a.branchId, u],
  );
  await q(
    `insert into app.lender (id, tenant_id, name, lender_type, created_by, updated_by) values ('lnd_swp_a1', $1, 'Sweep Lender', 'NBFC', $2, $2)`,
    [a.tenantId, u],
  );
  await q(
    `insert into app.loan_product (id, tenant_id, lender_id, name, category, applicant_types, secured, status, created_by, updated_by)
     values ('prd_swp_a1', $1, 'lnd_swp_a1', 'Sweep Product', 'PL', '{SALARIED}', false, 'ACTIVE', $2, $2)`,
    [a.tenantId, u],
  );
  await q(
    `insert into app.loan_product_version (id, tenant_id, product_id, version_no, effective_from, amount_min, amount_max,
                                           currency, tenure_min_months, tenure_max_months, created_by)
     values ('prv_swp_a1', $1, 'prd_swp_a1', 1, '2026-01-01T00:00:00Z', 50000, 1000000, 'INR', 12, 60, $2)`,
    [a.tenantId, u],
  );
  await q(
    `insert into app.empanelment (id, tenant_id, organisation_id, lender_id, dsa_code, valid_range, permitted_categories,
                                  status, created_by, updated_by)
     values ('emp_swp_a1', $1, $2, 'lnd_swp_a1', 'DSA_SWP_A1', daterange(current_date - 30, current_date + 365), array['PL'],
             'ACTIVE', $3, $3)`,
    [a.tenantId, a.orgId, u],
  );
  await q(
    `insert into app.loan_application (id, tenant_id, branch_id, customer_id, lead_id, product_category, product_version_id,
                                       requested_amount, applicant_type, status, sales_owner_id, created_by, updated_by)
     values ('app_swp_a1', $1, $2, 'cust_swp_a1', 'lead_swp_a1', 'PL', 'prv_swp_a1', 300000, 'SALARIED',
             'DOCUMENTS_PENDING', $3, $3, $3)`,
    [a.tenantId, a.branchId, u],
  );
  await q(
    `insert into app.application_party (id, tenant_id, application_id, customer_id, role, party_type, created_by)
     values ('pty_swp_a1', $1, 'app_swp_a1', 'cust_swp_a1', 'PRIMARY', 'INDIVIDUAL', $2)`,
    [a.tenantId, u],
  );
  await q(
    `insert into app.checklist_item (id, tenant_id, application_id, party_id, document_type_code, mandatory,
                                     source_decision_id, created_by, updated_by)
     values ('chk_swp_a1', $1, 'app_swp_a1', 'pty_swp_a1', 'PAN_CARD', true, 'dr_swp_a1', $2, $2)`,
    [a.tenantId, u],
  );
  await q(
    `insert into app.lender_case (id, tenant_id, application_id, lender_id, product_version_id, empanelment_id, attempt_no,
                                  status, created_by, updated_by)
     values ('lc_swp_a1', $1, 'app_swp_a1', 'lnd_swp_a1', 'prv_swp_a1', 'emp_swp_a1', 1, 'DRAFT', $2, $2)`,
    [a.tenantId, u],
  );
  await q(
    `insert into app.task (id, tenant_id, type, title, owner_user_id, linked_type, linked_id, branch_id, priority, status,
                           due_at, idempotency_key, created_by_source, tags, lock_version, created_by, updated_by)
     values ('tsk_swp_a1', $1, 'FOLLOW_UP', 'Sweep Task', $2, 'LEAD', 'lead_swp_a1', $3, 'MEDIUM', 'OPEN', now(),
             'idem_swp_a1', 'USER', '{}', 0, $2, $2)`,
    [a.tenantId, u, a.branchId],
  );
  await q(
    `insert into app.activity (id, tenant_id, subject_type, subject_id, kind, outcome_code, occurred_at, duration_s, note,
                               actor_id, actor_branch_id, lock_version, is_hidden)
     values ('act_swp_a1', $1, 'LEAD', 'lead_swp_a1', 'CALL', 'CONNECTED', now(), 60, 'Sweep call', $2, $3, 0, false)`,
    [a.tenantId, u, a.branchId],
  );
}

/** One md5 per tenant table over all of tenant A's rows. */
async function snapshotTenantA(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const t of tenantTables) {
    const r = await env.admin.query(
      `select coalesce(md5(string_agg(x::text, '|' order by x::text)), '') as h from app.${t} x where tenant_id = $1`,
      [env.A.tenantId],
    );
    out.set(t, r.rows[0].h);
  }
  return out;
}

beforeAll(async () => {
  env = await startIsolationEnv();
  await seedTenantA();
  const tables = await env.admin.query(
    `select c.table_name from information_schema.columns c
       join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = 'app' and c.column_name = 'tenant_id' and t.table_type = 'BASE TABLE'
      order by 1`,
  );
  tenantTables = tables.rows.map((r) => r.table_name as string);
  const withId = await env.admin.query(
    `select table_name from information_schema.columns where table_schema = 'app' and column_name = 'id'`,
  );
  const idTables = new Set(withId.rows.map((r) => r.table_name as string));
  for (const t of tenantTables.filter((x) => idTables.has(x))) {
    const r = await env.admin.query(`select id::text as id from app.${t} where tenant_id = $1 order by id`, [
      env.A.tenantId,
    ]);
    for (const row of r.rows) aIdSet.add(row.id);
    if (r.rows[0]) aIds.set(t, r.rows[0].id);
  }
  before = await snapshotTenantA();
}, 240_000);

afterAll(async () => {
  await env?.stop();
});

function fillForB(op: Operation): { path: string; targetsA: boolean } {
  let targetsA = false;
  let p = op.path;
  for (const param of pathParams(op.path)) {
    let value = LITERAL_PARAMS[param.name];
    if (value === undefined) {
      const id = aIds.get(SEGMENT_TABLE[param.segment] ?? '');
      value = id ?? ABSENT;
      if (id) targetsA = true;
    }
    p = p.replace(`{${param.name}}`, encodeURIComponent(value));
  }
  return { path: p, targetsA };
}

/** Tenant A ids in a response, other than the ones the caller sent in the path (a 404 may echo what was asked for). */
const leaks = (text: string, path: string): string[] => {
  const asked = new Set(path.split('/'));
  const found: string[] = [];
  if (text.includes(env.A.tenantId)) found.push(env.A.tenantId);
  for (const m of text.matchAll(/[A-Za-z0-9_]+/g)) if (aIdSet.has(m[0]) && !asked.has(m[0])) found.push(m[0]);
  return [...new Set(found)];
};

describe('TEST-SEC-001 sweep: tenant B with every permission, against tenant A ids, on every /v1 operation', () => {
  const ops = v1Operations();
  let n = 0;

  it.each(ops.map((op) => [op.operationId, op] as const))('%s', async (_id, op) => {
    const b = env.appAs(env.B, [...PERMISSION_CODES] as PermissionCode[]);
    const { path, targetsA } = fillForB(op);
    n += 1;
    const req = request(b);
    const call = (req[op.method] as (url: string) => request.Test)
      .call(req, path)
      .set('Idempotency-Key', `swp_${n}_${Math.random().toString(36).slice(2, 10)}`)
      .set('If-Match', '"0"');
    if (path.endsWith('/stream')) {
      // An event stream never ends: only its status is checked, from the response headers.
      const status = await new Promise<number>((resolve, reject) => {
        call
          .buffer(false)
          .parse((r, done) => {
            resolve(r.statusCode ?? 0);
            r.destroy();
            done(null, null);
          })
          .end((err) =>
            err && !/aborted|destroyed|socket hang up/i.test(String(err)) ? reject(err) : undefined,
          );
      });
      expect(status, `${op.method.toUpperCase()} ${path}`).not.toBe(500);
      return;
    }
    const res = await call.send({});
    const label = `${op.method.toUpperCase()} ${path} → ${res.status}`;
    expect(res.status, label).not.toBe(500);
    expect(leaks(res.text ?? '', path), label).toEqual([]);
    if (targetsA) expect(res.status >= 200 && res.status < 300, label).toBe(false);
  });

  it('TEST-SEC-001-SWEEP-ROWS tenant A rows are unchanged after the sweep', async () => {
    const after = await snapshotTenantA();
    const changed = tenantTables.filter((t) => before.get(t) !== after.get(t));
    expect(changed).toEqual([]);
  });
});
