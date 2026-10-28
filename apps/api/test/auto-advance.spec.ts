// MOD-APP: documents complete -> DOCUMENTS_PENDING moves to UNDER_REVIEW by itself (owner: Dev 3; T-APP-02, automatic).
// Runs the real helper against a fake database driver, so it needs no Docker: the driver answers the few reads the helper makes
// and records every statement, which is what these tests assert on.
import type { AuditPort, IdGenerator, RequestContext, Tx } from '@dsa/contracts';
import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type DatabaseConnection,
  type Driver,
  type QueryResult,
} from 'kysely';
import { describe, expect, it, vi } from 'vitest';
import {
  advanceForChecklistItem,
  advanceWhenDocumentsComplete,
} from '../src/modules/origination/applications/application-port';

interface Statement {
  sql: string;
  parameters: readonly unknown[];
}
type Item = { mandatory: boolean; status: string };

function fakeTx(world: { app?: Record<string, unknown> | null; items?: Item[]; itemApplicationId?: string | null }) {
  const statements: Statement[] = [];
  const connection: DatabaseConnection = {
    async executeQuery<R>(q: Statement): Promise<QueryResult<R>> {
      statements.push({ sql: q.sql, parameters: q.parameters });
      // Queries are multi-line templates; match on their text with whitespace collapsed.
      const text = q.sql.trim().replace(/\s+/g, ' ').toLowerCase();
      if (text.startsWith('select * from loan_application')) {
        return { rows: (world.app ? [world.app] : []) as R[] };
      }
      if (text.startsWith('select mandatory, status from checklist_item')) {
        return { rows: (world.items ?? []) as R[] };
      }
      if (text.startsWith('select application_id from checklist_item')) {
        const id = world.itemApplicationId;
        return { rows: (id ? [{ application_id: id }] : []) as R[] };
      }
      if (text.startsWith('update "loan_application"')) {
        return { rows: [{ ...world.app, status: 'UNDER_REVIEW' }] as R[] };
      }
      return { rows: [] };
    },
    streamQuery() {
      throw new Error('not used');
    },
  };
  const driver: Driver = {
    async init() {},
    async acquireConnection() {
      return connection;
    },
    async beginTransaction() {},
    async commitTransaction() {},
    async rollbackTransaction() {},
    async releaseConnection() {},
    async destroy() {},
  };
  const db = new Kysely<unknown>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (k) => new PostgresIntrospector(k),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
  return { tx: db as unknown as Tx, statements };
}

const ctx = {
  principal: { id: 'usr_verifier', tenantId: 'ten_1', kind: 'USER', grants: [] },
  correlationId: 'corr-1',
  now: new Date('2026-10-28T10:00:00.000Z'),
} as unknown as RequestContext;

function deps() {
  const record = vi.fn(async () => undefined);
  let n = 0;
  return {
    audit: { record } as unknown as AuditPort,
    ids: { next: (prefix: string) => `${prefix}_${++n}` } as unknown as IdGenerator,
    record,
  };
}

const app = (over: Record<string, unknown> = {}) => ({
  id: 'app_1',
  status: 'DOCUMENTS_PENDING',
  on_hold: false,
  lock_version: 3,
  ...over,
});
const done: Item[] = [
  { mandatory: true, status: 'ACCEPTED' },
  { mandatory: true, status: 'WAIVED' },
  { mandatory: true, status: 'NOT_APPLICABLE' },
];
const writes = (statements: Statement[]) => statements.filter((s) => /^(update|insert)/i.test(s.sql.trim()));

