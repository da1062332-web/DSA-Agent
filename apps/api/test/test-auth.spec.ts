// The test-login gate (owner: Dev 1). Pure checks: no database and no network. Messages must name settings, never values.
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { isApprovedTestDatabase, resolveTestAuth, testAuthProblems } from '../src/test-auth';
import { createTestApp } from './support/fake-auth';

const LOCAL = 'http://127.0.0.1:54321';
const HOSTED = 'https://mlpkwwhnagxzinaohdxg.supabase.co';
const LOCAL_DB = 'postgresql://dsa_api:localpassword@localhost:5432/postgres';
const POOLER_DB = 'postgresql://dsa_api.mlpkwwhnagxzinaohdxg@aws-1-ap-south-1.pooler.supabase.com:6543/postgres';
const DIRECT_DB = 'postgresql://postgres@db.mlpkwwhnagxzinaohdxg.supabase.co:5432/postgres';
const SECRET = 'a-unique-test-secret-for-this-machine-0123456789';
const PUBLISHED = 'dsa-crm-test-bypass-jwt-secret-key-2026';

type Settings = Parameters<typeof resolveTestAuth>[0];
const local: Settings = {
  TEST_AUTH_ENABLED: true,
  TEST_BYPASS_OTP: '000000',
  SUPABASE_URL: LOCAL,
  DATABASE_URL: LOCAL_DB,
  BYPASS_JWT_SECRET: SECRET,
};
const withSettings = (overrides: Partial<Settings>): Settings => ({ ...local, ...overrides });

describe('test-login gate', () => {
  it('TEST-AUTH-01 on the local stack with a local database and its own secret, the fixed code is available', () => {
    expect(resolveTestAuth(local)).toEqual({ supabaseUrl: LOCAL, secret: SECRET, otp: '000000' });
  });

  it('TEST-AUTH-02 is off unless TEST_AUTH_ENABLED is true, whatever the other settings say', () => {
    expect(resolveTestAuth(withSettings({ TEST_AUTH_ENABLED: false }))).toBeUndefined();
    expect(
      resolveTestAuth(withSettings({ TEST_AUTH_ENABLED: false, SUPABASE_URL: HOSTED, DATABASE_URL: POOLER_DB })),
    ).toBeUndefined();
  });

  it('TEST-AUTH-03 refuses the shared project and names the setting, never the URL, the password or the project', () => {
    const attempt = () =>
      resolveTestAuth(withSettings({ SUPABASE_URL: HOSTED, DATABASE_URL: POOLER_DB, BYPASS_JWT_SECRET: SECRET }));
    expect(attempt).toThrow(/SUPABASE_URL/);
    try {
      attempt();
    } catch (err) {
      const text = (err as Error).message;
      expect(text).not.toContain('mlpkwwhnagxzinaohdxg');
      expect(text).not.toContain('postgresql://');
      expect(text).not.toContain(SECRET);
    }
  });

  it('TEST-AUTH-04 refuses a hosted database even when the URL is local, in both the pooler and direct forms', () => {
    expect(testAuthProblems(withSettings({ DATABASE_URL: POOLER_DB })).join('\n')).toMatch(/DATABASE_URL/);
    expect(testAuthProblems(withSettings({ DATABASE_URL: DIRECT_DB })).join('\n')).toMatch(/DATABASE_URL/);
  });

  it('TEST-AUTH-05 accepts an approved isolated test database by its host, and only that host', () => {
    const approved = 'postgresql://dsa_test:pw@test-db.internal:5432/dsa';
    expect(isApprovedTestDatabase(approved, 'test-db.internal')).toBe(true);
    expect(isApprovedTestDatabase(approved, 'other-db.internal')).toBe(false);
    expect(isApprovedTestDatabase(approved, undefined)).toBe(false);
    expect(resolveTestAuth(withSettings({ DATABASE_URL: approved, TEST_DATABASE_HOSTS: 'test-db.internal' }))).toEqual({
      supabaseUrl: LOCAL,
      secret: SECRET,
      otp: '000000',
    });
  });

  it('TEST-AUTH-06 never treats the shared project as a test database, even when its host is listed', () => {
    expect(isApprovedTestDatabase(POOLER_DB, 'aws-1-ap-south-1.pooler.supabase.com')).toBe(false);
    expect(isApprovedTestDatabase(DIRECT_DB, 'db.mlpkwwhnagxzinaohdxg.supabase.co')).toBe(false);
  });

  it('TEST-AUTH-07 refuses production', () => {
    expect(testAuthProblems(withSettings({ NODE_ENV: 'production' })).join('\n')).toMatch(/NODE_ENV/);
    expect(() => resolveTestAuth(withSettings({ NODE_ENV: 'production' }))).toThrow(/NODE_ENV/);
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['too short', 'short-secret'],
    ['the once-published default', PUBLISHED],
  ])('TEST-AUTH-08 refuses a BYPASS_JWT_SECRET that is %s', (_label, secret) => {
    expect(testAuthProblems(withSettings({ BYPASS_JWT_SECRET: secret })).join('\n')).toMatch(/BYPASS_JWT_SECRET/);
  });

  it('TEST-AUTH-09 refuses a test secret equal to the project JWT secret', () => {
    const shared = 'the-project-jwt-secret-that-must-never-be-a-test-secret';
    expect(
      testAuthProblems(withSettings({ BYPASS_JWT_SECRET: shared, SUPABASE_JWT_SECRET: shared })).join('\n'),
    ).toMatch(/BYPASS_JWT_SECRET/);
  });

  it('TEST-AUTH-10 with the shared project refused, the fixed code has no route at all', async () => {
    expect(() => resolveTestAuth(withSettings({ SUPABASE_URL: HOSTED, DATABASE_URL: POOLER_DB }))).toThrow();
    const res = await request(createTestApp())
      .post('/public/v1/auth/test-login')
      .send({ email: 'rm1@alpha.com', otp: '000000' });
    expect(res.status).toBe(404);
  });
});
