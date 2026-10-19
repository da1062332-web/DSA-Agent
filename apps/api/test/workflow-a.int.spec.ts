// Workflow A end to end against a real database, with the production wiring (src/wiring.ts) — audit 2026-10-19.
// Lead with consent → BRE routing and the first-contact task → qualification → conversion through the applications module →
// T-APP-01 and the rule-generated checklist → lender case → package refused while documents are outstanding or consent is
// missing → package with the real document hashes → submission and the data-sharing record → lender query raised and
// answered once → the outbox relay publishes every event. Synthetic data only.
import type { PermissionCode } from '@dsa/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTxRunner } from '../src/kernel-min/tx-runner';
import { MAX_ATTEMPTS, OutboxRelay } from '../src/modules/platform/outbox-relay';
import { startIsolationEnv, type IsolationEnv } from '../../../tests/isolation/harness';

let env: IsolationEnv;
const LENDER = 'lnd_wfa_int_1';
const PRODUCT = 'prd_wfa_int_1';
const VERSION = 'prv_wfa_int_1';
const EMPANELMENT = 'emp_wfa_int_1';

beforeAll(async () => {
  env = await startIsolationEnv();
  const a = env.A;
  // The intake queue holds leads and their tasks, so the first-contact task can be owned by it.
  await env.admin.query(`update app.work_queue set record_types = '{LEAD,TASK}' where id = $1`, [a.queueId]);
  await env.admin.query(
    `insert into app.lender (id, tenant_id, name, lender_type, created_by, updated_by) values ($1, $2, 'Synthetic NBFC', 'NBFC', $3, $3)`,
    [LENDER, a.tenantId, a.userIds[0]],
  );
  await env.admin.query(
    `insert into app.loan_product (id, tenant_id, lender_id, name, category, applicant_types, secured, status, created_by, updated_by)
     values ($1, $2, $3, 'Synthetic PL', 'PL', '{SALARIED}', false, 'ACTIVE', $4, $4)`,
    [PRODUCT, a.tenantId, LENDER, a.userIds[0]],
  );
  await env.admin.query(
    `insert into app.loan_product_version (id, tenant_id, product_id, version_no, effective_from, amount_min, amount_max,
                                           currency, tenure_min_months, tenure_max_months, created_by)
     values ($1, $2, $3, 1, '2026-01-01T00:00:00Z', 50000, 1000000, 'INR', 12, 60, $4)`,
    [VERSION, a.tenantId, PRODUCT, a.userIds[0]],
  );
  await env.admin.query(
    `insert into app.empanelment (id, tenant_id, organisation_id, lender_id, dsa_code, valid_range, permitted_categories,
                                  created_by, updated_by)
     values ($1, $2, $3, $4, 'DSA-SYN-01', daterange('2026-01-01', '2027-12-31'), '{PL}', $5, $5)`,
    [EMPANELMENT, a.tenantId, a.orgId, LENDER, a.userIds[0]],
  );
}, 240_000);

afterAll(async () => {
  await env?.stop();
});

const OPS: PermissionCode[] = [
  'lead.create',
  'lead.read',
  'lead.update',
  'lead.qualify',
  'application.create',
  'application.read',
  'application.update',
  'lender_case.submit',
  'lender_case.update_status',
  'activity.create',
];

const key = (label: string) => `wfa_${label}_${Math.random().toString(36).slice(2, 10)}`;

