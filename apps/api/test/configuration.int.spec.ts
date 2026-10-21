// MOD-CFG settings, labels, calendars, picklists and configuration bundles (API-CFG-001..009) against a real database (M-082),
// with the production wiring. Synthetic data only.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startIsolationEnv, type IsolationEnv } from '../../../tests/isolation/harness';

let env: IsolationEnv;
beforeAll(async () => {
  env = await startIsolationEnv();
}, 240_000);
afterAll(async () => {
  await env?.stop();
});

const admin = () => env.appAs(env.A, ['config.manage']);
const staff = () => env.appAs(env.A, []);

describe('TEST-CFG-INT tenant configuration', () => {
  it('TEST-CFG-INT-01 API-CFG-001/002 a value resolves tenant → branch; a locked tenant value wins; bad values are refused', async () => {
    const first = await request(staff()).get('/v1/settings/effective');
    const followUp = first.body.data.find((s: { key: string }) => s.key === 'lead.followUpDefaultHours');
    expect(followUp).toMatchObject({ value: 24, origin: { scopeType: 'PLATFORM' } });

    const bad = await request(admin())
      .put('/v1/settings/TENANT/lead.followUpDefaultHours')
      .set('If-Match', '"0"')
      .send({ value: 999 });
    expect(bad.status).toBe(422);
    const tenant = await request(admin())
      .put('/v1/settings/TENANT/lead.followUpDefaultHours')
      .set('If-Match', '"0"')
      .send({ value: 48 });
    expect(tenant.status, JSON.stringify(tenant.body)).toBe(200);
    const branch = await request(admin())
      .put(`/v1/settings/BRANCH:${env.A.branchId}/lead.followUpDefaultHours`)
      .set('If-Match', '"0"')
      .send({ value: 12 });
    expect(branch.status).toBe(200);
    let eff = await request(staff()).get(`/v1/settings/effective?branchId=${env.A.branchId}`);
    expect(eff.body.data.find((s: { key: string }) => s.key === 'lead.followUpDefaultHours')).toMatchObject({
      value: 12,
      origin: { scopeType: 'BRANCH', scopeId: env.A.branchId },
    });

    const lock = await request(admin())
      .put('/v1/settings/TENANT/lead.followUpDefaultHours')
      .set('If-Match', `"${tenant.body.version}"`)
      .send({ value: 48, locked: true });
    expect(lock.status).toBe(200);
    eff = await request(staff()).get(`/v1/settings/effective?branchId=${env.A.branchId}`);
    expect(eff.body.data.find((s: { key: string }) => s.key === 'lead.followUpDefaultHours')).toMatchObject({
      value: 48,
      locked: true,
    });
    expect(
      (
        await request(staff())
          .put('/v1/settings/TENANT/lead.followUpDefaultHours')
          .set('If-Match', '"0"')
          .send({ value: 1 })
      ).status,
    ).toBe(403);
  });

  it('TEST-CFG-INT-02 API-CFG-003..007 labels, calendars and picklists', async () => {
    const labels = await request(admin())
      .put('/v1/labels')
      .set('If-Match', '"0"')
      .send({
        locale: 'en-IN',
        entries: [{ canonicalKey: 'LEAD.QUALIFIED', label: 'Hot lead', subStageOf: null }],
      });
    expect(labels.status, JSON.stringify(labels.body)).toBe(200);
    expect((await request(staff()).get('/v1/labels?locale=en-IN')).body.entries[0].label).toBe('Hot lead');

    const cal = await request(admin())
      .put('/v1/calendars/cal_mumbai_main')
      .set('If-Match', '"0"')
      .send({
        name: 'Mumbai office',
        weeklyHours: { MON: [{ start: '09:30', end: '18:30' }] },
        holidays: ['2026-11-08'],
        quietHours: { start: '09:00', end: '20:00' },
      });
    expect(cal.status, JSON.stringify(cal.body)).toBe(200);
    const again = await request(admin())
      .put('/v1/calendars/cal_mumbai_main')
      .set('If-Match', '"0"')
      .send({ name: 'Mumbai office', weeklyHours: {} });
    expect(again.status).toBe(409);
    expect((await request(staff()).get('/v1/calendars')).body.data[0].holidays).toEqual(['2026-11-08']);

    const pv = await request(admin())
      .post('/v1/picklists/CALL_OUTCOME/values')
      .set('Idempotency-Key', 'cfg_pick_000001')
      .send({ code: 'CALLBACK_LATER', label: 'Call back later' });
    expect(pv.status).toBe(201);
    expect(
      (await request(staff()).get('/v1/picklists/CALL_OUTCOME')).body.data.map(
        (v: { code: string }) => v.code,
      ),
    ).toEqual(['CALLBACK_LATER']);
  });

  it('TEST-CFG-INT-03 API-CFG-008/009 export a bundle and import it back as a draft; another tenant sees nothing', async () => {
    const exported = await request(admin())
      .post('/v1/config-bundles/export')
      .set('Idempotency-Key', 'cfg_export_00001')
      .send({});
    expect(exported.status).toBe(200);
    expect(exported.body.settings.length).toBeGreaterThan(0);
    const imported = await request(admin())
      .post('/v1/config-bundles/import')
      .set('Idempotency-Key', 'cfg_import_00001')
      .send(exported.body);
    expect(imported.status, JSON.stringify(imported.body)).toBe(202);
    expect(imported.body.status).toBe('DRAFT');
    const b = env.appAs(env.B, ['config.manage']);
    expect((await request(b).get('/v1/calendars')).body.data).toEqual([]);
    expect((await request(b).get('/v1/picklists/CALL_OUTCOME')).body.data).toEqual([]);
  });
});