describe('advanceWhenDocumentsComplete', () => {
  it('TEST-APP-AUTO-001 moves a DOCUMENTS_PENDING file to UNDER_REVIEW once every mandatory document is accepted, waived or not applicable', async () => {
    const { tx, statements } = fakeTx({ app: app(), items: done });
    const d = deps();
    const result = await advanceWhenDocumentsComplete(tx, ctx, d, 'app_1');
    expect(result).toEqual({ advanced: true });

    const update = statements.find((s) => /^update "loan_application"/.test(s.sql));
    expect(update?.parameters).toContain('UNDER_REVIEW');
  });

  it('TEST-APP-AUTO-002 records it like a manual T-APP-02: status history, outbox event and audit event, marked automatic', async () => {
    const { tx, statements } = fakeTx({ app: app(), items: done });
    const d = deps();
    await advanceWhenDocumentsComplete(tx, ctx, d, 'app_1');

    const history = statements.find((s) => /insert into application_status_history/i.test(s.sql));
    // The application and the person whose action completed the checklist are bound values; the transition itself is fixed text.
    expect(history?.parameters).toEqual(expect.arrayContaining(['app_1', 'usr_verifier']));
    for (const literal of ["'DOCUMENTS_PENDING'", "'UNDER_REVIEW'", "'T-APP-02'", "'DOCUMENTS_COMPLETE'"]) {
      expect(history?.sql).toContain(literal);
    }

    const outbox = statements.find((s) => /insert into outbox_event/i.test(s.sql));
    expect(outbox?.sql).toContain("'application.state_changed'");
    const payload = JSON.parse(String(outbox?.parameters.find((p) => typeof p === 'string' && p.startsWith('{'))));
    expect(payload).toMatchObject({ applicationId: 'app_1', from: 'DOCUMENTS_PENDING', to: 'UNDER_REVIEW', automatic: true });

    expect(d.record).toHaveBeenCalledTimes(1);
    expect(d.record).toHaveBeenCalledWith(
      tx,
      ctx,
      expect.objectContaining({
        action: 'application.state_changed',
        entityId: 'app_1',
        before: { status: 'DOCUMENTS_PENDING' },
        after: { status: 'UNDER_REVIEW', automatic: true },
      }),
    );
  });

  it('TEST-APP-AUTO-003 does nothing while a mandatory document is still outstanding', async () => {
    for (const open of ['PENDING', 'SUBMITTED', 'REJECTED', 'EXPIRED']) {
      const { tx, statements } = fakeTx({ app: app(), items: [...done, { mandatory: true, status: open }] });
      const d = deps();
      expect(await advanceWhenDocumentsComplete(tx, ctx, d, 'app_1')).toEqual({ advanced: false });
      expect(writes(statements)).toHaveLength(0);
      expect(d.record).not.toHaveBeenCalled();
    }
  });

  it('TEST-APP-AUTO-004 ignores an optional document that is still open', async () => {
    const { tx } = fakeTx({ app: app(), items: [...done, { mandatory: false, status: 'PENDING' }] });
    expect(await advanceWhenDocumentsComplete(tx, ctx, deps(), 'app_1')).toEqual({ advanced: true });
  });

  it('TEST-APP-AUTO-005 does nothing for an empty checklist', async () => {
    const { tx, statements } = fakeTx({ app: app(), items: [] });
    expect(await advanceWhenDocumentsComplete(tx, ctx, deps(), 'app_1')).toEqual({ advanced: false });
    expect(writes(statements)).toHaveLength(0);
  });

  it('TEST-APP-AUTO-006 only moves a file that is DOCUMENTS_PENDING', async () => {
    for (const status of ['DRAFT', 'UNDER_REVIEW', 'READY_FOR_SUBMISSION', 'SUBMITTED', 'CANCELLED']) {
      const { tx, statements } = fakeTx({ app: app({ status }), items: done });
      expect(await advanceWhenDocumentsComplete(tx, ctx, deps(), 'app_1')).toEqual({ advanced: false });
      expect(writes(statements)).toHaveLength(0);
    }
  });

  it('TEST-APP-AUTO-007 leaves a file that is on hold where it is', async () => {
    const { tx, statements } = fakeTx({ app: app({ on_hold: true }), items: done });
    expect(await advanceWhenDocumentsComplete(tx, ctx, deps(), 'app_1')).toEqual({ advanced: false });
    expect(writes(statements)).toHaveLength(0);
  });

  it('TEST-APP-AUTO-008 does nothing for an application it cannot see, and locks the row it decides on', async () => {
    const missing = fakeTx({ app: null, items: done });
    expect(await advanceWhenDocumentsComplete(missing.tx, ctx, deps(), 'app_x')).toEqual({ advanced: false });

    const { tx, statements } = fakeTx({ app: app(), items: done });
    await advanceWhenDocumentsComplete(tx, ctx, deps(), 'app_1');
    expect(statements[0]?.sql.toLowerCase()).toMatch(/from loan_application where id = \$1 for update$/);
  });
});

describe('advanceForChecklistItem', () => {
  it('TEST-APP-AUTO-009 finds the application of a checklist item and applies the same rule', async () => {
    const { tx } = fakeTx({ app: app(), items: done, itemApplicationId: 'app_1' });
    expect(await advanceForChecklistItem(tx, ctx, deps(), 'chk_1')).toEqual({ advanced: true });
  });

  it('TEST-APP-AUTO-010 does nothing for an unknown checklist item', async () => {
    const { tx, statements } = fakeTx({ app: app(), items: done, itemApplicationId: null });
    expect(await advanceForChecklistItem(tx, ctx, deps(), 'chk_missing')).toEqual({ advanced: false });
    expect(writes(statements)).toHaveLength(0);
  });
});
