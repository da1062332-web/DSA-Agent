// apps/api/test/notifications-events.spec.ts
// Module 12 (MOD-NTF / CMP-NTF.01.1): notifications from domain events, the no-duplicate rule for retried events, and
// marking every unread notification as read on the server.
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import type { DomainEventEnvelope, RequestContext } from '@dsa/contracts';
import { errorHandler } from '../src/http/error-handler';
import { NotificationService } from '../src/modules/crm/notifications/notification-service';
import { noticesFor } from '../src/modules/crm/notifications/event-subscriber';
import { createRouter } from '../src/modules/crm/notifications/router';
import { NotificationStreamHub } from '../src/modules/crm/notifications/stream-hub';
import { fakeAuth, testPrincipal, createTestDeps } from './support/fake-auth';

const tenant = 'ten_01JTESTTENANT00000000000000';
const owner = 'usr_01JTESTUSER0000000000000001';

function event(type: string, subjectId: string, data: Record<string, unknown>, id = 'evt_01JTEST0000000000000000001') {
  return {
    id,
    type,
    version: 1,
    tenantId: tenant,
    occurredAt: '2026-10-24T06:00:00.000Z',
    correlationId: 'corr_1',
    causationId: null,
    chainDepth: 0,
    subject: { type: 'X', id: subjectId },
    data,
  } as unknown as DomainEventEnvelope;
}

describe('MOD-NTF domain-event notifications (CMP-NTF.01.1)', () => {
  beforeEach(() => {
    NotificationService.resetMemoryStore();
    NotificationStreamHub.getInstance().reset();
  });

  it('TEST-NTF-EV-001 a lead assigned to a person notifies that person, with a link to the lead', () => {
    const notices = noticesFor(event('lead.assigned', 'led_1', { ownerUserId: owner }));
    expect(notices).toEqual([
      { userId: owner, category: 'LEAD', title: 'A lead has been assigned to you', deepLink: '/leads/led_1' },
    ]);
  });

  it('TEST-NTF-EV-002 a lead routed to a queue notifies nobody (no person is named)', () => {
    expect(noticesFor(event('lead.assigned', 'led_1', { ownerUserId: null, ownerQueueId: 'q_1' }))).toEqual([]);
  });

  it('TEST-NTF-EV-003 a new task notifies its owner', () => {
    const notices = noticesFor(event('task.created', 'tsk_1', { ownerUserId: owner, title: 'Collect salary slip' }));
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ userId: owner, category: 'TASK', title: 'New task: Collect salary slip' });
  });

  it('TEST-NTF-EV-004 an application with the same sales and operations owner tells that person once', () => {
    const notices = noticesFor(
      event('application.assigned', 'app_1', { salesOwnerId: owner, opsOwnerId: owner, opsQueueId: null }),
    );
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ userId: owner, category: 'APPLICATION', deepLink: '/applications/app_1' });
  });

  it('TEST-NTF-EV-005 events without a named recipient notify nobody', () => {
    expect(noticesFor(event('lender_case.state_changed', 'lc_1', { lenderCaseId: 'lc_1' }))).toEqual([]);
    expect(noticesFor(event('lead.created', 'led_2', {}))).toEqual([]);
  });

  it('TEST-NTF-EV-006 the same source event creates one notification per user, even if delivered twice', async () => {
    const ctx = { principal: testPrincipal({ id: owner, tenantId: tenant }), now: new Date() } as unknown as RequestContext;
    const service = new NotificationService(undefined, NotificationStreamHub.getInstance());
    const input = { userId: owner, category: 'TASK' as const, title: 'New task', deepLink: '/tasks', sourceEventId: 'evt_9' };

    expect(await service.createNotification(ctx, input)).not.toBeNull();
    expect(await service.createNotification(ctx, input)).toBeNull(); // the retry creates nothing
    expect(await service.createNotification(ctx, { ...input, sourceEventId: 'evt_10' })).not.toBeNull();
  });

  it('TEST-NTF-EV-007 mark all read clears every unread notification of the signed-in user, not only a page of them', async () => {
    const principal = testPrincipal({ id: owner, tenantId: tenant });
    const service = new NotificationService(undefined, NotificationStreamHub.getInstance());
    const ctx = { principal, now: new Date() } as unknown as RequestContext;
    for (let i = 0; i < 30; i += 1) {
      await service.createNotification(ctx, {
        userId: owner,
        category: 'SYSTEM',
        title: `Item ${i}`,
        deepLink: '/notifications',
        sourceEventId: `evt_bulk_${i}`,
      });
    }
    const app = express();
    app.use(express.json());
    app.use(fakeAuth(principal));
    app.use('/v1', createRouter(createTestDeps({ txRunner: undefined as never }), service, NotificationStreamHub.getInstance()));
    app.use(errorHandler());

    const res = await request(app).post('/v1/notifications/read-all').send({});
    expect(res.status).toBe(200);
    expect(res.body.newlyMarkedRead).toBe(30);

    const again = await request(app).post('/v1/notifications/read-all').send({});
    expect(again.body.newlyMarkedRead).toBe(0);
  });
});
