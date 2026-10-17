// apps/api/test/notifications.spec.ts
// Unit and route test suite for Module 12 (Notifications / MOD-NTF).
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import type { NotificationRecord, RequestContext, TxRunner } from '@dsa/contracts';
import { errorHandler } from '../src/http/error-handler';
import { NotificationService } from '../src/modules/crm/notifications/notification-service';
import { PreferenceResolver } from '../src/modules/crm/notifications/preference-resolver';
import { createRouter } from '../src/modules/crm/notifications/router';
import { NotificationStreamHub } from '../src/modules/crm/notifications/stream-hub';
import { fakeAuth, testPrincipal, createTestDeps } from './support/fake-auth';

describe('Module 12: Notifications (MOD-NTF) Unit & Route Tests', () => {
  const tenantA = 'ten_01JTESTTENANT00000000000000';
  const tenantB = 'ten_01JTESTTENANT00000000000002';
  const userA = 'usr_01JTESTUSER0000000000000001';
  const userB = 'usr_01JTESTUSER0000000000000002';

  let notificationService: NotificationService;
  let streamHub: NotificationStreamHub;

  const dummyTxRunner: TxRunner = {
    async withTenantTx() {
      throw new Error('No TxRunner in unit tests');
    },
  };

  beforeEach(() => {
    NotificationService.resetMemoryStore();
    streamHub = NotificationStreamHub.getInstance();
    streamHub.reset();
    notificationService = new NotificationService(undefined, streamHub);
  });

  function makeApp(principal = testPrincipal(), service = notificationService) {
    const app = express();
    app.use(express.json());
    app.use(fakeAuth(principal));
    const router = createRouter(createTestDeps({ txRunner: dummyTxRunner }), service, streamHub);
    app.use('/v1', router);
    app.use(errorHandler());
    return app;
  }

  describe('SUB-NTF.01: In-App Notifications (API-NTF-001 & API-NTF-002)', () => {
    it('returns empty list when user has no notifications', async () => {
      const app = makeApp(testPrincipal({ id: userA, tenantId: tenantA }));
      const res = await request(app).get('/v1/notifications');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.meta.unreadCount).toBe(0);
      expect(res.body.meta.nextCursor).toBeNull();
    });

    it('returns notifications in newest-first order with cursor pagination', async () => {
      // Seed 3 notifications for userA
      const n1: NotificationRecord = {
        id: 'ntf_01J00000000000000000000001',
        tenantId: tenantA,
        userId: userA,
        category: 'TASK',
        title: 'Task 1 assigned',
        deepLink: '/tasks/tsk_1',
        readAt: null,
        lockVersion: 0,
        createdAt: '2026-10-01T10:00:00Z',
      };
      const n2: NotificationRecord = {
        id: 'ntf_01J00000000000000000000002',
        tenantId: tenantA,
        userId: userA,
        category: 'LEAD',
        title: 'Lead 2 updated',
        deepLink: '/leads/led_2',
        readAt: null,
        lockVersion: 0,
        createdAt: '2026-10-01T11:00:00Z',
      };
      const n3: NotificationRecord = {
        id: 'ntf_01J00000000000000000000003',
        tenantId: tenantA,
        userId: userA,
        category: 'APPLICATION',
        title: 'Application 3 approved',
        deepLink: '/applications/app_3',
        readAt: null,
        lockVersion: 0,
        createdAt: '2026-10-01T12:00:00Z',
      };

      NotificationService.seedNotification(n1);
      NotificationService.seedNotification(n2);
      NotificationService.seedNotification(n3);

      const app = makeApp(testPrincipal({ id: userA, tenantId: tenantA }));

      // Fetch page 1 with limit=2
      const page1 = await request(app).get('/v1/notifications?limit=2');
      expect(page1.status).toBe(200);
      expect(page1.body.data).toHaveLength(2);
      expect(page1.body.data[0].id).toBe(n3.id);
      expect(page1.body.data[1].id).toBe(n2.id);
      expect(page1.body.meta.nextCursor).toBe(n2.id);
      expect(page1.body.meta.unreadCount).toBe(3);

      // Fetch page 2 using cursor
      const page2 = await request(app).get(`/v1/notifications?limit=2&cursor=${page1.body.meta.nextCursor}`);
      expect(page2.status).toBe(200);
      expect(page2.body.data).toHaveLength(1);
      expect(page2.body.data[0].id).toBe(n1.id);
      expect(page2.body.meta.nextCursor).toBeNull();
    });

    it('orders by created_at DESC with id DESC tie-breaker', async () => {
      const nOlder: NotificationRecord = {
        id: 'ntf_01J99999999999999999999999',
        tenantId: tenantA,
        userId: userA,
        category: 'TASK',
        title: 'Older task with higher ID',
        deepLink: '/tasks/older',
        readAt: null,
        lockVersion: 0,
        createdAt: '2026-10-01T08:00:00Z',
      };
      const nNewer: NotificationRecord = {
        id: 'ntf_01J00000000000000000000001',
        tenantId: tenantA,
        userId: userA,
        category: 'TASK',
        title: 'Newer task with lower ID',
        deepLink: '/tasks/newer',
        readAt: null,
        lockVersion: 0,
        createdAt: '2026-10-01T15:00:00Z',
      };
      const nTieA: NotificationRecord = {
        id: 'ntf_01J55555555555555555555555',
        tenantId: tenantA,
        userId: userA,
        category: 'TASK',
        title: 'Tie A',
        deepLink: '/tasks/tie-a',
        readAt: null,
        lockVersion: 0,
        createdAt: '2026-10-01T10:00:00Z',
      };
      const nTieB: NotificationRecord = {
        id: 'ntf_01J66666666666666666666666',
        tenantId: tenantA,
        userId: userA,
        category: 'TASK',
        title: 'Tie B',
        deepLink: '/tasks/tie-b',
        readAt: null,
        lockVersion: 0,
        createdAt: '2026-10-01T10:00:00Z',
      };

      NotificationService.seedNotification(nOlder);
      NotificationService.seedNotification(nNewer);
      NotificationService.seedNotification(nTieA);
      NotificationService.seedNotification(nTieB);

      const app = makeApp(testPrincipal({ id: userA, tenantId: tenantA }));
      const res = await request(app).get('/v1/notifications?limit=10');

      expect(res.status).toBe(200);
      expect(res.body.data[0].id).toBe(nNewer.id);
      expect(res.body.data[1].id).toBe(nTieB.id);
      expect(res.body.data[2].id).toBe(nTieA.id);
      expect(res.body.data[3].id).toBe(nOlder.id);
    });

    it('enforces user and tenant isolation: User A cannot see User B or Tenant B notifications', async () => {
      // Notification for User B in Tenant A
      const nUserB: NotificationRecord = {
        id: 'ntf_01J0000000000000000000000B',
        tenantId: tenantA,
        userId: userB,
        category: 'TASK',
        title: 'User B private notification',
        deepLink: '/tasks/b',
        readAt: null,
        lockVersion: 0,
        createdAt: '2026-10-01T10:00:00Z',
      };
      // Notification for User A in Tenant B
      const nTenantB: NotificationRecord = {
        id: 'ntf_01J000000000000000000000TB',
        tenantId: tenantB,
        userId: userA,
        category: 'SYSTEM',
        title: 'Tenant B notification',
        deepLink: '/system/b',
        readAt: null,
        lockVersion: 0,
        createdAt: '2026-10-01T10:00:00Z',
      };

      NotificationService.seedNotification(nUserB);
      NotificationService.seedNotification(nTenantB);

      const app = makeApp(testPrincipal({ id: userA, tenantId: tenantA }));
      const res = await request(app).get('/v1/notifications');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
      expect(res.body.meta.unreadCount).toBe(0);
    });

    it('marks notifications as read for authenticated user only', async () => {
      const n1: NotificationRecord = {
        id: 'ntf_01J00000000000000000000001',
        tenantId: tenantA,
        userId: userA,
        category: 'TASK',
        title: 'User A notification',
        deepLink: '/tasks/1',
        readAt: null,
        lockVersion: 0,
        createdAt: '2026-10-01T10:00:00Z',
      };
      const n2: NotificationRecord = {
        id: 'ntf_01J00000000000000000000002',
        tenantId: tenantA,
        userId: userB,
        category: 'TASK',
        title: 'User B notification',
        deepLink: '/tasks/2',
        readAt: null,
        lockVersion: 0,
        createdAt: '2026-10-01T10:00:00Z',
      };
      NotificationService.seedNotification(n1);
      NotificationService.seedNotification(n2);

      const app = makeApp(testPrincipal({ id: userA, tenantId: tenantA }));

      // User A attempts to mark both n1 and n2 as read
      const res = await request(app)
        .post('/v1/notifications/read')
        .send({ notificationIds: [n1.id, n2.id] });

      expect(res.status).toBe(200);
      // Only n1 should have been marked read (updatedCount = 1)
      expect(res.body.newlyMarkedRead).toBe(1);

      // Verify n1 is read
      const inboxA = await request(app).get('/v1/notifications?status=READ');
      expect(inboxA.body.data).toHaveLength(1);
      expect(inboxA.body.data[0].id).toBe(n1.id);
      expect(inboxA.body.data[0].readAt).toBeTruthy();

      // Verify repeated call is safe and returns 0 newly marked read
      const repeat = await request(app)
        .post('/v1/notifications/read')
        .send({ notificationIds: [n1.id] });
      expect(repeat.status).toBe(200);
      expect(repeat.body.newlyMarkedRead).toBe(0);
    });

    it('validates mark-as-read payload format', async () => {
      const app = makeApp(testPrincipal({ id: userA, tenantId: tenantA }));

      const res = await request(app).post('/v1/notifications/read').send({ notificationIds: 'not-an-array' });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('SUB-NTF.01: Live Stream (API-NTF-003) & Notification Creation', () => {
    it('dispatches live notifications only to the target user via stream hub', async () => {
      const receivedEventsUserA: NotificationRecord[] = [];
      const receivedEventsUserB: NotificationRecord[] = [];

      // Mock SSE response objects
      const mockResA = {
        write: (chunk: string) => {
          if (chunk.includes('event: notification.created')) {
            const lines = chunk.split('\n');
            const dataLine = lines.find((l) => l.startsWith('data: '));
            if (dataLine) {
              receivedEventsUserA.push(JSON.parse(dataLine.replace('data: ', '')));
            }
          }
        },
      } as unknown as Parameters<NotificationStreamHub['subscribe']>[2];

      const mockResB = {
        write: (chunk: string) => {
          if (chunk.includes('event: notification.created')) {
            const lines = chunk.split('\n');
            const dataLine = lines.find((l) => l.startsWith('data: '));
            if (dataLine) {
              receivedEventsUserB.push(JSON.parse(dataLine.replace('data: ', '')));
            }
          }
        },
      } as unknown as Parameters<NotificationStreamHub['subscribe']>[2];

      const unsubA = streamHub.subscribe(tenantA, userA, mockResA);
      const unsubB = streamHub.subscribe(tenantA, userB, mockResB);

      // Create notification directed to User A
      const ctxProducer: RequestContext = {
        principal: testPrincipal({ id: 'usr_producer', tenantId: tenantA }),
        correlationId: 'corr_test_1',
        now: new Date('2026-10-01T12:00:00Z'),
      };

      const created = await notificationService.createNotification(ctxProducer, {
        userId: userA,
        category: 'TASK',
        title: 'New assignment for user A',
        deepLink: '/tasks/tsk_99',
      });

      expect(created).not.toBeNull();
      expect(created?.userId).toBe(userA);

      // User A received the event
      expect(receivedEventsUserA).toHaveLength(1);
      expect(receivedEventsUserA[0]?.id).toBe(created?.id);
      expect(receivedEventsUserA[0]?.title).toBe('New assignment for user A');

      // User B received NOTHING (no cross-user event leakage)
      expect(receivedEventsUserB).toHaveLength(0);

      unsubA();
      unsubB();
    });

    it('rejects external/protocol-relative deep links', async () => {
      const ctxProducer: RequestContext = {
        principal: testPrincipal({ id: 'usr_producer', tenantId: tenantA }),
        correlationId: 'corr_test_2',
        now: new Date(),
      };

      // Protocol-relative URL //evil.com must fail validation
      await expect(
        notificationService.createNotification(ctxProducer, {
          userId: userA,
          category: 'ALERT',
          title: 'Malicious link',
          deepLink: '//evil.com/phish',
        }),
      ).rejects.toThrow();

      // Absolute URL https://evil.com must fail validation
      await expect(
        notificationService.createNotification(ctxProducer, {
          userId: userA,
          category: 'ALERT',
          title: 'Malicious link',
          deepLink: 'https://evil.com/phish',
        }),
      ).rejects.toThrow();
    });
  });

  describe('SUB-NTF.02: Notification Preferences & Profile API (API-USR-009 & API-USR-010)', () => {
    it('gets current profile with default preferences and ETag', async () => {
      const app = makeApp(testPrincipal({ id: userA, tenantId: tenantA }));

      const res = await request(app).get('/v1/me');
      expect(res.status).toBe(200);
      expect(res.headers['etag']).toBe('"0"');
      expect(res.body.id).toBe(userA);
      expect(res.body.notificationPreferences).toEqual({
        channels: {
          inApp: true,
          email: false,
          sms: false,
          whatsapp: false,
        },
        digestFrequency: 'IMMEDIATE',
        mutedCategories: [],
      });
    });

    it('requires If-Match header for PATCH /v1/me', async () => {
      const app = makeApp(testPrincipal({ id: userA, tenantId: tenantA }));

      const res = await request(app)
        .patch('/v1/me')
        .send({
          preferences: {
            channels: { inApp: false, email: true, sms: false, whatsapp: false },
            digestFrequency: 'DAILY_DIGEST',
            mutedCategories: ['TASK'],
          },
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details?.[0]?.field).toBe('If-Match');
    });

    it('rejects stale If-Match header with VERSION_CONFLICT (409)', async () => {
      const app = makeApp(testPrincipal({ id: userA, tenantId: tenantA }));

      const res = await request(app)
        .patch('/v1/me')
        .set('If-Match', '"999"') // Expected lock_version is 0, 999 is stale
        .send({
          preferences: {
            channels: { inApp: false, email: true, sms: false, whatsapp: false },
            digestFrequency: 'DAILY_DIGEST',
            mutedCategories: ['TASK'],
          },
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('VERSION_CONFLICT');
    });

    it('updates preferences successfully when If-Match matches and increments lock_version', async () => {
      const app = makeApp(testPrincipal({ id: userA, tenantId: tenantA }));

      const res = await request(app)
        .patch('/v1/me')
        .set('If-Match', '"0"')
        .send({
          preferences: {
            channels: { inApp: true, email: true, sms: false, whatsapp: false },
            digestFrequency: 'DAILY_DIGEST',
            mutedCategories: ['SYSTEM', 'ALERT'],
          },
        });

      expect(res.status).toBe(200);
      expect(res.headers['etag']).toBe('"1"');
      expect(res.body.lockVersion).toBe(1);
      expect(res.body.notificationPreferences.digestFrequency).toBe('DAILY_DIGEST');
      expect(res.body.notificationPreferences.mutedCategories).toEqual(['SYSTEM', 'ALERT']);

      // Submitting again with old ETag "0" now fails
      const staleRes = await request(app)
        .patch('/v1/me')
        .set('If-Match', '"0"')
        .send({
          preferences: {
            channels: { inApp: true, email: true, sms: false, whatsapp: false },
            digestFrequency: 'IMMEDIATE',
            mutedCategories: [],
          },
        });
      expect(staleRes.status).toBe(409);
      expect(staleRes.body.error.code).toBe('VERSION_CONFLICT');
    });

    it('preference resolver silences in-app notifications for muted categories', async () => {
      const prefs = {
        channels: { inApp: true, email: false, sms: false, whatsapp: false },
        digestFrequency: 'IMMEDIATE' as const,
        mutedCategories: ['TASK' as const],
      };

      expect(PreferenceResolver.shouldDeliverInApp('TASK', prefs)).toBe(false);
      expect(PreferenceResolver.shouldDeliverInApp('LEAD', prefs)).toBe(true);
    });

    it('preference resolver silences all in-app notifications if inApp channel is disabled', async () => {
      const prefs = {
        channels: { inApp: false, email: true, sms: false, whatsapp: false },
        digestFrequency: 'IMMEDIATE' as const,
        mutedCategories: [],
      };

      expect(PreferenceResolver.shouldDeliverInApp('TASK', prefs)).toBe(false);
      expect(PreferenceResolver.shouldDeliverInApp('LEAD', prefs)).toBe(false);
    });
  });
});
