// ApplicationPort.rollUpStatus and getApplicationSummary against a real database (owner: Dev 3; Contracts §4.3, added
// 2026-10-28). Lender cases and sanctions move the application only through these. Covers the history, the state event and
// audit, the no-op case, the product version taken from the lender case, and the tenant boundary.
import type { RequestContext } from '@dsa/contracts';
import { createAuditPort, createIdGenerator } from '@dsa/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTxRunner } from '../src/kernel-min/tx-runner';
import { createApplicationPort } from '../src/modules/origination/applications/application-port';
import { testPrincipal } from './support/fake-auth';
import { startIsolationEnv, type IsolationEnv, type TenantFixture } from '../../../tests/isolation/harness';

let env: IsolationEnv;
beforeAll(async () => {
  env = await startIsolationEnv();
}, 180_000);
afterAll(async () => {
  await env?.stop();
});

let seq = 0;
const ids = createIdGenerator();
const port = () => createApplicationPort({ ids, audit: createAuditPort(ids) });
const ctxOf = (t: TenantFixture): RequestContext => ({
  principal: testPrincipal({
    tenantId: t.tenantId,
    id: t.userIds[0],
    primaryBranchId: t.branchId,
    grants: [],
  }),
  correlationId: `corr_rollup_${++seq}`,
  now: new Date('2026-10-28T10:00:00Z'),
});
const inTenant = <T>(
  t: TenantFixture,
  fn: Parameters<ReturnType<typeof createTxRunner>['withTenantTx']>[1],
) => createTxRunner(env.db).withTenantTx(ctxOf(t), fn) as Promise<T>;

/** An application in the given status; a product version only when one is given. Synthetic data only. */
async function seedApp(t: TenantFixture, status: string, productVersionId: string | null): Promise<string> {
  seq += 1;
  const id = `app_rollup_int_${seq}`;
  const customer = `cust_rollup_int_${seq}`;
  await env.admin.query(
    `insert into app.customer (id, tenant_id, party_type, full_name, home_branch_id, created_by, updated_by)
     values ($1, $2, 'INDIVIDUAL', 'Roll-up Customer', $3, $4, $4)`,
    [customer, t.tenantId, t.branchId, t.userIds[0]],
  );
  await env.admin.query(
    `insert into app.loan_application (id, tenant_id, branch_id, customer_id, product_category, product_version_id,
        requested_amount, applicant_type, status, sales_owner_id, created_by, updated_by)
     values ($1, $2, $3, $4, 'PL', $5, 300000.00, 'SALARIED', $6, $7, $7, $7)`,
    [id, t.tenantId, t.branchId, customer, productVersionId, status, t.userIds[0]],
  );
  return id;
}

async function productVersion(t: TenantFixture): Promise<string> {
  seq += 1;
  await env.admin.query(
    `insert into app.lender (id, tenant_id, name, lender_type, created_by, updated_by) values ($1, $2, $3, 'NBFC', $4, $4)`,
    [`lnd_rollup_${seq}`, t.tenantId, `Roll-up Lender ${seq}`, t.userIds[0]],
  );
  await env.admin.query(
    `insert into app.loan_product (id, tenant_id, lender_id, name, category, applicant_types, secured, status, created_by, updated_by)
     values ($1, $2, $3, $4, 'PL', '{SALARIED}', false, 'ACTIVE', $5, $5)`,
    [`prd_rollup_${seq}`, t.tenantId, `lnd_rollup_${seq}`, `Roll-up Product ${seq}`, t.userIds[0]],
  );
  await env.admin.query(
    `insert into app.loan_product_version (id, tenant_id, product_id, version_no, effective_from, amount_min, amount_max,
                                           currency, tenure_min_months, tenure_max_months, created_by)
     values ($1, $2, $3, 1, '2026-01-01T00:00:00Z', 50000, 1000000, 'INR', 12, 60, $4)`,
    [`prv_rollup_${seq}`, t.tenantId, `prd_rollup_${seq}`, t.userIds[0]],
  );
  return `prv_rollup_${seq}`;
}

const rows = async (sql: string, id: string) => (await env.admin.query(sql, [id])).rows;

