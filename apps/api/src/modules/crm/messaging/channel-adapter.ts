// apps/api/src/modules/crm/messaging/channel-adapter.ts — owner: Dev 1 / Dev 5
// CMP-MSG.02.2: Channel Adapters (Email, SMS, WhatsApp)
import type { MessageChannel, MessageRecipient } from '@dsa/contracts';

export interface SendResult {
  providerMessageId: string;
  status: 'SENT' | 'QUEUED';
  sentAt: string;
  metadata?: Record<string, unknown>;
}

export interface ChannelAdapter {
  readonly channel: MessageChannel;
  readonly providerName: string;
  isConfigured(): boolean;
  send(params: {
    recipient: MessageRecipient;
    body: string;
    templateCode: string;
    correlationId: string;
  }): Promise<SendResult>;
}

/**
 * Unconfigured adapter that safely fails closed without faking success.
 */
export class UnconfiguredAdapter implements ChannelAdapter {
  constructor(
    public readonly channel: MessageChannel,
    public readonly providerName: string = 'NONE',
  ) {}

  isConfigured(): boolean {
    return false;
  }

  async send(): Promise<SendResult> {
    throw new Error(`Provider for channel ${this.channel} is not configured`);
  }
}

/**
 * Configured adapter for testing and approved mock provider setups.
 */
export class ConfiguredTestAdapter implements ChannelAdapter {
  private sentMessages: Array<{
    recipient: MessageRecipient;
    body: string;
    templateCode: string;
    correlationId: string;
    providerMessageId: string;
  }> = [];

  constructor(
    public readonly channel: MessageChannel,
    public readonly providerName: string = 'TEST_GATEWAY',
    private configured = true,
  ) {}

  isConfigured(): boolean {
    return this.configured;
  }

  setConfigured(configured: boolean): void {
    this.configured = configured;
  }

  async send(params: {
    recipient: MessageRecipient;
    body: string;
    templateCode: string;
    correlationId: string;
  }): Promise<SendResult> {
    if (!this.configured) {
      throw new Error(`Provider ${this.providerName} for channel ${this.channel} is not configured`);
    }

    const providerMessageId = `pmsg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    this.sentMessages.push({
      ...params,
      providerMessageId,
    });

    return {
      providerMessageId,
      status: 'SENT',
      sentAt: new Date().toISOString(),
    };
  }

  getSentMessages() {
    return [...this.sentMessages];
  }

  clear() {
    this.sentMessages = [];
  }
}
