// /v1 responses are per user and must never be cached or revalidated (owner: Dev 1). Record ETags such as "0" repeat
// across users, so a 304 for one user's If-None-Match would show the previous user's data in the browser.
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestApp, fakeAuth, testPrincipal } from './support/fake-auth';

const app = () => createTestApp({ auth: fakeAuth(testPrincipal()) });

describe('TEST-SEC-CACHE /v1 cache headers', () => {
  it('TEST-SEC-CACHE-01 every /v1 response is no-store and varies by Authorization', async () => {
    const res = await request(app()).get('/v1/no-such-route');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers.vary).toMatch(/Authorization/i);
  });

  it('TEST-SEC-CACHE-02 an unauthenticated /v1 response is no-store too', async () => {
    const res = await request(createTestApp()).get('/v1/me');
    expect(res.status).toBe(401);
    expect(res.headers['cache-control']).toBe('no-store');
  });
});
