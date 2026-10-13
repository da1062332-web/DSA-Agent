import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import type { MessageTemplate, TxRunner } from '@dsa/contracts';
import { errorHandler } from '../src/http/error-handler';
import { ConfiguredTestAdapter } from '../src/modules/crm/messaging/channel-adapter';
import { MessagingService } from '../src/modules/crm/messaging/messaging-service';
import { createPublicMessagingRouter, createRouter } from '../src/modules/crm/messaging/router';
import { SendEligibilityGuard } from '../src/modules/crm/messaging/send-guard';
import { fakeAuth, testPrincipal, createTestDeps } from './support/fake-auth';

describe('Module 11: Messaging (MOD-MSG) API Unit & Route Tests', () => {
  const tenantA = 'ten_01JTESTTENANT00000000000000';
  const tenantB = 'ten_01JTESTTENANT00000000000002';
  const userA = 'usr_01JTESTUSER0000000000000001';

  let messagingService: MessagingService;
  let testEmailAdapter: ConfiguredTestAdapter;
  let testSmsAdapter: ConfiguredTestAdapter;
  const dummyTxRunner: TxRunner = {
    async withTenantTx() {
      throw new Error('No TxRunner in unit tests');
    },
  };

  beforeEach(() => {
    MessagingService.resetMemoryStore();
    testEmailAdapter = new ConfiguredTestAdapter('EMAIL', 'TEST_SES', true);
    testSmsAdapter = new ConfiguredTestAdapter('SMS', 'TEST_TWILIO', true);

    const guard = new SendEligibilityGuard({ bypassQuietHoursForTest: true });
    messagingService = new MessagingService(undefined, guard);
    messagingService.setAdapter('EMAIL', testEmailAdapter);
    messagingService.setAdapter('SMS', testSmsAdapter);
  });

  function makeApp(principal = testPrincipal(), service = messagingService) {
    const app = express();
    app.use(express.json());
    // Canonical unauthenticated public webhooks (API-MSG-005)
    app.use('/public/v1', createPublicMessagingRouter(createTestDeps({ txRunner: dummyTxRunner }), service));
    app.use(fakeAuth(principal));
    const router = createRouter(createTestDeps({ txRunner: dummyTxRunner }), service);
    app.use('/v1', router);
    app.use(errorHandler());
    return app;
  }

  describe('SUB-MSG.01: Message Templates (API-MSG-001 & API-MSG-002)', () => {
    it('creates a template successfully with config.manage and Idempotency-Key', async () => {
      const app = makeApp(
        testPrincipal({
          id: userA,
          tenantId: tenantA,
          grants: [{ code: 'config.manage', scope: 'TENANT', branchIds: [] }],
        }),
      );

      const res = await request(app)
        .post('/v1/message-templates')
        .set('Idempotency-Key', 'idem_template_001')
        .send({
          code: 'welcome_notice',
          channel: 'EMAIL',
          category: 'TRANSACTIONAL',
          body: 'Hello {{name}}, welcome to our portal!',
          variables: [{ name: 'name', required: true }],
          status: 'APPROVED',
        });

      expect(res.status).toBe(201);
      expect(res.body.code).toBe('welcome_notice');
      expect(res.body.version).toBe(1);
      expect(res.body.channel).toBe('EMAIL');
      expect(res.headers['etag']).toBe('"0"');
    });

    it('rejects template creation without config.manage (403 FORBIDDEN)', async () => {
      const app = makeApp(
        testPrincipal({
          id: userA,
          tenantId: tenantA,
          grants: [{ code: 'message.send', scope: 'TENANT', branchIds: [] }],
        }),
      );

      const res = await request(app)
        .post('/v1/message-templates')
        .set('Idempotency-Key', 'idem_template_002')
        .send({
          code: 'welcome_notice',
          channel: 'EMAIL',
          body: 'Hello {{name}}',
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects template creation without Idempotency-Key (422 VALIDATION_ERROR)', async () => {
      const app = makeApp(
        testPrincipal({
          id: userA,
          tenantId: tenantA,
          grants: [{ code: 'config.manage', scope: 'TENANT', branchIds: [] }],
        }),
      );

      const res = await request(app).post('/v1/message-templates').send({
        code: 'welcome_notice',
        channel: 'EMAIL',
        body: 'Hello {{name}}',
      });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('replays template creation idempotently on duplicate request', async () => {
      const app = makeApp(
        testPrincipal({
          id: userA,
          tenantId: tenantA,
          grants: [{ code: 'config.manage', scope: 'TENANT', branchIds: [] }],
        }),
      );

      const payload = {
        code: 'rate_quote',
        channel: 'EMAIL',
        body: 'Interest rate is {{rate}}%',
        variables: [{ name: 'rate', required: true }],
      };

      const res1 = await request(app)
        .post('/v1/message-templates')
        .set('Idempotency-Key', 'idem_duplicate_test')
        .send(payload);
      expect(res1.status).toBe(201);

      const res2 = await request(app)
        .post('/v1/message-templates')
        .set('Idempotency-Key', 'idem_duplicate_test')
        .send(payload);
      expect(res2.status).toBe(200);
      expect(res2.headers['idempotent-replayed']).toBe('true');
      expect(res2.body.id).toBe(res1.body.id);
    });

    it('enforces tenant isolation on template listing', async () => {
      // Seed template for Tenant A
      MessagingService.seedTemplate({
        id: 'tmpl_01J00000000000000000000001' as MessageTemplate['id'],
        tenantId: tenantA,
        code: 'tenant_a_tmpl',
        channel: 'SMS',
        language: 'en',
        category: 'TRANSACTIONAL',
        body: 'Tenant A content',
        variables: [],
        version: 1,
        status: 'APPROVED',
        lockVersion: 0,
        createdAt: new Date().toISOString(),
        createdBy: userA,
        updatedAt: new Date().toISOString(),
        updatedBy: userA,
      });

      // Query as Tenant B
      const appTenantB = makeApp(
        testPrincipal({
          tenantId: tenantB,
          grants: [{ code: 'message.send', scope: 'TENANT', branchIds: [] }],
        }),
      );

      const res = await request(appTenantB).get('/v1/message-templates');
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(0);
    });
  });

  describe('SUB-MSG.04: Send-Eligibility Guard & Blocked Behaviors (CMP-MSG.04.1)', () => {
    beforeEach(() => {
      // Seed approved template
      MessagingService.seedTemplate({
        id: 'tmpl_01J00000000000000000000002' as MessageTemplate['id'],
        tenantId: tenantA,
        code: 'loan_status_update',
        channel: 'EMAIL',
        language: 'en',
        category: 'TRANSACTIONAL',
        body: 'Dear {{applicantName}}, your application is {{status}}.',
        variables: [
          { name: 'applicantName', required: true },
          { name: 'status', required: true },
        ],
        version: 1,
        status: 'APPROVED',
        lockVersion: 0,
        createdAt: new Date().toISOString(),
        createdBy: userA,
        updatedAt: new Date().toISOString(),
        updatedBy: userA,
      });
    });

    it('blocks sending when required template variables are missing (422 SEND_BLOCKED)', async () => {
      const app = makeApp(
        testPrincipal({
          tenantId: tenantA,
          grants: [{ code: 'message.send', scope: 'TENANT', branchIds: [] }],
        }),
      );

      const res = await request(app)
        .post('/v1/messages')
        .set('Idempotency-Key', 'idem_send_001')
        .send({
          subjectType: 'LEAD',
          subjectId: 'lead_01J00000000000000000000001',
          channel: 'EMAIL',
          templateCode: 'loan_status_update',
          recipient: { email: 'borrower@example.com' },
          variables: { applicantName: 'Amit' }, // missing 'status'
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('SEND_BLOCKED');
      expect(res.body.error.details[0].issue).toBe('TEMPLATE_VARIABLES_INVALID');
      expect(testEmailAdapter.getSentMessages().length).toBe(0);
    });

    it('blocks sending when provider is unconfigured (422 SEND_BLOCKED)', async () => {
      testEmailAdapter.setConfigured(false);

      const app = makeApp(
        testPrincipal({
          tenantId: tenantA,
          grants: [{ code: 'message.send', scope: 'TENANT', branchIds: [] }],
        }),
      );

      const res = await request(app)
        .post('/v1/messages')
        .set('Idempotency-Key', 'idem_send_002')
        .send({
          subjectType: 'LEAD',
          subjectId: 'lead_01J00000000000000000000001',
          channel: 'EMAIL',
          templateCode: 'loan_status_update',
          recipient: { email: 'borrower@example.com' },
          variables: { applicantName: 'Amit', status: 'In Review' },
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('SEND_BLOCKED');
      expect(res.body.error.details[0].issue).toBe('PROVIDER_NOT_CONFIGURED');
      expect(testEmailAdapter.getSentMessages().length).toBe(0);
    });

    it('blocks sending when quiet hours policy is triggered (422 SEND_BLOCKED)', async () => {
      // Create service with quiet hours enforced (current time 23:00 IST)
      const quietGuard = new SendEligibilityGuard({
        bypassQuietHoursForTest: false,
        quietHoursStartHour: 21,
        quietHoursEndHour: 9,
      });

      const quietMessagingService = new MessagingService(undefined, quietGuard);
      quietMessagingService.setAdapter('EMAIL', testEmailAdapter);

      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        req.ctx = {
          principal: testPrincipal({
            tenantId: tenantA,
            grants: [{ code: 'message.send', scope: 'TENANT', branchIds: [] }],
          }),
          correlationId: 'corr_test_quiet',
          now: new Date('2026-10-12T23:30:00+05:30'), // 11:30 PM (inside quiet hours)
        };
        next();
      });
      app.use('/v1', createRouter(createTestDeps({ txRunner: dummyTxRunner }), quietMessagingService));
      app.use(errorHandler());

      const res = await request(app)
        .post('/v1/messages')
        .set('Idempotency-Key', 'idem_send_quiet')
        .send({
          subjectType: 'LEAD',
          subjectId: 'lead_01J00000000000000000000001',
          channel: 'EMAIL',
          templateCode: 'loan_status_update',
          recipient: { email: 'borrower@example.com' },
          variables: { applicantName: 'Amit', status: 'In Review' },
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('SEND_BLOCKED');
      expect(res.body.error.details[0].issue).toBe('QUIET_HOURS');
      expect(testEmailAdapter.getSentMessages().length).toBe(0);
    });

    it('evaluates quiet hours using tenant-configured timezone rather than global hard-coding', async () => {
      // Configure tenant A in 'America/New_York' timezone
      const nyGuard = new SendEligibilityGuard({
        bypassQuietHoursForTest: false,
        quietHoursStartHour: 21, // 9 PM NY time
        quietHoursEndHour: 9, // 9 AM NY time
      });
      nyGuard.setTenantCalendar(tenantA, {
        timezone: 'America/New_York',
        quietHoursStartHour: 21,
        quietHoursEndHour: 9,
      });

      const nyMessagingService = new MessagingService(undefined, nyGuard);
      nyMessagingService.setAdapter('EMAIL', testEmailAdapter);

      // At 22:30 NY time (which is 08:00 AM next day IST)
      // If code used hardcoded IST, 8:00 AM would be quiet hours in IST (< 9 AM),
      // but in NY it is 22:30 (quiet hours in NY!).
      // Now test at 14:00 NY time (00:30 midnight IST):
      // If code used hardcoded IST, midnight IST would be blocked, but 14:00 NY time is business hours!
      const appBusinessHoursNY = express();
      appBusinessHoursNY.use(express.json());
      appBusinessHoursNY.use((req, _res, next) => {
        req.ctx = {
          principal: testPrincipal({
            tenantId: tenantA,
            grants: [{ code: 'message.send', scope: 'TENANT', branchIds: [] }],
          }),
          correlationId: 'corr_test_ny_day',
          now: new Date('2026-10-12T18:00:00Z'), // 14:00 (2 PM) in America/New_York
        };
        next();
      });
      appBusinessHoursNY.use('/v1', createRouter(createTestDeps({ txRunner: dummyTxRunner }), nyMessagingService));
      appBusinessHoursNY.use(errorHandler());

      const resAllow = await request(appBusinessHoursNY)
        .post('/v1/messages')
        .set('Idempotency-Key', 'idem_send_ny_allow')
        .send({
          subjectType: 'LEAD',
          subjectId: 'lead_01J00000000000000000000001',
          channel: 'EMAIL',
          templateCode: 'loan_status_update',
          recipient: { email: 'borrower@example.com' },
          variables: { applicantName: 'Amit', status: 'In Review' },
        });

      // 2 PM in NY is ALLOWED
      expect(resAllow.status).toBe(201);
      expect(resAllow.body.status).toBe('SENT');

      // Now test at 23:00 (11 PM) in America/New_York -> BLOCKED
      const appQuietHoursNY = express();
      appQuietHoursNY.use(express.json());
      appQuietHoursNY.use((req, _res, next) => {
        req.ctx = {
          principal: testPrincipal({
            tenantId: tenantA,
            grants: [{ code: 'message.send', scope: 'TENANT', branchIds: [] }],
          }),
          correlationId: 'corr_test_ny_night',
          now: new Date('2026-10-13T03:00:00Z'), // 23:00 (11 PM) in America/New_York
        };
        next();
      });
      appQuietHoursNY.use('/v1', createRouter(createTestDeps({ txRunner: dummyTxRunner }), nyMessagingService));
      appQuietHoursNY.use(errorHandler());

      const resBlock = await request(appQuietHoursNY)
        .post('/v1/messages')
        .set('Idempotency-Key', 'idem_send_ny_block')
        .send({
          subjectType: 'LEAD',
          subjectId: 'lead_01J00000000000000000000001',
          channel: 'EMAIL',
          templateCode: 'loan_status_update',
          recipient: { email: 'borrower@example.com' },
          variables: { applicantName: 'Amit', status: 'In Review' },
        });

      expect(resBlock.status).toBe(422);
      expect(resBlock.body.error.details[0].issue).toBe('QUIET_HOURS');
    });

    it('enforces hourly frequency caps and blocks subsequent sends (422 SEND_BLOCKED)', async () => {
      const capGuard = new SendEligibilityGuard({
        bypassQuietHoursForTest: true,
        frequencyCapPerHour: 2, // Cap at 2 per hour
      });

      const capService = new MessagingService(undefined, capGuard);
      capService.setAdapter('EMAIL', testEmailAdapter);
      const app = makeApp(
        testPrincipal({
          tenantId: tenantA,
          grants: [{ code: 'message.send', scope: 'TENANT', branchIds: [] }],
        }),
        capService,
      );

      // Send 1 -> OK
      const res1 = await request(app)
        .post('/v1/messages')
        .set('Idempotency-Key', 'idem_cap_1')
        .send({
          subjectType: 'LEAD',
          subjectId: 'lead_01J00000000000000000000001',
          channel: 'EMAIL',
          templateCode: 'loan_status_update',
          recipient: { email: 'capped@example.com' },
          variables: { applicantName: 'Amit', status: 'In Review' },
        });
      expect(res1.status).toBe(201);

      // Send 2 -> OK
      const res2 = await request(app)
        .post('/v1/messages')
        .set('Idempotency-Key', 'idem_cap_2')
        .send({
          subjectType: 'LEAD',
          subjectId: 'lead_01J00000000000000000000001',
          channel: 'EMAIL',
          templateCode: 'loan_status_update',
          recipient: { email: 'capped@example.com' },
          variables: { applicantName: 'Amit', status: 'In Review' },
        });
      expect(res2.status).toBe(201);

      // Send 3 -> BLOCKED with FREQUENCY_CAPPED
      const res3 = await request(app)
        .post('/v1/messages')
        .set('Idempotency-Key', 'idem_cap_3')
        .send({
          subjectType: 'LEAD',
          subjectId: 'lead_01J00000000000000000000001',
          channel: 'EMAIL',
          templateCode: 'loan_status_update',
          recipient: { email: 'capped@example.com' },
          variables: { applicantName: 'Amit', status: 'In Review' },
        });
      expect(res3.status).toBe(422);
      expect(res3.body.error.code).toBe('SEND_BLOCKED');
      expect(res3.body.error.details[0].issue).toBe('FREQUENCY_CAPPED');
    });

    it('blocks sending when recipient has opted out of channel (422 SEND_BLOCKED)', async () => {
      const recipientHash = SendEligibilityGuard.hashRecipient({ email: 'optout@example.com' });
      MessagingService.addOptOut(tenantA, recipientHash, 'EMAIL');

      const app = makeApp(
        testPrincipal({
          tenantId: tenantA,
          grants: [{ code: 'message.send', scope: 'TENANT', branchIds: [] }],
        }),
      );

      const res = await request(app)
        .post('/v1/messages')
        .set('Idempotency-Key', 'idem_send_optout')
        .send({
          subjectType: 'LEAD',
          subjectId: 'lead_01J00000000000000000000001',
          channel: 'EMAIL',
          templateCode: 'loan_status_update',
          recipient: { email: 'optout@example.com' },
          variables: { applicantName: 'Amit', status: 'In Review' },
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('SEND_BLOCKED');
      expect(res.body.error.details[0].issue).toBe('OPT_OUT_CHANNEL');
    });
  });

  describe('SUB-MSG.02 & SUB-MSG.03: Dispatch and Message History', () => {
    beforeEach(() => {
      MessagingService.seedTemplate({
        id: 'tmpl_01J00000000000000000000003' as MessageTemplate['id'],
        tenantId: tenantA,
        code: 'kyc_verified',
        channel: 'EMAIL',
        language: 'en',
        category: 'TRANSACTIONAL',
        body: 'Hello {{name}}, your KYC has been verified.',
        variables: [{ name: 'name', required: true }],
        version: 1,
        status: 'APPROVED',
        lockVersion: 0,
        createdAt: new Date().toISOString(),
        createdBy: userA,
        updatedAt: new Date().toISOString(),
        updatedBy: userA,
      });
    });

    it('successfully dispatches message when all eligibility checks pass', async () => {
      const app = makeApp(
        testPrincipal({
          tenantId: tenantA,
          grants: [{ code: 'message.send', scope: 'TENANT', branchIds: [] }],
        }),
      );

      const res = await request(app)
        .post('/v1/messages')
        .set('Idempotency-Key', 'idem_send_success')
        .send({
          subjectType: 'LEAD',
          subjectId: 'lead_01J00000000000000000000001',
          channel: 'EMAIL',
          templateCode: 'kyc_verified',
          recipient: { email: 'vikram.sharma@example.com' },
          variables: { name: 'Vikram', pin: '123456' }, // 'pin' should be redacted
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('SENT');
      expect(res.body.channel).toBe('EMAIL');
      expect(res.body.recipientMasked).toBe('v***********a@example.com');
      expect(res.body.variablesRedacted.pin).toBe('[REDACTED]');
      expect(res.body.provider).toBe('TEST_SES');
      expect(testEmailAdapter.getSentMessages().length).toBe(1);
    });

    it('lists message history for subject with recipient masking', async () => {
      const app = makeApp(
        testPrincipal({
          tenantId: tenantA,
          grants: [{ code: 'message.send', scope: 'TENANT', branchIds: [] }],
        }),
      );

      // Send a message first
      await request(app)
        .post('/v1/messages')
        .set('Idempotency-Key', 'idem_msg_list')
        .send({
          subjectType: 'CUSTOMER',
          subjectId: 'cust_01J00000000000000000000001',
          channel: 'EMAIL',
          templateCode: 'kyc_verified',
          recipient: { email: 'customer@example.com' },
          variables: { name: 'Pooja' },
        });

      const listRes = await request(app).get(
        '/v1/messages?subjectType=CUSTOMER&subjectId=cust_01J00000000000000000000001',
      );

      expect(listRes.status).toBe(200);
      expect(listRes.body.data.length).toBe(1);
      expect(listRes.body.data[0].recipientMasked).toBe('c******r@example.com');
      expect(listRes.body.data[0].status).toBe('SENT');
    });

    it('handles canonical public delivery webhook without user authentication (POST /public/v1/webhooks/...)', async () => {
      const app = makeApp();

      const callbackPayload = {
        eventId: 'wh_evt_pub_001',
        providerMessageId: 'pmsg_12345',
        status: 'DELIVERED',
        timestamp: new Date().toISOString(),
      };

      // Calling canonical public endpoint without any Authorization header
      const res = await request(app)
        .post('/public/v1/webhooks/messaging/TEST_SES/conn_default')
        .send(callbackPayload);

      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
      expect(res.body.processed).toBe(true);
    });

    it('rejects public webhook when connectionPathId is unknown (404 NOT_FOUND)', async () => {
      const app = makeApp();

      const res = await request(app)
        .post('/public/v1/webhooks/messaging/TEST_SES/conn_unknown')
        .send({
          eventId: 'wh_evt_unknown',
          providerMessageId: 'pmsg_999',
          status: 'DELIVERED',
        });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });
});
