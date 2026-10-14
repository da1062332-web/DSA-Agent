// /v1/me against a real database (owner: Dev 1). Every seeded user has lock_version 0, so they share the ETag "0".
// A browser that revalidates with If-None-Match must still get the caller's own record, never a 304.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startIsolationEnv, type IsolationEnv } from '../../../tests/isolation/harness';

let env: IsolationEnv;
beforeAll(async () => {
  env = await startIsolationEnv();
}, 180_000);
afterAll(async () => {
  await env?.stop();
});

describe('TEST-SEC-CACHE-INT /v1/me with a shared ETag', () => {
  it('TEST-SEC-CACHE-INT-01 two users sending If-None-Match "0" each get 200 and their own identity', async () => {
    const first = await request(env.appAs(env.A)).get('/v1/me').set('If-None-Match', '"0"');
    const second = await request(env.appAs(env.A, [], 1))
      .get('/v1/me')
      .set('If-None-Match', '"0"');
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.headers.etag).toBe(second.headers.etag);
    expect(first.body.id).toBe(env.A.userIds[0]);
    expect(second.body.id).toBe(env.A.userIds[1]);
    expect(first.headers['cache-control']).toBe('no-store');
  });
});
