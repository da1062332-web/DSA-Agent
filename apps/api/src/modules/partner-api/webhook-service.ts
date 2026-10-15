// apps/api/src/modules/partner-api/webhook-service.ts — owner: Akash (Module 37: API Development)
import crypto from 'node:crypto';
import {
  AppError,
  type CreateWebhookSubscriptionInput,
  type IdPrefix,
  type RequestContext,
  type SandboxSimulateEventRequest,
  type SandboxSimulateEventResponse,
  type WebhookDeliveryLog,
  type WebhookSubscriptionResponse,
} from '@dsa/contracts';
import type { ApiDeps } from '../types';

export interface WebhookSubscriptionRecord {
  id: string;
  tenantId: string;
  partnerId: string;
  name: string;
  targetUrl: string;
  subscribedEvents: string[];
  signingSecret: string;
  secretHash: string;
  status: 'ACTIVE' | 'PAUSED' | 'REVOKED';
  failureCount: number;
  lockVersion: number;
  createdAt: string;
  updatedAt: string;
}

export class WebhookDeliveryService {
  private subscriptions = new Map<string, WebhookSubscriptionRecord>();
  private deliveryLogs: WebhookDeliveryLog[] = [];

  constructor(private deps: ApiDeps) {}

  computeSignature(secret: string, rawPayload: string): string {
    const digest = crypto.createHmac('sha256', secret).update(rawPayload).digest('hex');
    return `sha256=${digest}`;
  }

  private nextId(prefix: IdPrefix): string {
    return this.deps.ids.next(prefix);
  }

  async createSubscription(
    ctx: RequestContext,
    input: CreateWebhookSubscriptionInput,
  ): Promise<WebhookSubscriptionResponse> {
    const { principal } = ctx;
    const hasManage = principal.grants.some((g) => g.code === 'webhook.manage' || g.code === 'config.manage');
    if (!hasManage) {
      throw AppError.of('FORBIDDEN', 'Permission denied: webhook.manage required.');
    }

    const subId = this.nextId('whs');
    const partnerId = principal.kind === 'SERVICE' ? principal.id : 'default_partner';
    const signingSecret = input.secret ?? `whsec_${crypto.randomBytes(24).toString('hex')}`;
    const secretHash = crypto.createHash('sha256').update(signingSecret).digest('hex');

    const record: WebhookSubscriptionRecord = {
      id: subId,
      tenantId: principal.tenantId,
      partnerId,
      name: input.name,
      targetUrl: input.targetUrl,
      subscribedEvents: input.subscribedEvents,
      signingSecret,
      secretHash,
      status: 'ACTIVE',
      failureCount: 0,
      lockVersion: 0,
      createdAt: ctx.now.toISOString(),
      updatedAt: ctx.now.toISOString(),
    };

    this.subscriptions.set(subId, record);

    return {
      id: subId,
      tenantId: principal.tenantId,
      partnerId,
      name: input.name,
      targetUrl: input.targetUrl,
      subscribedEvents: input.subscribedEvents,
      status: 'ACTIVE',
      failureCount: 0,
      lockVersion: 0,
      createdAt: ctx.now.toISOString(),
      updatedAt: ctx.now.toISOString(),
      signingSecret,
    };
  }

  async listSubscriptions(ctx: RequestContext): Promise<WebhookSubscriptionResponse[]> {
    const { principal } = ctx;
    const hasRead = principal.grants.some((g) => g.code === 'webhook.manage' || g.code === 'config.manage' || g.code === 'api.read');
    if (!hasRead) {
      throw AppError.of('FORBIDDEN', 'Permission denied: webhook.manage or api.read required.');
    }

    const matched: WebhookSubscriptionResponse[] = [];
    for (const sub of this.subscriptions.values()) {
      if (sub.tenantId !== principal.tenantId) continue;
      matched.push({
        id: sub.id,
        tenantId: sub.tenantId,
        partnerId: sub.partnerId,
        name: sub.name,
        targetUrl: sub.targetUrl,
        subscribedEvents: sub.subscribedEvents,
        status: sub.status,
        failureCount: sub.failureCount,
        lockVersion: sub.lockVersion,
        createdAt: sub.createdAt,
        updatedAt: sub.updatedAt,
      });
    }
    return matched;
  }

  async deleteSubscription(ctx: RequestContext, id: string): Promise<void> {
    const { principal } = ctx;
    const hasManage = principal.grants.some((g) => g.code === 'webhook.manage' || g.code === 'config.manage');
    if (!hasManage) {
      throw AppError.of('FORBIDDEN', 'Permission denied: webhook.manage required.');
    }

    const sub = this.subscriptions.get(id);
    if (!sub || sub.tenantId !== principal.tenantId) {
      throw AppError.of('NOT_FOUND', `Webhook subscription ${id} not found.`);
    }

    sub.status = 'REVOKED';
  }

  async simulateEvent(
    ctx: RequestContext,
    input: SandboxSimulateEventRequest,
  ): Promise<SandboxSimulateEventResponse> {
    const { principal } = ctx;
    const sub = this.subscriptions.get(input.subscriptionId);
    if (!sub || sub.tenantId !== principal.tenantId) {
      throw AppError.of('NOT_FOUND', `Webhook subscription ${input.subscriptionId} not found.`);
    }

    const simulationId = this.nextId('whd');
    const eventId = `evt_sim_${crypto.randomBytes(8).toString('hex')}`;
    const payload = JSON.stringify({
      eventId,
      eventType: input.eventType,
      occurredAt: ctx.now.toISOString(),
      tenantId: principal.tenantId,
      data: input.customData ?? { testMode: true, simulatedBy: principal.id },
    });

    const signature = this.computeSignature(sub.signingSecret, payload);

    // In local / test simulation, record delivery
    const log: WebhookDeliveryLog = {
      id: simulationId,
      subscriptionId: sub.id,
      eventId,
      eventType: input.eventType,
      httpStatus: 200,
      durationMs: 42,
      attempt: 1,
      status: 'DELIVERED',
      deliveredAt: ctx.now.toISOString(),
      createdAt: ctx.now.toISOString(),
    };
    this.deliveryLogs.push(log);

    return {
      simulationId,
      subscriptionId: sub.id,
      targetUrl: sub.targetUrl,
      eventType: input.eventType,
      signatureHeader: signature,
      deliveryStatus: 'DELIVERED',
      httpStatus: 200,
      durationMs: 42,
    };
  }

  getDeliveryLogs(): WebhookDeliveryLog[] {
    return this.deliveryLogs;
  }
}