describe('TEST-APP-ROLLUP ApplicationPort roll-ups against the database', () => {
  it('TEST-APP-ROLLUP-INT-01 ROLLUP-4 moves the application with a history row tied to the lender case, a state event and audit', async () => {
    const pv = await productVersion(env.A);
    const id = await seedApp(env.A, 'SUBMITTED', pv);
    const result = await inTenant(env.A, (tx) =>
      port().rollUpStatus(tx, ctxOf(env.A), {
        applicationId: id,
        transitionCode: 'ROLLUP-4',
        toStatus: 'SANCTIONED',
        toSubStatus: null,
        causedByLenderCaseId: 'lcs_rollup_int_1',
      }),
    );
    expect(result).toEqual({
      applicationId: id,
      fromStatus: 'SUBMITTED',
      toStatus: 'SANCTIONED',
      changed: true,
    });
    expect(await rows(`select status, lock_version from app.loan_application where id = $1`, id)).toEqual([
      { status: 'SANCTIONED', lock_version: 1 },
    ]);
    expect(
      await rows(
        `select from_status, to_status, transition_code, caused_by_lender_case_id, actor
           from app.application_status_history where application_id = $1`,
        id,
      ),
    ).toEqual([
      {
        from_status: 'SUBMITTED',
        to_status: 'SANCTIONED',
        transition_code: 'ROLLUP-4',
        caused_by_lender_case_id: 'lcs_rollup_int_1',
        actor: env.A.userIds[0],
      },
    ]);
    expect(
      await rows(
        `select payload from app.outbox_event where subject_id = $1 and event_type = 'application.state_changed'`,
        id,
      ),
    ).toEqual([
      {
        payload: {
          applicationId: id,
          from: 'SUBMITTED',
          to: 'SANCTIONED',
          transitionCode: 'ROLLUP-4',
          lenderCaseId: 'lcs_rollup_int_1',
        },
      },
    ]);
    expect(
      await rows(
        `select before, after from app.audit_event where entity_id = $1 and action = 'application.state_changed'`,
        id,
      ),
    ).toEqual([
      {
        before: { status: 'SUBMITTED', subStatus: null },
        after: { status: 'SANCTIONED', subStatus: null, transitionCode: 'ROLLUP-4' },
      },
    ]);
  });

  it('TEST-APP-ROLLUP-INT-02 ROLLUP-1 from a draft records the lender case product version; an existing one is kept', async () => {
    const pv = await productVersion(env.A);
    const other = await productVersion(env.A);
    const draft = await seedApp(env.A, 'DRAFT', null);
    const ready = await seedApp(env.A, 'READY_FOR_SUBMISSION', pv);
    for (const id of [draft, ready]) {
      await inTenant(env.A, (tx) =>
        port().rollUpStatus(tx, ctxOf(env.A), {
          applicationId: id,
          transitionCode: 'ROLLUP-1',
          toStatus: 'SUBMITTED',
          toSubStatus: null,
          causedByLenderCaseId: 'lcs_rollup_int_2',
          productVersionId: id === draft ? pv : other,
        }),
      );
    }
    expect(
      await rows(`select status, product_version_id from app.loan_application where id = $1`, draft),
    ).toEqual([{ status: 'SUBMITTED', product_version_id: pv }]);
    expect(
      await rows(`select status, product_version_id from app.loan_application where id = $1`, ready),
    ).toEqual([{ status: 'SUBMITTED', product_version_id: pv }]);
  });

  it('TEST-APP-ROLLUP-INT-03 a roll-up to the current status and sub-status writes nothing; a sub-status change writes history and audit but no state event', async () => {
    const id = await seedApp(env.A, 'SUBMITTED', await productVersion(env.A));
    const run = (toSubStatus: 'QUERY_PENDING' | null, code: 'ROLLUP-2' | 'ROLLUP-3') =>
      inTenant(env.A, (tx) =>
        port().rollUpStatus(tx, ctxOf(env.A), {
          applicationId: id,
          transitionCode: code,
          toStatus: 'SUBMITTED',
          toSubStatus,
          causedByLenderCaseId: 'lcs_rollup_int_3',
        }),
      );
    expect(await run(null, 'ROLLUP-3')).toMatchObject({ changed: false });
    expect(
      await rows(
        `select count(*)::int as n from app.application_status_history where application_id = $1`,
        id,
      ),
    ).toEqual([{ n: 0 }]);
    expect(await run('QUERY_PENDING', 'ROLLUP-2')).toMatchObject({ changed: true });
    expect(await rows(`select sub_status from app.loan_application where id = $1`, id)).toEqual([
      { sub_status: 'QUERY_PENDING' },
    ]);
    expect(
      await rows(
        `select count(*)::int as n from app.application_status_history where application_id = $1`,
        id,
      ),
    ).toEqual([{ n: 1 }]);
    expect(await rows(`select count(*)::int as n from app.outbox_event where subject_id = $1`, id)).toEqual([
      { n: 0 },
    ]);
    expect(
      await rows(
        `select count(*)::int as n from app.audit_event where entity_id = $1 and action = 'application.state_changed'`,
        id,
      ),
    ).toEqual([{ n: 1 }]);
  });

  it('TEST-APP-ROLLUP-INT-04 tenant B can neither read nor roll up a tenant A application', async () => {
    const id = await seedApp(env.A, 'SUBMITTED', await productVersion(env.A));
    const summary = await inTenant(env.B, (tx) => port().getApplicationSummary(tx, ctxOf(env.B), id));
    expect(summary).toBeNull();
    const result = await inTenant(env.B, (tx) =>
      port().rollUpStatus(tx, ctxOf(env.B), {
        applicationId: id,
        transitionCode: 'ROLLUP-6',
        toStatus: 'REJECTED',
        toSubStatus: null,
        causedByLenderCaseId: 'lcs_rollup_int_4',
      }),
    );
    expect(result).toBeNull();
    expect(await rows(`select status from app.loan_application where id = $1`, id)).toEqual([
      { status: 'SUBMITTED' },
    ]);
    const own = await inTenant(env.A, (tx) =>
      port().getApplicationSummary(tx, ctxOf(env.A), id, { forUpdate: true }),
    );
    expect(own).toEqual({
      id,
      branchId: env.A.branchId,
      customerId: expect.stringMatching(/^cust_rollup_int_/),
      productCategory: 'PL',
      status: 'SUBMITTED',
      subStatus: null,
      version: 0,
    });
  });
});
