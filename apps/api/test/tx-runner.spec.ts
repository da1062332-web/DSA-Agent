import { AppError, type Database, type RequestContext } from '@dsa/contracts';
import type { Kysely } from 'kysely';
import { describe, expect, it, vi } from 'vitest';
import { createTxRunner } from '../src/kernel-min/tx-runner';
import { testPrincipal } from './support/fake-auth';

describe('TxRunner (unit)', () => {
  it('fails closed with TENANT_CONTEXT_MISSING before touching the database', async () => {
    const transaction = vi.fn();
    const runner = createTxRunner({ transaction } as unknown as Kysely<Database>);
    const ctx: RequestContext = {
      principal: testPrincipal({ tenantId: '' }),
      correlationId: 'test-correlation',
      now: new Date(),
    };

    const err = await runner.withTenantTx(ctx, async () => 'unreachable').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('TENANT_CONTEXT_MISSING');
    expect((err as AppError).httpStatus).toBe(500);
    expect(transaction).not.toHaveBeenCalled();
  });
});