describe('TEST-WFA-INT Workflow A with the production wiring', () => {
  let leadId = '';
  let applicationId = '';
  let customerId = '';
  let caseId = '';
  let checklistItemId = '';

  it('TEST-WFA-INT-01 a new lead is routed through the BRE and gets its first-contact task in the same transaction', async () => {
    const app = env.appAs(env.A, OPS);
    const res = await request(app)
      .post('/v1/leads')
      .set('Idempotency-Key', key('lead'))
      .send({
        fullName: 'Synthetic Applicant',
        mobile: '9000000001',
        email: 'synthetic.applicant@example.com',
        productCategory: 'PL',
        indicativeAmount: { amount: '400000.00', currency: 'INR' },
        pincode: '400001',
        branchId: env.A.branchId,
        source: 'WALK_IN',
        consent: { purpose: 'CONTACT', noticeVersion: 'V1.0', channel: 'IN_PERSON' },
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    leadId = res.body.id;

    const lead = await env.admin.query(
      `select owner_user_id, owner_queue_id, last_routing_decision_id, last_duplicate_decision_id from app.lead where id = $1`,
      [leadId],
    );
    // DK-lead.assignment has no published rule set, so its default output applies: the branch queue, no named user.
    expect(lead.rows[0].owner_queue_id).toBe(env.A.queueId);
    expect(lead.rows[0].last_routing_decision_id).toMatch(/^dr_/);
    expect(lead.rows[0].last_duplicate_decision_id).toMatch(/^dr_/);

    const tasks = await env.admin.query(
      `select type, owner_queue_id, sla_class, sla_decision_record_id from app.task where linked_id = $1`,
      [leadId],
    );
    expect(tasks.rows).toEqual([
      expect.objectContaining({ type: 'CALL', owner_queue_id: env.A.queueId, sla_class: 'CUSTOMER_FIRST_CONTACT' }),
    ]);
    expect(tasks.rows[0].sla_decision_record_id).toMatch(/^dr_/);
  });

  it('TEST-WFA-INT-02 conversion creates the customer, and the application through the applications module', async () => {
    const app = env.appAs(env.A, OPS);
    const qualified = await request(app)
      .post(`/v1/leads/${leadId}/transitions`)
      .set('If-Match', '"0"')
      .set('Idempotency-Key', key('qualify'))
      .send({
        transitionCode: 'T-LEAD-04',
        qualification: {
          applicantType: 'SALARIED',
          requestedAmount: { amount: '350000.00', currency: 'INR' },
          tenureMonths: 36,
          purposeCode: 'PERSONAL_NEEDS',
        },
      });
    expect(qualified.status, JSON.stringify(qualified.body)).toBe(200);

    const converted = await request(app)
      .post(`/v1/leads/${leadId}/conversion`)
      .set('If-Match', qualified.headers.etag as string)
      .set('Idempotency-Key', key('convert'))
      .send({});
    expect(converted.status, JSON.stringify(converted.body)).toBe(200);
    applicationId = converted.body.applicationId;
    customerId = converted.body.customerId;

    const parties = await env.admin.query(
      `select role, customer_id from app.application_party where application_id = $1`,
      [applicationId],
    );
    expect(parties.rows).toEqual([{ role: 'PRIMARY', customer_id: customerId }]);
    const created = await env.admin.query(
      `select count(*)::int as n from app.outbox_event where subject_id = $1 and event_type = 'application.created'`,
      [applicationId],
    );
    expect(created.rows[0].n).toBe(1);
  });

  it('TEST-WFA-INT-03 T-APP-01 generates the checklist; an activity can be logged on the application', async () => {
    const app = env.appAs(env.A, OPS);
    const etag = (await request(app).get(`/v1/applications/${applicationId}`)).headers.etag as string;
    const res = await request(app)
      .post(`/v1/applications/${applicationId}/transitions`)
      .set('If-Match', etag)
      .set('Idempotency-Key', key('tapp01'))
      .send({ transitionCode: 'T-APP-01', productVersionId: VERSION });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const checklist = await request(app).get(`/v1/applications/${applicationId}/checklist`);
    expect(checklist.status).toBe(200);
    expect(checklist.body.data.map((i: { documentTypeCode: string }) => i.documentTypeCode)).toEqual(['PAN_CARD']);
    expect(checklist.body.summary.complete).toBe(false);
    checklistItemId = checklist.body.data[0].id;

    const activity = await request(app)
      .post('/v1/activities')
      .set('Idempotency-Key', key('activity'))
      .send({
        kind: 'NOTE',
        subjectType: 'LOAN_APPLICATION',
        subjectId: applicationId,
        occurredAt: '2026-10-19T09:00:00.000Z',
        note: 'Collected the PAN card copy',
      });
    expect(activity.status, JSON.stringify(activity.body)).toBe(201);
  });

  it('TEST-WFA-INT-04 the package is refused without consent for this lender, then while a document is outstanding', async () => {
    const app = env.appAs(env.A, OPS);
    const created = await request(app)
      .post(`/v1/applications/${applicationId}/lender-cases`)
      .send({ lenderId: LENDER, productVersionId: VERSION, empanelmentId: EMPANELMENT });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    caseId = created.body.id;

    const noConsent = await request(app).post(`/v1/lender-cases/${caseId}/package`).send({ freeze: true });
    expect(noConsent.status).toBe(422);
    expect(noConsent.body.error.code).toBe('CONSENT_REQUIRED');

    await env.admin.query(
      `insert into app.consent_record (id, tenant_id, subject_type, subject_id, purpose, purpose_target, notice_version, channel,
                                       captured_by, captured_at)
       values ('cnst_wfa_int_share', $1, 'CUSTOMER', $2, 'SHARE_WITH_LENDER', $3, 'V1.0', 'IN_PERSON', $4, now())`,
      [env.A.tenantId, customerId, LENDER, env.A.userIds[0]],
    );
    const incomplete = await request(app).post(`/v1/lender-cases/${caseId}/package`).send({ freeze: true });
    expect(incomplete.status).toBe(422);
    expect(incomplete.body.error.code).toBe('COMPLETENESS_FAILED');
  });

  it('TEST-WFA-INT-05 once the document is accepted, the package carries the real hashes; submission records what was shared', async () => {
    const app = env.appAs(env.A, OPS);
    // The document is uploaded and accepted (synthetic hash).
    await env.admin.query(
      `insert into app.uploaded_document (id, tenant_id, application_id, checklist_item_id, file_name, file_size_bytes, mime_type,
                                          storage_path, sha256_hash, created_by, updated_by)
       values ('doc_wfa_int_1', $1, $2, $3, 'pan.pdf', 1024, 'application/pdf', 'tenant/a/pan.pdf', $4, $5, $5)`,
      [env.A.tenantId, applicationId, checklistItemId, 'b'.repeat(64), env.A.userIds[0]],
    );
    await env.admin.query(
      `update app.checklist_item set status = 'ACCEPTED', reviewed_by = $2, reviewed_at = now() where id = $1`,
      [checklistItemId, env.A.userIds[0]],
    );

    const built = await request(app).post(`/v1/lender-cases/${caseId}/package`).send({ freeze: true });
    expect(built.status, JSON.stringify(built.body)).toBe(200);
    const pkg = await env.admin.query(`select manifest, consent_ids from app.submission_package where id = $1`, [
      built.body.package.id,
    ]);
    expect(pkg.rows[0].consent_ids).toEqual(['cnst_wfa_int_share']);
    expect(pkg.rows[0].manifest.documents).toEqual([
      expect.objectContaining({ checklistItemId, documentId: 'doc_wfa_int_1', sha256: 'b'.repeat(64) }),
    ]);

    const submitted = await request(app)
      .post(`/v1/lender-cases/${caseId}/submission`)
      .set('Idempotency-Key', key('submit'))
      .send({ channel: 'PORTAL' });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
    const shared = await env.admin.query(
      `select items, consent_ids from app.data_sharing_record where source_ref = $1`,
      [built.body.package.id],
    );
    expect(shared.rows[0].consent_ids).toEqual(['cnst_wfa_int_share']);
    expect(shared.rows[0].items.fields).not.toContain('pan');
    expect(shared.rows[0].items.checklistItemIds).toEqual([checklistItemId]);
  });

  it('TEST-WFA-INT-06 a lender query is stored, answered once under the same consent, and a second answer is refused', async () => {
    const app = env.appAs(env.A, OPS);
    const raised = await request(app)
      .post(`/v1/lender-cases/${caseId}/queries`)
      .send({ text: 'Please share the latest salary slip', requestedItems: ['SALARY_SLIP'] });
    expect(raised.status, JSON.stringify(raised.body)).toBe(201);
    const queryId = raised.body.query.id;
    const stored = await env.admin.query(`select requested_items, responded_at from app.lender_query where id = $1`, [
      queryId,
    ]);
    expect(stored.rows).toEqual([{ requested_items: ['SALARY_SLIP'], responded_at: null }]);

    const answer = { text: 'Salary slip uploaded', documentReferences: ['doc_wfa_int_1'] };
    const first = await request(app).post(`/v1/lender-queries/${queryId}/responses`).send(answer);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const answered = await env.admin.query(
      `select q.responded_at, p.kind, p.consent_ids from app.lender_query q
         join app.submission_package p on p.id = q.response_manifest_id where q.id = $1`,
      [queryId],
    );
    expect(answered.rows[0]).toMatchObject({ kind: 'QUERY_RESPONSE', consent_ids: ['cnst_wfa_int_share'] });

    const second = await request(app).post(`/v1/lender-queries/${queryId}/responses`).send(answer);
    expect(second.status).toBe(409);
  });

  it('TEST-WFA-INT-07 the outbox relay publishes every waiting event exactly once', async () => {
    const seen: string[] = [];
    const relay = new OutboxRelay({
      txRunner: createTxRunner(env.db),
      subscribers: [
        async (_ctx, event) => {
          seen.push(event.type);
        },
      ],
    });
    const outcomes = await relay.drain(500);
    expect(outcomes.length).toBeGreaterThan(0);
    expect(outcomes.every((o) => o.outcome === 'PUBLISHED')).toBe(true);
    expect(seen).toEqual(expect.arrayContaining(['lead.created', 'lead.converted', 'application.created', 'checklist.changed']));
    const waiting = await env.admin.query(`select count(*)::int as n from app.outbox_event where published_at is null`);
    expect(waiting.rows[0].n).toBe(0);
    expect(await relay.drain(500)).toEqual([]);
  });

  it('TEST-WFA-INT-08 a failing subscriber is retried, then the event is parked with its error', async () => {
    await env.admin.query(
      `insert into app.outbox_event (id, tenant_id, event_type, subject_type, subject_id, payload, correlation_id)
       values ('evt_wfa_int_poison', $1, 'lead.created', 'LEAD', $2, '{}'::jsonb, 'corr_poison')`,
      [env.A.tenantId, leadId],
    );
    const relay = new OutboxRelay({
      txRunner: createTxRunner(env.db),
      subscribers: [
        async () => {
          throw new Error('subscriber down');
        },
      ],
    });
    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
      const [outcome] = await relay.drain(10);
      expect(outcome?.outcome).toBe(i < MAX_ATTEMPTS ? 'FAILED' : 'DEAD_LETTERED');
    }
    const row = await env.admin.query(
      `select publish_attempts, last_publish_error, published_at, dead_lettered_at from app.outbox_event where id = 'evt_wfa_int_poison'`,
    );
    expect(row.rows[0]).toMatchObject({ publish_attempts: MAX_ATTEMPTS, published_at: null });
    expect(row.rows[0].last_publish_error).toContain('subscriber down');
    expect(row.rows[0].dead_lettered_at).not.toBeNull();
    expect(await relay.drain(10)).toEqual([]);
  });

  it('TEST-WFA-INT-09 tenant B, holding every permission, sees none of it', async () => {
    const b = env.appAs(env.B, OPS);
    expect((await request(b).get(`/v1/leads/${leadId}`)).status).toBe(404);
    expect((await request(b).get(`/v1/applications/${applicationId}`)).status).toBe(404);
    expect((await request(b).get(`/v1/lender-cases/${caseId}`)).status).toBe(404);
    expect((await request(b).get(`/v1/applications/${applicationId}/checklist`)).status).toBe(404);
  });
});
