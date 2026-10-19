// apps/api/test/cross-module-interactions.spec.ts
// Cross-module interaction and regression suite for Modules 10 (Activity), 11 (Messaging), and 12 (Notifications).
import { describe, expect, it, beforeEach } from 'vitest';
import express, { type Response } from 'express';
import request from 'supertest';
import { fakeAuth, testPrincipal, createTestDeps } from './support/fake-auth';
import { errorHandler } from '../src/http/error-handler';
import { ActivityService } from '../src/modules/crm/activities/activity-service';
import { createRouter as createActivitiesRouter } from '../src/modules/crm/activities/router';
import { MessagingService } from '../src/modules/crm/messaging/messaging-service';
import { createRouter as createMessagingRouter } from '../src/modules/crm/messaging/router';
import { NotificationService } from '../src/modules/crm/notifications/notification-service';
import { createRouter as createNotificationsRouter } from '../src/modules/crm/notifications/router';
import { NotificationStreamHub } from '../src/modules/crm/notifications/stream-hub';
import { SendEligibilityGuard } from '../src/modules/crm/messaging/send-guard';
import { ConfiguredTestAdapter } from '../src/modules/crm/messaging/channel-adapter';
import type { TxRunner, RequestContext } from '@dsa/contracts';

describe('Cross-Module Interactions & Regression Suite (MOD-ACT, MOD-MSG, MOD-NTF)', () => {
  const tenantA = 'ten_01JTESTTENANT00000000000000';
  const tenantB = 'ten_01JTESTTENANT00000000000002';
  const userA = 'usr_01JTESTUSER0000000000000001';
  const userB = 'usr_01JTESTUSER0000000000000002';
  const leadA = 'lead_01J00000000000000000000001';
  const branchMumbai = 'br_01JMUMBAI000000000000000000';

  let messagingService: MessagingService;
  let notificationService: NotificationService;
  let streamHub: NotificationStreamHub;
  let emailAdapter: ConfiguredTestAdapter;

  const dummyTxRunner: TxRunner = {
    async withTenantTx() {
      throw new Error('No TxRunner in memory unit tests');
    },
  };

  beforeEach(() => {
    ActivityService.resetMemoryStore();
    ActivityService.seedSubject({
      id: leadA,
      tenantId: tenantA,
      branchId: branchMumbai,
      ownerUserId: userA,
    });

    NotificationService.resetMemoryStore();
    streamHub = NotificationStreamHub.getInstance();
    streamHub.reset();
    notificationService = new NotificationService(undefined, streamHub);

    const guard = new SendEligibilityGuard({ bypassQuietHoursForTest: true });
    messagingService = new MessagingService(undefined, guard);
    emailAdapter = new ConfiguredTestAdapter('EMAIL');
    messagingService.setAdapter('EMAIL', emailAdapter);
  });

  function makeApp(principal = testPrincipal(), msgService = messagingService) {
    const app = express();
    app.use(express.json());
    app.use(fakeAuth(principal));

    const deps = createTestDeps({ txRunner: dummyTxRunner });
    const v1 = express.Router();
    v1.use(createActivitiesRouter(deps));
    v1.use(createMessagingRouter(deps, msgService));
    v1.use(createNotificationsRouter(deps, notificationService, streamHub));
    app.use('/v1', v1);
    app.use(errorHandler());
    return app;
  }

  it('CMI-001: route registration coexists without conflicts for /v1/activities, /v1/messages, /v1/notifications, and /v1/me', async () => {
    const principal = testPrincipal({
      id: userA,
      tenantId: tenantA,
      grants: [
        { code: 'activity.create', scope: 'TENANT', branchIds: [] },
        { code: 'lead.read', scope: 'TENANT', branchIds: [] },
        { code: 'message.send', scope: 'TENANT', branchIds: [] },
        { code: 'config.manage', scope: 'TENANT', branchIds: [] },
      ],
    });
    const app = makeApp(principal);

    // 1. GET /v1/activities
    const resAct = await request(app).get(`/v1/activities?subjectType=LEAD&subjectId=${leadA}`);
    expect(resAct.status).toBe(200);

    // 2. GET /v1/messages
    const resMsg = await request(app).get(`/v1/messages?subjectType=LEAD&subjectId=${leadA}`);
    expect(resMsg.status).toBe(200);

    // 3. GET /v1/notifications
    const resNtf = await request(app).get('/v1/notifications');
    expect(resNtf.status).toBe(200);

    // 4. GET /v1/me is not answered by these modules: the profile is the platform module's (API-USR-010)
    const resMe = await request(app).get('/v1/me');
    expect(resMe.status).toBe(404);
  });

  it('CMI-002: cross-tenant isolation holds across all three modules', async () => {
    const principalA = testPrincipal({
      id: userA,
      tenantId: tenantA,
      grants: [
        { code: 'activity.create', scope: 'TENANT', branchIds: [] },
        { code: 'activity.update', scope: 'TENANT', branchIds: [] },
        { code: 'message.send', scope: 'TENANT', branchIds: [] },
      ],
    });

    const principalB = testPrincipal({
      id: userB,
      tenantId: tenantB,
      grants: [
        { code: 'activity.create', scope: 'TENANT', branchIds: [] },
        { code: 'activity.update', scope: 'TENANT', branchIds: [] },
        { code: 'message.send', scope: 'TENANT', branchIds: [] },
      ],
    });

    const appTenantA = makeApp(principalA);
    const appTenantB = makeApp(principalB);

    // Create activity in Tenant A
    const actRes = await request(appTenantA)
      .post('/v1/activities')
      .set('Idempotency-Key', 'idem_cmi_act_1')
      .send({
        kind: 'CALL',
        subjectType: 'LEAD',
        subjectId: leadA,
        outcomeCode: 'CONNECTED',
        occurredAt: new Date().toISOString(),
      });
    expect(actRes.status).toBe(201);
    const actId = actRes.body.id;

    // Tenant B cannot patch Tenant A's activity (returns 404 to avoid leaking existence)
    const patchRes = await request(appTenantB)
      .patch(`/v1/activities/${actId}`)
      .set('If-Match', '"0"')
      .send({ note: 'Malicious cross-tenant edit' });
    expect(patchRes.status).toBe(404);

    // Create notification in Tenant A for User A via service
    const ctxA: RequestContext = {
      principal: principalA,
      correlationId: 'corr_cmi_ntf_1',
      now: new Date(),
    };
    const createdNtf = await notificationService.createNotification(ctxA, {
      userId: userA,
      category: 'TASK',
      title: 'Tenant A Alert',
      deepLink: '/tasks/task_01',
    });
    expect(createdNtf).toBeDefined();

    // Tenant B cannot mark Tenant A notification as read
    const readRes = await request(appTenantB)
      .post('/v1/notifications/read')
      .send({ notificationIds: [createdNtf!.id] });
    expect(readRes.status).toBe(200);
    expect(readRes.body.newlyMarkedRead).toBe(0); // isolated, cannot affect other tenant
  });

  it('CMI-003: client cannot forge server-side actor identity across modules', async () => {
    const app = makeApp(
      testPrincipal({
        id: userA,
        tenantId: tenantA,
        grants: [
          { code: 'activity.create', scope: 'TENANT', branchIds: [] },
          { code: 'message.send', scope: 'TENANT', branchIds: [] },
        ],
      }),
    );

    // Attempt to spoof actor in activity creation
    const actRes = await request(app)
      .post('/v1/activities')
      .set('Idempotency-Key', 'idem_cmi_spoof_act')
      .send({
        kind: 'NOTE',
        subjectType: 'LEAD',
        subjectId: leadA,
        occurredAt: new Date().toISOString(),
        note: 'Valid note content',
        actorId: 'usr_MALICIOUS_SPOOFED_ID',
        createdBy: 'SYSTEM_SUPERADMIN',
      });
    expect(actRes.status).toBe(201);
    expect(actRes.body.actorId).toBe(userA); // server attribution strictly forced to principal.id
    expect(actRes.body.actorId).not.toBe('usr_MALICIOUS_SPOOFED_ID');
  });

  it('CMI-004: unconfigured provider fails closed with 422 PROVIDER_NOT_CONFIGURED', async () => {
    // Unconfigure the adapter
    emailAdapter.setConfigured(false);

    const app = makeApp(
      testPrincipal({
        id: userA,
        tenantId: tenantA,
        grants: [
          { code: 'config.manage', scope: 'TENANT', branchIds: [] },
          { code: 'message.send', scope: 'TENANT', branchIds: [] },
        ],
      }),
    );

    // Register a valid template first
    const templateRes = await request(app)
      .post('/v1/message-templates')
      .set('Idempotency-Key', 'idem_tmpl_cmi_1')
      .send({
        code: 'tmpl_cmi_loan',
        channel: 'EMAIL',
        category: 'TRANSACTIONAL',
        body: 'Hello {{name}}',
        variables: [{ name: 'name', required: true }],
        status: 'APPROVED',
      });
    expect(templateRes.status).toBe(201);

    // Attempt dispatch with unconfigured provider -> must fail closed with 422
    const sendRes = await request(app)
      .post('/v1/messages')
      .set('Idempotency-Key', 'idem_msg_cmi_fail')
      .send({
        subjectType: 'LEAD',
        subjectId: leadA,
        channel: 'EMAIL',
        templateCode: 'tmpl_cmi_loan',
        recipient: { email: 'borrower@example.com' },
        variables: { name: 'Amit' },
      });

    expect(sendRes.status).toBe(422);
    expect(sendRes.body.error.code).toBe('SEND_BLOCKED');
    expect(sendRes.body.error.details[0].issue).toBe('PROVIDER_NOT_CONFIGURED');
    expect(emailAdapter.getSentMessages().length).toBe(0);
  });

  it('CMI-005: idempotency keys isolate operations and prevent duplicate state mutations', async () => {
    const app = makeApp(
      testPrincipal({
        id: userA,
        tenantId: tenantA,
        grants: [
          { code: 'activity.create', scope: 'TENANT', branchIds: [] },
          { code: 'config.manage', scope: 'TENANT', branchIds: [] },
        ],
      }),
    );

    const key = `idem_cmi_replay_${Date.now()}`;
    const payload = {
      kind: 'CALL',
      subjectType: 'LEAD',
      subjectId: leadA,
      outcomeCode: 'CONNECTED',
      occurredAt: new Date().toISOString(),
      durationSeconds: 120,
    };

    // First call: 201 Created
    const res1 = await request(app).post('/v1/activities').set('Idempotency-Key', key).send(payload);
    expect(res1.status).toBe(201);
    const firstId = res1.body.id;

    // Second call with same key: replay cached response with identical ID
    const res2 = await request(app).post('/v1/activities').set('Idempotency-Key', key).send(payload);
    expect(res2.status).toBe(200);
    expect(res2.body.id).toBe(firstId);
    expect(res2.headers['idempotent-replayed']).toBe('true');
  });

  it('CMI-006: SSE notification delivery occurs only after successful creation and isolates recipient', async () => {
    const principalA = testPrincipal({ id: userA, tenantId: tenantA });

    const receivedEventsA: Array<{ title?: string }> = [];
    const receivedEventsB: Array<{ title?: string }> = [];

    // Simulate SSE clients
    const mockResA = {
      write: (payload: string) => {
        const match = payload.match(/data: (\{.*\})/);
        if (match && match[1]) {
          receivedEventsA.push(JSON.parse(match[1]));
        }
      },
    };
    const mockResB = {
      write: (payload: string) => {
        const match = payload.match(/data: (\{.*\})/);
        if (match && match[1]) {
          receivedEventsB.push(JSON.parse(match[1]));
        }
      },
    };

    streamHub.registerClient(tenantA, userA, mockResA as unknown as Response);
    streamHub.registerClient(tenantA, userB, mockResB as unknown as Response);

    // Create notification specifically targeting User A
    const ctxA: RequestContext = {
      principal: principalA,
      correlationId: 'corr_cmi_sse_target',
      now: new Date(),
    };
    await notificationService.createNotification(ctxA, {
      userId: userA,
      category: 'LEAD',
      title: 'Targeted Lead Update',
      deepLink: '/leads/lead_01',
    });

    // Verify User A received event and User B received 0 events
    expect(receivedEventsA.length).toBe(1);
    expect(receivedEventsA[0]?.title).toBe('Targeted Lead Update');
    expect(receivedEventsB.length).toBe(0);
  });
});
