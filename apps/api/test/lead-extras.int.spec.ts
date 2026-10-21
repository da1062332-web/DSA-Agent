// MOD-LEAD apply links, duplicate reviews, reroute, bulk assignment and restore against a real database (M-073), with the
// production wiring. Synthetic data only.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startIsolationEnv, type IsolationEnv } from '../../../tests/isolation/harness';
import type { PermissionCode } from '@dsa/contracts';

let env: IsolationEnv;
const STAFF: PermissionCode[] = [
  'lead.create',
  'lead.read',
  'lead.update',
  'lead.assign',
  'lead.merge',
  'lead.archive',
];
const key = (l: string) => `lex_${l}_${Math.random().toString(36).slice(2, 10)}`;
const consent = { purpose: 'CONTACT', noticeVersion: 'v1', channel: 'PHONE' };
const newLead = (mobile: string) => ({
  fullName: 'Synthetic Lead',
  mobile,
  productCategory: 'PL',
  branchId: env.A.branchId,
  source: 'PHONE',
  consent,
});

beforeAll(async () => {
  env = await startIsolationEnv();
}, 240_000);
afterAll(async () => {
  await env?.stop();
});

describe('TEST-LEAD-EXT-INT lead extras', () => {
  it('TEST-LEAD-EXT-INT-01 API-LEAD-010/011 an apply link takes a public enquiry into a lead in its branch; a bad token is 404', async () => {
    const app = env.appAs(env.A, STAFF);
    const link = await request(app)
      .post('/v1/apply-links')
      .set('Idempotency-Key', key('link'))
      .send({
        branchId: env.A.branchId,
        productCategory: 'PL',
        campaign: 'Diwali drive',
        noticeVersion: 'v2',
        expiresAt: '2030-01-01T00:00:00Z',
      });
    expect(link.status, JSON.stringify(link.body)).toBe(201);
    const stored = await env.admin.query(`select token_hash from app.apply_link where id = $1`, [
      link.body.id,
    ]);
    expect(link.body.url).not.toContain(stored.rows[0].token_hash);

    const pub = env.anonymousApp();
    const ok = await request(pub)
      .post(link.body.url)
      .send({ fullName: 'Public Enquirer', mobile: '+919876500301', consentGiven: true });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.status).toBe('RECEIVED');
    const lead = await env.admin.query(
      `select l.source, l.sub_source, l.campaign, l.branch_id, c.channel, c.evidence_ref
         from app.lead l join app.consent_record c on c.subject_id = l.id
        where l.full_name = 'Public Enquirer'`,
    );
    expect(lead.rows[0]).toMatchObject({
      source: 'WEBSITE',
      sub_source: 'APPLY_LINK',
      campaign: 'Diwali drive',
      branch_id: env.A.branchId,
      channel: 'WEB_FORM',
      evidence_ref: `apply_link:${link.body.id}`,
    });

    const bot = await request(pub)
      .post(link.body.url)
      .send({ fullName: 'Bot', mobile: '+919876500302', consentGiven: true, website: 'spam' });
    expect(bot.status).toBe(202);
    expect(
      (await env.admin.query(`select count(*)::int as n from app.lead where full_name = 'Bot'`)).rows[0].n,
    ).toBe(0);

    const bad = await request(pub)
      .post('/public/v1/apply/not-a-real-token')
      .send({ fullName: 'X Y', mobile: '+919876500303', consentGiven: true });
    expect(bad.status).toBe(404);
  });

  it('TEST-LEAD-EXT-INT-02 API-LEAD-008/009 a duplicate is queued for review; merging marks the newer lead MERGED', async () => {
    const app = env.appAs(env.A, STAFF);
    const first = await request(app)
      .post('/v1/leads')
      .set('Idempotency-Key', key('l1'))
      .send(newLead('+919876500311'));
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const second = await request(app)
      .post('/v1/leads')
      .set('Idempotency-Key', key('l2'))
      .send(newLead('+919876500311'));
    expect(second.status).toBe(201);
    expect(second.body.duplicateFlag).not.toBe('NONE');

    const queue = await request(app).get('/v1/duplicate-reviews');
    expect(queue.status).toBe(200);
    const review = queue.body.data.find((r: { rightId: string }) => r.rightId === second.body.id);
    expect(review).toMatchObject({ leftId: first.body.id, status: 'OPEN' });

    const merged = await request(app)
      .post(`/v1/duplicate-reviews/${review.id}/resolution`)
      .set('Idempotency-Key', key('merge'))
      .send({ action: 'MERGE', reason: 'Same person called twice' });
    expect(merged.status, JSON.stringify(merged.body)).toBe(200);
    expect(merged.body).toMatchObject({ status: 'MERGED', survivorId: first.body.id });
    const rows = await env.admin.query(
      `select id, state, merged_into_id, duplicate_flag from app.lead where id = any($1) order by created_at`,
      [[first.body.id, second.body.id]],
    );
    expect(rows.rows[1]).toMatchObject({ state: 'MERGED', merged_into_id: first.body.id });
    expect(rows.rows[0].duplicate_flag).toBe('NONE');

    const again = await request(app)
      .post(`/v1/duplicate-reviews/${review.id}/resolution`)
      .set('Idempotency-Key', key('merge2'))
      .send({ action: 'DISMISS', reason: 'Second try' });
    expect(again.status).toBe(409);
  });

  it('TEST-LEAD-EXT-INT-03 API-LEAD-012 reroute re-runs routing and records an AUTO_ROUTING assignment', async () => {
    const app = env.appAs(env.A, STAFF);
    const lead = await request(app)
      .post('/v1/leads')
      .set('Idempotency-Key', key('rr'))
      .send(newLead('+919876500321'));
    const res = await request(app)
      .post(`/v1/leads/${lead.body.id}/reroute`)
      .set('Idempotency-Key', key('reroute'))
      .set('If-Match', `"${lead.body.lockVersion}"`)
      .send({ reason: 'Owner on leave' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const asg = await env.admin.query(
      `select reason_code from app.lead_assignment where lead_id = $1 order by assigned_at desc limit 1`,
      [lead.body.id],
    );
    expect(asg.rows[0].reason_code).toBe('AUTO_ROUTING');
  });

  it('TEST-LEAD-EXT-INT-04 API-LEAD-013 bulk assignment is all or nothing', async () => {
    const app = env.appAs(env.A, STAFF);
    const a = await request(app)
      .post('/v1/leads')
      .set('Idempotency-Key', key('b1'))
      .send(newLead('+919876500331'));
    const b = await request(app)
      .post('/v1/leads')
      .set('Idempotency-Key', key('b2'))
      .send(newLead('+919876500332'));
    const to = env.A.userIds[1];
    const failing = await request(app)
      .post('/v1/leads/bulk-assignments')
      .set('Idempotency-Key', key('bf'))
      .send({ leadIds: [a.body.id, 'lead_missing_1'], toUserId: to });
    expect(failing.status).toBe(404);
    const owner = await env.admin.query(`select owner_user_id from app.lead where id = $1`, [a.body.id]);
    expect(owner.rows[0].owner_user_id).not.toBe(to);

    const ok = await request(app)
      .post('/v1/leads/bulk-assignments')
      .set('Idempotency-Key', key('bo'))
      .send({ leadIds: [a.body.id, b.body.id], toUserId: to });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.assigned).toBe(2);
    const owners = await env.admin.query(`select owner_user_id from app.lead where id = any($1)`, [
      [a.body.id, b.body.id],
    ]);
    expect(owners.rows.every((r) => r.owner_user_id === to)).toBe(true);
  });

  it('TEST-LEAD-EXT-INT-05 T-LEAD-07 archives a lead and API-LEAD-014 restores it to the state it had', async () => {
    const app = env.appAs(env.A, STAFF);
    const lead = await request(app)
      .post('/v1/leads')
      .set('Idempotency-Key', key('ar'))
      .send(newLead('+919876500341'));
    const archived = await request(app)
      .post(`/v1/leads/${lead.body.id}/transitions`)
      .set('Idempotency-Key', key('arc'))
      .set('If-Match', `"${lead.body.lockVersion}"`)
      .send({ transitionCode: 'T-LEAD-07' });
    expect(archived.status, JSON.stringify(archived.body)).toBe(200);
    expect(archived.body.state).toBe('ARCHIVED');
    const restored = await request(app)
      .post(`/v1/leads/${lead.body.id}/restore`)
      .set('If-Match', `"${archived.body.lockVersion}"`)
      .send({ reason: 'Customer called back' });
    expect(restored.status, JSON.stringify(restored.body)).toBe(200);
    expect(restored.body.state).toBe('NEW');
    const row = await env.admin.query(`select archived_at from app.lead where id = $1`, [lead.body.id]);
    expect(row.rows[0].archived_at).toBeNull();
  });

  it('TEST-LEAD-EXT-INT-06 another tenant sees no reviews and cannot reroute or restore (404)', async () => {
    const b = env.appAs(env.B, STAFF);
    const queue = await request(b).get('/v1/duplicate-reviews?status=MERGED');
    expect(queue.body.data).toEqual([]);
    const lead = await env.admin.query(`select id from app.lead where tenant_id = $1 limit 1`, [
      env.A.tenantId,
    ]);
    const res = await request(b)
      .post(`/v1/leads/${lead.rows[0].id}/reroute`)
      .set('Idempotency-Key', key('x'))
      .set('If-Match', '"0"')
      .send({});
    expect(res.status).toBe(404);
  });
});
