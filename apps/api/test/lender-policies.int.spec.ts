// P1-04 lender policy routes against a real database (owner: Dipanshu). A throwaway PostgreSQL 16 container with every migration
// applied (M-120 included), connected as dsa_api, with the production dependencies, so RLS, the CHECKs, the one-active index, audit
// and outbox behave as deployed. User 0 is the maker; user 1 is the checker (SOD-01).
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PermissionCode } from '@dsa/contracts';
import { ALL_ADMIN, startIsolationEnv, type IsolationEnv } from '../../../tests/isolation/harness';

let env: IsolationEnv;
let lenderId: string;
let otherLenderId: string;
let productVersionId: string;
let otherProductVersionId: string;

const MAKER: PermissionCode[] = ['lender_policy.read', 'lender_policy.manage'];
const CHECKER: PermissionCode[] = ['lender_policy.read', 'rule.approve'];
/** The DSA owner holds both, which is exactly why SOD-01 matters. */
const OWNER: PermissionCode[] = ['lender_policy.read', 'lender_policy.manage', 'rule.approve'];

const maker = () => env.appAs(env.A, MAKER, 0);
const checker = () => env.appAs(env.A, CHECKER, 1);
const etag = (res: request.Response) => res.headers.etag as string;
let n = 0;
const key = () => `lpo-int-${String(++n).padStart(6, '0')}`;

const terms = {
  minBureauScore: 700,
  minAge: 21,
  maxAgeAtMaturity: 60,
  minIncome: { amount: '25000.00', currency: 'INR' },
  foirCapBps: 5000,
  rateMinBps: 1050,
  rateMaxBps: 1200,
  serviceablePincodes: ['411', '560034'],
  allowedEmployment: ['SALARIED'],
  effectiveFrom: '2026-01-01T00:00:00Z',
};

async function lenderWithVersion(name: string): Promise<{ lenderId: string; productVersionId: string }> {
  const a = env.appAs(env.A, ALL_ADMIN);
  const lender = await request(a)
    .post('/v1/lenders')
    .set('Idempotency-Key', key())
    .send({ name, lenderType: 'NBFC' });
  const product = await request(a)
    .post('/v1/products')
    .set('Idempotency-Key', key())
    .send({
      lenderId: lender.body.id,
      name: `${name} PL`,
      category: 'PL',
      applicantTypes: ['SALARIED'],
      secured: false,
    });
  const version = await request(a)
    .post(`/v1/products/${product.body.id}/versions`)
    .set('Idempotency-Key', key())
    .send({ amountMin: '50000.00', amountMax: '1500000.00', tenureMinMonths: 12, tenureMaxMonths: 60 });
  expect(version.status).toBe(201);
  return { lenderId: lender.body.id, productVersionId: version.body.id };
}

async function createDraft(body: Record<string, unknown> = {}, app = maker()) {
  return request(app)
    .post('/v1/lender-policies')
    .set('Idempotency-Key', key())
    .send({ lenderId, productVersionId, ...terms, ...body });
}

const activate = (id: string, tag: string, app = checker()) =>
  request(app)
    .post(`/v1/lender-policies/${id}/transitions`)
    .set('If-Match', tag)
    .send({ action: 'ACTIVATE' });

async function auditActions(entityId: string): Promise<string[]> {
  const r = await env.admin.query(
    `select action from app.audit_event where entity_id = $1 order by occurred_at, id`,
    [entityId],
  );
  return r.rows.map((x) => x.action as string);
}

async function outboxTypes(subjectId: string): Promise<string[]> {
  const r = await env.admin.query(
    `select event_type from app.outbox_event where subject_id = $1 order by created_at, id`,
    [subjectId],
  );
  return r.rows.map((x) => x.event_type as string);
}

beforeAll(async () => {
  env = await startIsolationEnv();
  ({ lenderId, productVersionId } = await lenderWithVersion('Policy Lender'));
  ({ lenderId: otherLenderId, productVersionId: otherProductVersionId } =
    await lenderWithVersion('Other Lender'));
}, 240_000);
afterAll(async () => {
  await env?.stop();
});

