// GET /public/v1/auth/config reports the same second-factor setting that the API enforces (SUPABASE_MFA_ENABLED, DISABLE_MFA).
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createAuthConfigRouter } from '../src/http/auth-config-router';
import { createTestApp } from './support/fake-auth';

const KEYS = ['SUPABASE_MFA_ENABLED', 'DISABLE_MFA', 'NODE_ENV', 'SUPABASE_URL', 'DATABASE_URL', 'TEST_DATABASE_HOSTS'] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

// A hosted project and a hosted database: the developer switch is never honoured here.
function hosted() {
  process.env.NODE_ENV = 'test';
  process.env.SUPABASE_URL = 'https://mlpkwwhnagxzinaohdxg.supabase.co';
  process.env.DATABASE_URL = 'postgresql://dsa_api@db.example.com:6543/postgres';
  delete process.env.TEST_DATABASE_HOSTS;
}

function standalone() {
  const app = express();
  app.use(createAuthConfigRouter());
  return app;
}

describe('GET /public/v1/auth/config', () => {
  it('reports second factors ON when SUPABASE_MFA_ENABLED is unset (the default)', async () => {
    hosted();
    delete process.env.SUPABASE_MFA_ENABLED;
    const res = await request(standalone()).get('/auth/config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ mfaEnabled: true });
  });

  it('reports second factors ON when SUPABASE_MFA_ENABLED=true', async () => {
    hosted();
    process.env.SUPABASE_MFA_ENABLED = 'true';
    expect((await request(standalone()).get('/auth/config')).body).toEqual({ mfaEnabled: true });
  });

  it('reports second factors OFF when SUPABASE_MFA_ENABLED=false', async () => {
    hosted();
    process.env.SUPABASE_MFA_ENABLED = 'false';
    expect((await request(standalone()).get('/auth/config')).body).toEqual({ mfaEnabled: false });
  });

  it('the developer switch does not turn second factors off against a hosted project', async () => {
    hosted();
    delete process.env.SUPABASE_MFA_ENABLED;
    process.env.DISABLE_MFA = 'true';
    expect((await request(standalone()).get('/auth/config')).body).toEqual({ mfaEnabled: true });
  });

  it('is never cached and returns nothing but the setting', async () => {
    hosted();
    process.env.SUPABASE_MFA_ENABLED = 'false';
    const res = await request(standalone()).get('/auth/config');
    expect(res.headers['cache-control']).toMatch(/no-store/);
    expect(Object.keys(res.body)).toEqual(['mfaEnabled']);
  });

  it('is mounted in the application without a token and without test login', async () => {
    hosted();
    process.env.SUPABASE_MFA_ENABLED = 'false';
    const res = await request(createTestApp()).get('/public/v1/auth/config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ mfaEnabled: false });
  });
});
