import { ErrorEnvelope } from '@dsa/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestApp, fakeAuth, testPrincipal } from './support/fake-auth';

describe('app skeleton', () => {
  it('TEST-KRN-005 GET /health is 200 without a token', async () => {
    const res = await request(createTestApp()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('TEST-KRN-005 GET /v1/anything without a token is a 401 error envelope', async () => {
    const res = await request(createTestApp()).get('/v1/anything');
    expect(res.status).toBe(401);
    const body = ErrorEnvelope.parse(res.body);
    expect(body.error.code).toBe('UNAUTHENTICATED');
    expect(body.error.httpStatus).toBe(401);
    expect(body.error.retryable).toBe(false);
    expect(body.error.correlationId).toBe(res.headers['x-correlation-id']);
  });

  it('echoes a valid X-Correlation-Id and replaces an invalid one', async () => {
    const app = createTestApp();
    const echoed = await request(app).get('/health').set('X-Correlation-Id', 'abc12345-test');
    expect(echoed.headers['x-correlation-id']).toBe('abc12345-test');
    const replaced = await request(app).get('/health').set('X-Correlation-Id', 'bad id; drop');
    expect(replaced.headers['x-correlation-id']).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('returns a 404 envelope for an unknown /v1 route once authenticated', async () => {
    const res = await request(createTestApp({ auth: fakeAuth(testPrincipal()) })).get('/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(ErrorEnvelope.parse(res.body).error.code).toBe('NOT_FOUND');
  });

  it('returns a 400 MALFORMED_REQUEST envelope for unparseable JSON', async () => {
    const res = await request(createTestApp({ auth: fakeAuth(testPrincipal()) }))
      .post('/v1/leads')
      .set('Content-Type', 'application/json')
      .send('{"not json');
    expect(res.status).toBe(400);
    expect(ErrorEnvelope.parse(res.body).error.code).toBe('MALFORMED_REQUEST');
  });
});