describe('P1-04 lender policy drafts', () => {
  it('TEST-LPO-INT-001 create returns the DRAFT with ETag "0", version 1, the maker as editor, and audits it', async () => {
    const res = await createDraft();
    expect(res.status).toBe(201);
    expect(etag(res)).toBe('"0"');
    expect(res.body).toMatchObject({
      status: 'DRAFT',
      versionNo: 1,
      lenderId,
      productVersionId,
      minIncome: { amount: '25000.00', currency: 'INR' },
      serviceablePincodes: ['411', '560034'],
      editors: [env.A.userIds[0]],
      approvedBy: null,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
    });
    expect(res.body.id).toMatch(/^lpo_/);
    expect(await auditActions(res.body.id)).toEqual(['lender_policy.created']);
  });

  it('TEST-LPO-INT-002 the same Idempotency-Key replays the same draft; version numbers count up per pair', async () => {
    const k = key();
    const body = { lenderId, productVersionId, ...terms };
    const first = await request(maker()).post('/v1/lender-policies').set('Idempotency-Key', k).send(body);
    const again = await request(maker()).post('/v1/lender-policies').set('Idempotency-Key', k).send(body);
    expect(again.status).toBe(201);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(again.body.id).toBe(first.body.id);
    const next = await createDraft();
    expect(next.body.versionNo).toBe(first.body.versionNo + 1);
  });

  it('TEST-LPO-INT-003 a product version of another lender is 422; an unknown lender or version is 404', async () => {
    const mismatch = await createDraft({ productVersionId: otherProductVersionId });
    expect(mismatch.status).toBe(422);
    expect(mismatch.body.error.details[0].issue).toBe('NOT_A_PRODUCT_OF_THIS_LENDER');
    const noLender = await createDraft({ lenderId: 'lnd_01JD8Y3Z4K5M6N7P8Q9R0S1T2V' });
    expect(noLender.status).toBe(404);
    const noVersion = await createDraft({ productVersionId: 'prv_01JD8Y3Z4K5M6N7P8Q9R0S1T2V' });
    expect(noVersion.status).toBe(404);
    expect(otherLenderId).toMatch(/^lnd_/);
  });

  it('TEST-LPO-INT-004 a patch edits the draft, bumps the ETag, adds the editor once, and checks the merged terms', async () => {
    const created = await createDraft();
    const id = created.body.id as string;
    // A second maker edits: they join editors, so neither of them may activate it later.
    const patched = await request(env.appAs(env.A, MAKER, 1))
      .patch(`/v1/lender-policies/${id}`)
      .set('If-Match', etag(created))
      .send({ foirCapBps: 4500, minIncome: null });
    expect(patched.status).toBe(200);
    expect(etag(patched)).toBe('"1"');
    expect(patched.body).toMatchObject({ foirCapBps: 4500, minIncome: null });
    expect(patched.body.editors).toEqual([env.A.userIds[0], env.A.userIds[1]]);

    // rateMaxBps below the stored rateMinBps: only one side is in the body, so the merged check catches it.
    const inconsistent = await request(maker())
      .patch(`/v1/lender-policies/${id}`)
      .set('If-Match', etag(patched))
      .send({ rateMaxBps: 900 });
    expect(inconsistent.status).toBe(422);
    expect(inconsistent.body.error.details[0].field).toBe('rateMaxBps');

    const stale = await request(maker())
      .patch(`/v1/lender-policies/${id}`)
      .set('If-Match', etag(created))
      .send({ foirCapBps: 4000 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    expect(await auditActions(id)).toEqual(['lender_policy.created', 'lender_policy.updated']);
  });
});

describe('P1-04 maker-checker activation (SOD-01) and the one-active rule', () => {
  it('TEST-LPO-INT-005 the maker cannot activate their own draft, even holding rule.approve (403 SOD_VIOLATION)', async () => {
    const created = await createDraft({}, env.appAs(env.A, OWNER, 0));
    const res = await activate(created.body.id, etag(created), env.appAs(env.A, OWNER, 0));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SOD_VIOLATION');
    const after = await request(maker()).get(`/v1/lender-policies/${created.body.id}`);
    expect(after.body.status).toBe('DRAFT');
  });

  it('TEST-LPO-INT-006 another user activates: ACTIVE, approvedBy set, previous ACTIVE retired, audited and emitted', async () => {
    const pair = await lenderWithVersion('Activation Lender');
    const v1 = await createDraft(pair);
    const a1 = await activate(v1.body.id, etag(v1));
    expect(a1.status).toBe(200);
    expect(a1.body).toMatchObject({ status: 'ACTIVE', approvedBy: env.A.userIds[1] });
    expect(a1.body.approvedAt).toMatch(/Z$/);

    const v2 = await createDraft(pair);
    const a2 = await activate(v2.body.id, etag(v2));
    expect(a2.status).toBe(200);
    const old = await request(maker()).get(`/v1/lender-policies/${v1.body.id}`);
    expect(old.body).toMatchObject({ status: 'RETIRED' });
    expect(old.body.retiredAt).toMatch(/Z$/);

    const active = await request(maker()).get(
      `/v1/lender-policies?lenderId=${pair.lenderId}&productVersionId=${pair.productVersionId}&status=ACTIVE`,
    );
    expect(active.body.data.map((p: { id: string }) => p.id)).toEqual([v2.body.id]);

    expect(await auditActions(v1.body.id)).toEqual([
      'lender_policy.created',
      'lender_policy.activated',
      'lender_policy.retired',
    ]);
    expect(await outboxTypes(v1.body.id)).toEqual(['lender_policy.activated', 'lender_policy.retired']);
    expect(await outboxTypes(v2.body.id)).toEqual(['lender_policy.activated']);
  });

  it('TEST-LPO-INT-007 an active policy is not editable or re-activatable; a stale ETag on activation is 409', async () => {
    const pair = await lenderWithVersion('Frozen Lender');
    const draft = await createDraft(pair);
    const stale = await activate(draft.body.id, '"7"');
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    const active = await activate(draft.body.id, etag(draft));
    const edit = await request(maker())
      .patch(`/v1/lender-policies/${draft.body.id}`)
      .set('If-Match', etag(active))
      .send({ foirCapBps: 4000 });
    expect(edit.status).toBe(409);
    expect(edit.body.error.code).toBe('INVALID_STATE');
    const again = await activate(draft.body.id, etag(active));
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('INVALID_TRANSITION');
  });

  it('TEST-LPO-INT-008 a policy whose end date has passed cannot be activated', async () => {
    const draft = await createDraft({
      effectiveFrom: '2025-01-01T00:00:00Z',
      effectiveTo: '2025-06-30T00:00:00Z',
    });
    const res = await activate(draft.body.id, etag(draft));
    expect(res.status).toBe(409);
    expect(res.body.error.details[0].issue).toBe('IN_THE_PAST');
  });

  it('TEST-LPO-INT-009 RETIRE takes an active policy out; a draft cannot be retired', async () => {
    const pair = await lenderWithVersion('Retire Lender');
    const draft = await createDraft(pair);
    const notActive = await request(maker())
      .post(`/v1/lender-policies/${draft.body.id}/transitions`)
      .set('If-Match', etag(draft))
      .send({ action: 'RETIRE' });
    expect(notActive.status).toBe(409);
    expect(notActive.body.error.code).toBe('INVALID_TRANSITION');

    const active = await activate(draft.body.id, etag(draft));
    const retired = await request(maker())
      .post(`/v1/lender-policies/${draft.body.id}/transitions`)
      .set('If-Match', etag(active))
      .send({ action: 'RETIRE' });
    expect(retired.status).toBe(200);
    expect(retired.body.status).toBe('RETIRED');
    expect(await outboxTypes(draft.body.id)).toEqual(['lender_policy.activated', 'lender_policy.retired']);
  });
});

describe('P1-04 lender policy list', () => {
  it('TEST-LPO-INT-010 filters and cursor pagination', async () => {
    const page1 = await request(maker()).get(`/v1/lender-policies?lenderId=${lenderId}&status=DRAFT&limit=2`);
    expect(page1.status).toBe(200);
    expect(page1.body.data).toHaveLength(2);
    expect(page1.body.meta.limit).toBe(2);
    expect(page1.body.meta.nextCursor).toBeTruthy();
    const page2 = await request(maker()).get(
      `/v1/lender-policies?lenderId=${lenderId}&status=DRAFT&limit=2&cursor=${encodeURIComponent(page1.body.meta.nextCursor)}`,
    );
    const ids = [...page1.body.data, ...page2.body.data].map((p: { id: string }) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of [...page1.body.data, ...page2.body.data])
      expect(p).toMatchObject({ lenderId, status: 'DRAFT' });
  });
});
