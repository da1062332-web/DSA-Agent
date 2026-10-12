// Integration: needs Docker (Testcontainers postgres:16). Run with `npm run test:int -w @dsa/api`.
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Database } from '@dsa/contracts';
import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/kernel-min/db';
import { createTxRunner } from '../src/kernel-min/tx-runner';
import { testPrincipal } from './support/fake-auth';

let container: StartedPostgreSqlContainer;
let db: Kysely<Database>;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16').start();
  // One connection, so the "after commit" read runs on the same session as the transaction.
  db = createDb(container.getConnectionUri(), { poolMax: 1 });
});

afterAll(async () => {
  await db?.destroy();
  await container?.stop();
});

const currentTenant = async (q: Kysely<Database>) =>
  (await sql<{ t: string | null }>`select current_setting('app.tenant_id', true) as t`.execute(q)).rows[0]?.t;

describe('TxRunner (integration)', () => {
  it('TEST-KRN-004 sets app.tenant_id locally; the value is gone after commit', async () => {
    const runner = createTxRunner(db);
    const tenantId = 'ten_01JTESTTENANT00000000000000';
    const ctx = { principal: testPrincipal({ tenantId }), correlationId: 'c-1234567', now: new Date() };

    const inside = await runner.withTenantTx(ctx, (tx) => currentTenant(tx));
    expect(inside).toBe(tenantId);

    const after = await currentTenant(db);
    expect(after ?? '').toBe('');
  });

  it('rolls back when the callback throws', async () => {
    const runner = createTxRunner(db);
    const ctx = { principal: testPrincipal(), correlationId: 'c-1234567', now: new Date() };
    await sql`create table if not exists tx_probe (id int)`.execute(db);

    await expect(
      runner.withTenantTx(ctx, async (tx) => {
        await sql`insert into tx_probe values (1)`.execute(tx);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const { rows } = await sql<{ n: string }>`select count(*)::text as n from tx_probe`.execute(db);
    expect(rows[0]?.n).toBe('0');
  });
});
