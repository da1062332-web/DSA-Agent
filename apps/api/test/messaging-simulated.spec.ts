// Messaging: the simulated provider (test only), template approval by a different person, and the delivery status flow.
// Nothing here contacts a real provider or a real customer.
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import type { TxRunner } from '@dsa/contracts';
import { errorHandler } from '../src/http/error-handler';
import { ConfiguredTestAdapter, isSimulatedFailure } from '../src/modules/crm/messaging/channel-adapter';
import { MessagingService } from '../src/modules/crm/messaging/messaging-service';
import { createRouter } from '../src/modules/crm/messaging/router';
import { SendEligibilityGuard } from '../src/modules/crm/messaging/send-guard';
import { fakeAuth, testPrincipal, createTestDeps } from './support/fake-auth';

describe('Messaging: simulated provider, template approval and delivery status (test only)', () => {
  const tenantA = 'ten_01JTESTTENANT00000000000000';
  const tenantB = 'ten_01JTESTTENANT00000000000002';
  const maker = 'usr_01JTESTMAKER000000000000001';
  const checker = 'usr_01JTESTCHECKER00000000000002';
  const subject = { subjectType: 'LEAD', subjectId: 'lead_01J00000000000000000000001' };

  const dummyTxRunner: TxRunner = {
    async withTenantTx() {
      throw new Error('No TxRunner in unit tests');
    },
  };

  let service: MessagingService;
  let simulatedSms: ConfiguredTestAdapter;

  beforeEach(() => {
    MessagingService.resetMemoryStore();
    service = new MessagingService(undefined, new SendEligibilityGuard({ bypassQuietHoursForTest: true }));
    simulatedSms = new ConfiguredTestAdapter('SMS', 'DEV_SIMULATED_TWILIO', true);
    service.setAdapter('SMS', simulatedSms);
    service.setAdapter('EMAIL', new ConfiguredTestAdapter('EMAIL', 'DEV_SIMULATED_SES', true));
  });

  function makeApp(principal: ReturnType<typeof testPrincipal>) {
    const app = express();
    app.use(express.json());
    app.use(fakeAuth(principal));
    app.use('/v1', createRouter(createTestDeps({ txRunner: dummyTxRunner }), service));
    app.use(errorHandler());
    return app;
  }
  const authorPrincipal = (tenantId = tenantA) =>
    testPrincipal({
      id: maker,
      tenantId,
      grants: [
        { code: 'config.manage', scope: 'TENANT', branchIds: [] },
        { code: 'message.send', scope: 'TENANT', branchIds: [] },
      ],
    });
  const checkerPrincipal = (tenantId = tenantA) =>
    testPrincipal({ id: checker, tenantId, grants: [{ code: 'config.manage', scope: 'TENANT', branchIds: [] }] });
  const senderPrincipal = (tenantId = tenantA) =>
    testPrincipal({ id: maker, tenantId, grants: [{ code: 'message.send', scope: 'TENANT', branchIds: [] }] });

  async function createDraft(app: ReturnType<typeof makeApp>, code: string) {
    const res = await request(app)
      .post('/v1/message-templates')
      .set('Idempotency-Key', `idem_${code}_0001`)
      .send({ code, channel: 'SMS', body: 'Your application update is ready.' });
    expect(res.status).toBe(201);
    return res.body as { id: string; status: string };
  }

  describe('Template approval', () => {
    it('a new template is a DRAFT, whatever status the request asks for', async () => {
      const app = makeApp(authorPrincipal());
      const res = await request(app)
        .post('/v1/message-templates')
        .set('Idempotency-Key', 'idem_draft_0001')
        .send({ code: 'draft_notice', channel: 'SMS', body: 'Hello.', status: 'APPROVED' });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('DRAFT');
    });

    it('a draft template cannot be used to send (422 TEMPLATE_NOT_APPROVED)', async () => {
      const app = makeApp(authorPrincipal());
      await createDraft(app, 'draft_send');
      const sent = await request(makeApp(senderPrincipal()))
        .post('/v1/messages')
        .set('Idempotency-Key', 'idem_draft_send_1')
        .send({ ...subject, channel: 'SMS', templateCode: 'draft_send', recipient: { mobile: '+919000000101' }, variables: {} });
      expect(sent.status).toBe(422);
      expect(sent.body.error.code).toBe('SEND_BLOCKED');
      expect(sent.body.error.details[0].issue).toBe('TEMPLATE_NOT_APPROVED');
      expect(simulatedSms.getSentMessages().length).toBe(0);
    });

    it('the person who created a template cannot approve it (SOD)', async () => {
      const app = makeApp(authorPrincipal());
      const tpl = await createDraft(app, 'self_approve');
      const res = await request(app).post(`/v1/message-templates/${tpl.id}/approval`);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.body.error.code).toBe('SOD_VIOLATION');
    });

    it('a different person can approve a draft, and then it can be sent', async () => {
      const tpl = await createDraft(makeApp(authorPrincipal()), 'peer_approved');
      const approved = await request(makeApp(checkerPrincipal())).post(`/v1/message-templates/${tpl.id}/approval`);
      expect(approved.status).toBe(200);
      expect(approved.body.status).toBe('APPROVED');

      const sent = await request(makeApp(senderPrincipal()))
        .post('/v1/messages')
        .set('Idempotency-Key', 'idem_peer_send_1')
        .send({ ...subject, channel: 'SMS', templateCode: 'peer_approved', recipient: { mobile: '+919000000102' }, variables: {} });
      expect(sent.status).toBeLessThan(300);
      expect(sent.body.status).toBe('SENT');
    });

    it('approving a template that is already approved is refused', async () => {
      const tpl = await createDraft(makeApp(authorPrincipal()), 'twice_approved');
      await request(makeApp(checkerPrincipal())).post(`/v1/message-templates/${tpl.id}/approval`);
      const again = await request(makeApp(checkerPrincipal())).post(`/v1/message-templates/${tpl.id}/approval`);
      expect(again.status).toBeGreaterThanOrEqual(400);
      expect(again.body.error.code).toBe('INVALID_STATE');
    });

    it('a template from another tenant cannot be approved (404, tenant isolation)', async () => {
      const tpl = await createDraft(makeApp(authorPrincipal(tenantA)), 'tenant_iso');
      const res = await request(makeApp(checkerPrincipal(tenantB))).post(`/v1/message-templates/${tpl.id}/approval`);
      expect(res.status).toBe(404);
    });
  });

  describe('Simulated provider sends', () => {
    beforeEach(async () => {
      await createDraft(makeApp(authorPrincipal()), 'sim_notice');
      const tpl = (await request(makeApp(authorPrincipal())).get('/v1/message-templates')).body.data.find(
        (t: { code: string }) => t.code === 'sim_notice',
      );
      await request(makeApp(checkerPrincipal())).post(`/v1/message-templates/${tpl.id}/approval`);
    });

    it('a simulated send succeeds as SENT and names the simulated provider', async () => {
      const res = await request(makeApp(senderPrincipal()))
        .post('/v1/messages')
        .set('Idempotency-Key', 'idem_sim_ok_01')
        .send({ ...subject, channel: 'SMS', templateCode: 'sim_notice', recipient: { mobile: '+919000000103' }, variables: {} });
      expect(res.status).toBeLessThan(300);
      expect(res.body.status).toBe('SENT');
      expect(res.body.provider).toBe('DEV_SIMULATED_TWILIO');
    });

    it('a simulated send to a failure test number is recorded as FAILED', async () => {
      const res = await request(makeApp(senderPrincipal()))
        .post('/v1/messages')
        .set('Idempotency-Key', 'idem_sim_fail_1')
        .send({ ...subject, channel: 'SMS', templateCode: 'sim_notice', recipient: { mobile: '+919000000999' }, variables: {} });
      expect(res.status).toBeLessThan(300);
      expect(res.body.status).toBe('FAILED');
    });

    it('the failure rule matches only the designated test recipients', () => {
      expect(isSimulatedFailure({ mobile: '+919000000999' })).toBe(true);
      expect(isSimulatedFailure({ email: 'ops+fail@example.com' })).toBe(true);
      expect(isSimulatedFailure({ mobile: '+919000000103' })).toBe(false);
      expect(isSimulatedFailure({ email: 'borrower@example.com' })).toBe(false);
    });
  });

  describe('Delivery status for simulated messages', () => {
    async function sentSimulatedMessage(app = makeApp(senderPrincipal())) {
      const tpl = await createDraft(makeApp(authorPrincipal()), 'deliv_notice');
      await request(makeApp(checkerPrincipal())).post(`/v1/message-templates/${tpl.id}/approval`);
      const sent = await request(app)
        .post('/v1/messages')
        .set('Idempotency-Key', `idem_deliv_${Math.random().toString(36).slice(2, 10)}`)
        .send({ ...subject, channel: 'SMS', templateCode: 'deliv_notice', recipient: { mobile: '+919000000104' }, variables: {} });
      return sent.body as { id: string; status: string };
    }

    it('a simulated SENT message can be marked DELIVERED, with the change in its history', async () => {
      const msg = await sentSimulatedMessage();
      const res = await request(makeApp(senderPrincipal())).post(`/v1/messages/${msg.id}/simulate-delivery`).send({ outcome: 'DELIVERED' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('DELIVERED');
      const list = await request(makeApp(senderPrincipal())).get('/v1/messages');
      const row = list.body.data.find((m: { id: string }) => m.id === msg.id);
      expect(row.status).toBe('DELIVERED');
    });

    it('a simulated SENT message can be marked UNDELIVERED', async () => {
      const msg = await sentSimulatedMessage();
      const res = await request(makeApp(senderPrincipal())).post(`/v1/messages/${msg.id}/simulate-delivery`).send({ outcome: 'UNDELIVERED' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('UNDELIVERED');
    });

    it('a real provider message cannot be given a test delivery result', async () => {
      service.setAdapter('SMS', new ConfiguredTestAdapter('SMS', 'TEST_TWILIO', true));
      const msg = await sentSimulatedMessage();
      const res = await request(makeApp(senderPrincipal())).post(`/v1/messages/${msg.id}/simulate-delivery`).send({ outcome: 'DELIVERED' });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.body.error.code).toBe('INVALID_STATE');
    });

    it('a FAILED message cannot be given a delivery result', async () => {
      const tpl = await createDraft(makeApp(authorPrincipal()), 'fail_then_deliv');
      await request(makeApp(checkerPrincipal())).post(`/v1/message-templates/${tpl.id}/approval`);
      const failed = await request(makeApp(senderPrincipal()))
        .post('/v1/messages')
        .set('Idempotency-Key', 'idem_fail_deliv_1')
        .send({ ...subject, channel: 'SMS', templateCode: 'fail_then_deliv', recipient: { mobile: '+919000000999' }, variables: {} });
      const res = await request(makeApp(senderPrincipal())).post(`/v1/messages/${failed.body.id}/simulate-delivery`).send({ outcome: 'DELIVERED' });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.body.error.code).toBe('INVALID_STATE');
    });

    it('a message from another tenant cannot be changed (404)', async () => {
      const msg = await sentSimulatedMessage();
      const res = await request(makeApp(senderPrincipal(tenantB))).post(`/v1/messages/${msg.id}/simulate-delivery`).send({ outcome: 'DELIVERED' });
      expect(res.status).toBe(404);
    });
  });
});
