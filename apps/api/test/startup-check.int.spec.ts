// Startup check (owner: Dev 1): reports a reachable database with every migration, and an unreachable one with its reason.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/kernel-min/db';
import { checkDatabase } from '../src/startup-check';
import { startIsolationEnv, type IsolationEnv } from '../../../tests/isolation/harness';

let env: IsolationEnv;
beforeAll(async () => {
  env = await startIsolationEnv();
}, 240_000);
afterAll(async () => {
  await env?.stop();
});

describe('startup check', () => {
  it('TEST-START-01 a migrated database is connected and misses nothing', async () => {
    const status = await checkDatabase(env.db, 'postgresql://dsa_api@localhost:5432/test');
    expect(status).toMatchObject({ connected: true, host: 'localhost', missingMigrations: [] });
  });

  it('TEST-START-02 an unreachable database is reported, not thrown', async () => {
    const url = 'postgresql://nobody:nothing@127.0.0.1:1/none';
    const db = createDb(url, { poolMax: 1 });
    const status = await checkDatabase(db, url);
    await db.destroy();
    expect(status.connected).toBe(false);
  });
});
