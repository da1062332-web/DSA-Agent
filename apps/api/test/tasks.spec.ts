// apps/api/test/tasks.spec.ts — owner: Dev 6 (MOD-08 Tasks Test Suite)
import type { RequestContext, Tx, TxRunner } from '@dsa/contracts';
import { FakeDecisionPort, FakeUserDirectoryPort } from '@dsa/contracts/fakes';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryTaskRepository } from '../src/modules/crm/tasks/repository';
import { createTestApp, fakeAuth, testPrincipal } from './support/fake-auth';

const inMemoryTxRunner: TxRunner = {
  async withTenantTx<T>(_ctx: RequestContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return fn({} as Tx);
  },
};

describe('Module 9 — Tasks and SLA (MOD-TASK)', () => {
  let repository: InMemoryTaskRepository;
  let decisionPort: FakeDecisionPort;
  let userDirectoryPort: FakeUserDirectoryPort;

  const tenantA = 'ten_01JTESTTENANTA0000000000000';
  const tenantB = 'ten_01JTESTTENANTB0000000000000';
  const branchA = 'br_01JTESTBRANCH00000000000001';

  const principalA = testPrincipal({
    tenantId: tenantA,
    primaryBranchId: branchA,
    queueIds: ['queue_ops_01'],
    grants: [
      { code: 'task.create', scope: 'TENANT', branchIds: [] },
      { code: 'task.read', scope: 'TENANT', branchIds: [] },
      { code: 'task.update', scope: 'TENANT', branchIds: [] },
    ],
  });

  const principalB = testPrincipal({
    tenantId: tenantB,
    grants: [
      { code: 'task.read', scope: 'TENANT', branchIds: [] },
      { code: 'task.create', scope: 'TENANT', branchIds: [] },
    ],
  });

  const branchUser = testPrincipal({
    tenantId: tenantA,
    id: 'usr_branch_user',
    primaryBranchId: branchA,
    queueIds: ['queue_ops_01'],
    grants: [
      { code: 'task.read', scope: 'BRANCH', branchIds: [branchA] },
      { code: 'task.create', scope: 'BRANCH', branchIds: [branchA] },
      { code: 'task.update', scope: 'BRANCH', branchIds: [branchA] },
    ],
  });

  beforeEach(() => {
    repository = new InMemoryTaskRepository();
    decisionPort = new FakeDecisionPort();
    userDirectoryPort = new FakeUserDirectoryPort();

    userDirectoryPort.users.set('usr_active', {
      userId: 'usr_active',
      status: 'ACTIVE',
      availability: 'AVAILABLE',
      primaryBranchId: branchA,
      branchIds: [branchA],
    });
    userDirectoryPort.users.set('usr_inactive', {
      userId: 'usr_inactive',
      status: 'DEACTIVATED',
      availability: 'OFF_DUTY',
      primaryBranchId: branchA,
      branchIds: [branchA],
    });
    userDirectoryPort.queues.set('queue_ops_01', {
      queueId: 'queue_ops_01',
      kind: 'INTAKE',
      branchId: branchA,
      active: true,
      recordTypes: ['LEAD', 'TASK'],
    });
  });

  function getApp(principal = principalA) {
    return createTestApp({
      auth: fakeAuth(principal),
      deps: {
        txRunner: inMemoryTxRunner,
        taskRepository: repository,
        decisionPort,
        userDirectoryPort,
      },
    });
  }

  const validTaskPayload = {
    type: 'FOLLOW_UP',
    title: 'Customer First Contact Follow-up',
    ownerUserId: 'usr_active',
    linkedType: 'LEAD',
    linkedId: 'lead_01JTESTLEAD00000000000000',
    branchId: branchA,
    priority: 'HIGH',
    slaClass: 'CUSTOMER_FIRST_CONTACT',
    tags: ['first-call', 'urgent'],
  };

  describe('API-TASK-001: Task Creation', () => {
    it('creates a task with valid SLA due time calculation and returns 201 with ETag', async () => {
      const app = getApp();
      const res = await request(app)
        .post('/v1/tasks')
        .set('Idempotency-Key', 'idem_task_001')
        .send(validTaskPayload);

      expect(res.status).toBe(201);
      expect(res.body.id).toMatch(/^task_/);
      expect(res.body.title).toBe(validTaskPayload.title);
      expect(res.body.status).toBe('OPEN');
      expect(res.body.slaClass).toBe('CUSTOMER_FIRST_CONTACT');
      expect(res.body.dueAt).toBeDefined();
      expect(res.headers.etag).toMatch(/^W\/"task_[^:]+:0"/);

      // Verify outbox & audit events persisted
      expect(repository.outboxEvents.length).toBe(1);
      expect(repository.outboxEvents[0]?.event_type).toBe('task.created');
      expect(repository.auditEvents.length).toBe(1);
      expect(repository.auditEvents[0]?.action).toBe('task.created');
    });

    it('creates a task assigned to an active queue', async () => {
      const app = getApp();
      const res = await request(app)
        .post('/v1/tasks')
        .set('Idempotency-Key', 'idem_task_queue_001')
        .send({
          ...validTaskPayload,
          ownerUserId: undefined,
          ownerQueueId: 'queue_ops_01',
        });

      expect(res.status).toBe(201);
      expect(res.body.ownerQueueId).toBe('queue_ops_01');
      expect(res.body.ownerUserId).toBeNull();
    });

    it('rejects task creation with both ownerUserId and ownerQueueId', async () => {
      const app = getApp();
      const res = await request(app)
        .post('/v1/tasks')
        .set('Idempotency-Key', 'idem_task_invalid_owner')
        .send({
          ...validTaskPayload,
          ownerUserId: 'usr_active',
          ownerQueueId: 'queue_ops_01',
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects task creation with inactive user', async () => {
      const app = getApp();
      const res = await request(app)
        .post('/v1/tasks')
        .set('Idempotency-Key', 'idem_task_inactive_user')
        .send({
          ...validTaskPayload,
          ownerUserId: 'usr_inactive',
        });

      expect(res.status).toBe(422);
      expect(res.body.error.message).toMatch(/not active/);
    });

    it('replays identical creation idempotently without duplicate side effects', async () => {
      const app = getApp();
      const first = await request(app)
        .post('/v1/tasks')
        .set('Idempotency-Key', 'idem_task_replay')
        .send(validTaskPayload);
      expect(first.status).toBe(201);

      const second = await request(app)
        .post('/v1/tasks')
        .set('Idempotency-Key', 'idem_task_replay')
        .send(validTaskPayload);

      expect(second.status).toBe(200);
      expect(second.headers['idempotent-replayed']).toBe('true');
      expect(second.body.id).toBe(first.body.id);
      expect(repository.outboxEvents.length).toBe(1);
    });
  });

  describe('API-TASK-002: Task Listing & Scope Filtering', () => {
    it('lists tasks with Mine, Queues and All views using cursor pagination', async () => {
      const app = getApp(branchUser);

      // Create 3 tasks
      for (let i = 1; i <= 3; i++) {
        await request(app)
          .post('/v1/tasks')
          .set('Idempotency-Key', `idem_list_tsk_${i}`)
          .send({
            ...validTaskPayload,
            title: `Task #${i}`,
            ownerUserId: branchUser.id,
          });
      }

      // 1. Mine view
      const mineRes = await request(app).get('/v1/tasks?view=MINE');
      expect(mineRes.status).toBe(200);
      expect(mineRes.body.data.length).toBe(3);
      expect(mineRes.body.data.every((t: { ownerUserId: string | null }) => t.ownerUserId === branchUser.id)).toBe(true);

      // 2. Pagination test
      const page1 = await request(app).get('/v1/tasks?view=MINE&limit=2');
      expect(page1.status).toBe(200);
      expect(page1.body.data.length).toBe(2);
      expect(page1.body.pagination.hasMore).toBe(true);
      expect(page1.body.pagination.nextCursor).toBeDefined();

      const page2 = await request(app).get(`/v1/tasks?view=MINE&limit=2&cursor=${page1.body.pagination.nextCursor}`);
      expect(page2.status).toBe(200);
      expect(page2.body.data.length).toBe(1);
      expect(page2.body.pagination.hasMore).toBe(false);
    });

    it('rejects malformed pagination cursor with 422 VALIDATION_ERROR', async () => {
      const app = getApp();
      const res = await request(app).get('/v1/tasks?cursor=BAD_BASE64_CURSOR_!!!');

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('API-TASK-003: Task Updates & Optimistic Concurrency', () => {
    it('updates priority and owner with valid If-Match ETag', async () => {
      const app = getApp();
      const createRes = await request(app)
        .post('/v1/tasks')
        .set('Idempotency-Key', 'idem_upd_01')
        .send(validTaskPayload);
      const taskId = createRes.body.id;
      const etag = createRes.headers.etag!;

      const updateRes = await request(app)
        .patch(`/v1/tasks/${taskId}`)
        .set('If-Match', etag)
        .send({
          priority: 'LOW',
          status: 'IN_PROGRESS',
        });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.priority).toBe('LOW');
      expect(updateRes.body.status).toBe('IN_PROGRESS');
      expect(updateRes.body.lockVersion).toBe(1);
      expect(updateRes.headers.etag).toBe(`W/"${taskId}:1"`);
    });

    it('rejects stale updates with 409 VERSION_CONFLICT', async () => {
      const app = getApp();
      const createRes = await request(app)
        .post('/v1/tasks')
        .set('Idempotency-Key', 'idem_upd_stale')
        .send(validTaskPayload);
      const taskId = createRes.body.id;

      const conflictRes = await request(app)
        .patch(`/v1/tasks/${taskId}`)
        .set('If-Match', `W/"${taskId}:999"`)
        .send({ priority: 'LOW' });

      expect(conflictRes.status).toBe(409);
      expect(conflictRes.body.error.code).toBe('VERSION_CONFLICT');
    });
  });

  describe('API-TASK-004: Task Completion & Next Action', () => {
    it('completes task and creates optional follow-up task atomically', async () => {
      const app = getApp();
      const createRes = await request(app)
        .post('/v1/tasks')
        .set('Idempotency-Key', 'idem_comp_01')
        .send(validTaskPayload);
      const taskId = createRes.body.id;
      const etag = createRes.headers.etag!;

      const completeRes = await request(app)
        .post(`/v1/tasks/${taskId}/completion`)
        .set('If-Match', etag)
        .set('Idempotency-Key', 'idem_comp_act')
        .send({
          outcomeCode: 'CONNECTED',
          completionNote: 'Customer verified documents, scheduled follow-up meeting.',
          nextAction: {
            createFollowUp: true,
            followUpType: 'MEETING',
            followUpDueAt: new Date(Date.now() + 86400000).toISOString(),
            followUpTitle: 'Follow-up document meeting',
          },
        });

      expect(completeRes.status).toBe(200);
      expect(completeRes.body.task.status).toBe('COMPLETED');
      expect(completeRes.body.task.outcomeCode).toBe('CONNECTED');
      expect(completeRes.body.task.completionNote).toMatch(/Customer verified/);
      expect(completeRes.body.task.followUpTaskId).toMatch(/^task_/);
      expect(completeRes.body.followUpTask).toBeDefined();
      expect(completeRes.body.followUpTask.type).toBe('MEETING');

      // Verify task.completed domain event was emitted
      const compEvent = repository.outboxEvents.find((e) => e.event_type === 'task.completed');
      expect(compEvent).toBeDefined();
      const payload = compEvent?.payload as Record<string, unknown> | undefined;
      expect(payload?.taskId).toBe(taskId);
      expect(payload?.outcomeCode).toBe('CONNECTED');
    });

    it('requires outcome code for FOLLOW_UP and CALL types', async () => {
      const app = getApp();
      const createRes = await request(app)
        .post('/v1/tasks')
        .set('Idempotency-Key', 'idem_comp_no_outcome')
        .send(validTaskPayload);
      const taskId = createRes.body.id;
      const etag = createRes.headers.etag!;

      const failRes = await request(app)
        .post(`/v1/tasks/${taskId}/completion`)
        .set('If-Match', etag)
        .send({
          completionNote: 'Completed without outcome',
        });

      expect(failRes.status).toBe(422);
      expect(failRes.body.error.code).toBe('VALIDATION_ERROR');
      expect(failRes.body.error.message).toMatch(/Outcome code is required/);
    });
  });

  describe('Tenant Isolation & Deferred APIs', () => {
    it('enforces tenant isolation and returns 404 for cross-tenant task', async () => {
      const appA = getApp(principalA);
      const appB = getApp(principalB);

      const createRes = await request(appA)
        .post('/v1/tasks')
        .set('Idempotency-Key', 'idem_cross_tenant_tsk')
        .send(validTaskPayload);
      const taskId = createRes.body.id;

      // Tenant B queries Tenant A's task -> 404 NOT_FOUND
      const crossRes = await request(appB).get(`/v1/tasks/${taskId}`);
      expect(crossRes.status).toBe(404);
      expect(crossRes.body.error.code).toBe('NOT_FOUND');
    });

    it('returns 409 INVALID_STATE for deferred snooze and bulk-reassignment endpoints', async () => {
      const app = getApp();
      const snoozeRes = await request(app).post('/v1/tasks/tsk_dummy/snooze');
      expect(snoozeRes.status).toBe(409);
      expect(snoozeRes.body.error.code).toBe('INVALID_STATE');
      expect(snoozeRes.body.error.message).toMatch(/TASK-405/);

      const bulkRes = await request(app).post('/v1/tasks/bulk-reassignment');
      expect(bulkRes.status).toBe(409);
      expect(bulkRes.body.error.code).toBe('INVALID_STATE');
      expect(bulkRes.body.error.message).toMatch(/TASK-411/);
    });
  });
});
