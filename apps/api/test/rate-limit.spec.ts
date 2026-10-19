// Rate limiting (TASK-105, Contracts §5): token bucket per caller, 429 RATE_LIMITED with Retry-After and RateLimit-* headers.
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorHandler } from '../src/http/error-handler';
import { rateLimit } from '../src/http/rate-limit';
import { fakeAuth, testPrincipal } from './support/fake-auth';

function appWith(opts: Parameters<typeof rateLimit>[0], principalId?: string) {
  const app = express();
  if (principalId) app.use(fakeAuth(testPrincipal({ id: principalId })));
  app.use(rateLimit(opts));
  app.all('*splat', (_req, res) => {
    res.json({ ok: true });
  });
  app.use(errorHandler());
  return app;
}

describe('TEST-RATE-LIMIT token bucket', () => {
  it('TEST-RATE-001 allows the configured rate, then answers 429 RATE_LIMITED with Retry-After', async () => {
    let t = 0;
    const app = appWith({ perMinute: 3, now: () => t }, 'usr_rate_a');
    for (let i = 0; i < 3; i++) {
      const ok = await request(app).get('/v1/leads');
      expect(ok.status).toBe(200);
      expect(ok.headers['ratelimit-limit']).toBe('3');
    }
    const limited = await request(app).get('/v1/leads');
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(limited.body.error.retryable).toBe(true);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);

    t += 20_000; // a third of a minute refills one of three tokens
    expect((await request(app).get('/v1/leads')).status).toBe(200);
  });

  it('TEST-RATE-002 rule-authoring writes have their own, smaller bucket; reads are not counted against it', async () => {
    const app = appWith({ perMinute: 100, ruleAuthoringPerMinute: 1, now: () => 0 }, 'usr_rate_b');
    expect((await request(app).post('/rule-sets').send({})).status).toBe(200);
    expect((await request(app).post('/rule-set-versions/rsv_1/validate').send({})).status).toBe(429);
    expect((await request(app).get('/rule-sets')).status).toBe(200);
  });

  it('TEST-RATE-003 callers are limited separately', async () => {
    const opts = { perMinute: 1, now: () => 0 };
    const limiter = rateLimit(opts);
    const app = express();
    app.use((req, _res, next) => {
      req.ctx = {
        principal: testPrincipal({ id: String(req.headers['x-user']) }),
        correlationId: 'c',
        now: new Date(0),
      };
      next();
    });
    app.use(limiter);
    app.get('/x', (_req, res) => {
      res.json({});
    });
    app.use(errorHandler());
    expect((await request(app).get('/x').set('x-user', 'usr_1')).status).toBe(200);
    expect((await request(app).get('/x').set('x-user', 'usr_2')).status).toBe(200);
    expect((await request(app).get('/x').set('x-user', 'usr_1')).status).toBe(429);
  });
});
