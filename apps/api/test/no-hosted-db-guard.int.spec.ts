// The fail-closed guard (tests/guard/no-hosted-db.ts) is installed by both integration configs. No network is used here:
// a refused connection is rejected before any DNS lookup.
import net from 'node:net';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { remoteHostOf } from '../../../tests/guard/no-hosted-db';
import { assertThrowawayDatabase } from '../../../tests/guard/verify-local-db';

const connectTo = (host: string, port = 5432) =>
  new Promise<NodeJS.ErrnoException>((resolve) => {
    const s = net.connect({ host, port });
    s.once('error', (e) => resolve(e as NodeJS.ErrnoException));
    s.once('connect', () => {
      s.destroy();
      resolve(new Error('connected') as NodeJS.ErrnoException);
    });
  });

describe('fail-closed guard against hosted databases', () => {
  it('TEST-GUARD-01 a connection to a hosted pooler host is refused by the guard, not attempted', async () => {
    const err = await connectTo('aws-0-ap-south-1.pooler.supabase.com', 6543);
    expect(err.code).toBe('EHOSTEDGUARD');
    expect(err.message).toContain('Refused by the test guard');
  });

  it('TEST-GUARD-02 any non-local host is refused, including a bare IP address and a made-up name', async () => {
    expect((await connectTo('203.0.113.7')).code).toBe('EHOSTEDGUARD');
    expect((await connectTo('db.example.invalid')).code).toBe('EHOSTEDGUARD');
  });

  it('TEST-GUARD-03 local hosts pass through to the real network stack (a closed local port is just refused)', async () => {
    for (const host of ['localhost', '127.0.0.1']) {
      const err = await connectTo(host, 1);
      expect(err.code, host).not.toBe('EHOSTEDGUARD');
    }
  });

  it('TEST-GUARD-05 the pg driver, which every database spec uses, is stopped too (made-up host and credentials)', async () => {
    const client = new pg.Client({ host: 'db.example.invalid', port: 6543, user: 'nobody', password: 'x', database: 'postgres' });
    await expect(client.connect()).rejects.toMatchObject({ code: 'EHOSTEDGUARD' });
  });

  it('TEST-GUARD-06 the pre-run check refuses a connection string that is not on this machine, without connecting', async () => {
    const fake = { getId: () => 'x', getDatabase: () => 'db' } as never;
    const admin = { query: async () => ({}) } as never;
    await expect(assertThrowawayDatabase(fake, admin, ['postgresql://u:p@aws-0-ap-south-1.pooler.supabase.com:6543/postgres'])).rejects.toThrow(
      /not at the local machine/,
    );
  });

  it('TEST-GUARD-07 the pre-run check refuses a local database that is not the container this process started', async () => {
    const fake = { getId: () => 'some-other-container', getDatabase: () => 'db' } as never;
    const admin = { query: async () => ({}) } as never;
    await expect(assertThrowawayDatabase(fake, admin, [process.env.DATABASE_URL!])).rejects.toThrow(/not the throwaway container/);
  });

  it('TEST-GUARD-08 the database every spec receives is the marked container', async () => {
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    const { rows } = await client.query(`SELECT current_setting('dsa.test_container', true) AS marker, inet_server_addr()::text AS addr`);
    await client.end();
    expect(rows[0].marker).toMatch(/^[0-9a-f]{12,}$/);
  });

  it('TEST-GUARD-04 the argument forms node and pg use are all recognised', () => {
    expect(remoteHostOf([{ host: 'x.supabase.com', port: 5432 }])).toBe('x.supabase.com');
    expect(remoteHostOf([[{ host: 'x.supabase.com', port: 5432 }, null]])).toBe('x.supabase.com');
    expect(remoteHostOf([5432, 'x.supabase.com'])).toBe('x.supabase.com');
    expect(remoteHostOf([{ host: 'localhost', port: 5432 }])).toBeUndefined();
    expect(remoteHostOf([5432, '127.0.0.1'])).toBeUndefined();
    expect(remoteHostOf([{ port: 5432 }])).toBeUndefined();
    expect(remoteHostOf([{ path: '\\\\.\\pipe\\docker_engine' }])).toBeUndefined();
    expect(remoteHostOf(['/var/run/docker.sock'])).toBeUndefined();
  });
});
