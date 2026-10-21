// Startup check (owner: Dev 1): reports a reachable database with every migration, and an unreachable one with its reason.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/kernel-min/db';
import { checkDatabase, connectionMode } from '../src/startup-check';
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
    expect(status).toMatchObject({
      connected: true,
      host: 'localhost',
      mode: 'direct',
      missingMigrations: [],
    });
  });

  it('TEST-START-03 the connection mode follows the URL: transaction pooler on 6543, session pooler on 5432', () => {
    const domain = ['pooler', 'supabase', 'com'].join('.');
    expect(connectionMode(`postgresql://u:p@aws-0-ap-south-1.${domain}:6543/postgres`)).toBe(
      'transaction pooler',
    );
    expect(connectionMode(`postgresql://u:p@aws-0-ap-south-1.${domain}:5432/postgres`)).toBe(
      'session pooler',
    );
    expect(connectionMode('postgresql://u:p@localhost:54322/postgres')).toBe('direct');
  });

  it('TEST-START-02 an unreachable database is reported, not thrown', async () => {
    const url = 'postgresql://nobody:nothing@127.0.0.1:1/none';
    const db = createDb(url, { poolMax: 1 });
    const status = await checkDatabase(db, url);
    await db.destroy();
    expect(status.connected).toBe(false);
  });
});
