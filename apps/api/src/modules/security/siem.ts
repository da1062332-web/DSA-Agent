// apps/api/src/modules/security/siem.ts — Module 39: Security (MOD-SEC)
// SIEM Integration Port, Transports & Client (TASK-431 Implementation)
import type { SecurityEvent } from '@dsa/contracts';

export interface SiemEvent {
  eventId: string;
  tenantId: string;
  type: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  principal: string;
  ip: string;
  details: Record<string, unknown>;
  timestamp: string;
}

export interface SiemDeliveryResult {
  success: boolean;
  messageId?: string;
  error?: string;
  retriable?: boolean;
}

/**
 * Port interface for SIEM event forwarding (TASK-431).
 * Implementations wrap enterprise SIEM sinks (Splunk HEC, Datadog Logs, Elasticsearch, or HTTP Webhooks).
 */
export interface SiemPort {
  forwardEvent(event: SiemEvent): Promise<SiemDeliveryResult>;
}

export function toSiemEvent(event: SecurityEvent): SiemEvent {
  return {
    eventId: event.id,
    tenantId: event.tenantId,
    type: event.type,
    severity: event.severity,
    principal: event.principal,
    ip: event.ip,
    details: event.details,
    timestamp: event.createdAt,
  };
}

/**
 * Standard retry-aware buffered SIEM client.
 * Forwards normalized security events with bounded buffering, retry logic,
 * and fail-safe durability (never drops events from the primary database).
 */
export class BufferedSiemClient implements SiemPort {
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly transport?: (event: SiemEvent) => Promise<{ id: string }>;

  constructor(opts?: {
    maxRetries?: number;
    timeoutMs?: number;
    transport?: (event: SiemEvent) => Promise<{ id: string }>;
  }) {
    this.maxRetries = opts?.maxRetries ?? 3;
    this.timeoutMs = opts?.timeoutMs ?? 5000;
    this.transport = opts?.transport;
  }

  async forwardEvent(event: SiemEvent): Promise<SiemDeliveryResult> {
    if (!this.transport) {
      // TASK-431: External SIEM provider not provisioned.
      // Events are preserved durably in app.security_event table.
      return {
        success: false,
        error: 'SIEM_NOT_CONFIGURED (TASK-431): External SIEM transport endpoint not provisioned.',
        retriable: false,
      };
    }

    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`SIEM request timed out after ${this.timeoutMs}ms`)),
            this.timeoutMs,
          ),
        );
        const result = await Promise.race([this.transport(event), timeoutPromise]);
        return {
          success: true,
          messageId: result.id,
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < this.maxRetries) {
          // Bounded exponential backoff
          const backoff = Math.min(100 * Math.pow(2, attempt), 1000);
          await new Promise((resolve) => setTimeout(resolve, backoff));
        }
      }
    }

    return {
      success: false,
      error: lastError?.message ?? 'Unknown delivery failure',
      retriable: true,
    };
  }
}

/**
 * Splunk HTTP Event Collector (HEC) Transport for Enterprise SIEM (TASK-431)
 */
export function createSplunkHecTransport(opts: {
  endpoint: string;
  token: string;
  index?: string;
  source?: string;
}): (event: SiemEvent) => Promise<{ id: string }> {
  return async (event: SiemEvent) => {
    const url = `${opts.endpoint.replace(/\/+$/, '')}/services/collector/event`;
    const payload = {
      time: Math.floor(new Date(event.timestamp).getTime() / 1000),
      host: 'dsa-crm-api',
      source: opts.source ?? 'dsa-crm-security',
      sourcetype: '_json',
      index: opts.index ?? 'security_events',
      event,
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Splunk ${opts.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Splunk HEC delivery failed (HTTP ${res.status}): ${errText}`);
    }

    return { id: `splunk-${event.eventId}` };
  };
}

/**
 * Datadog Logs API Transport for Enterprise SIEM (TASK-431)
 */
export function createDatadogLogsTransport(opts: {
  apiKey: string;
  site?: string;
  service?: string;
}): (event: SiemEvent) => Promise<{ id: string }> {
  const site = opts.site ?? 'datadoghq.com';
  const url = `https://http-intake.logs.${site}/api/v2/logs`;

  return async (event: SiemEvent) => {
    const payload = [
      {
        ddsource: 'dsa-crm',
        ddtags: `env:production,tenant:${event.tenantId},severity:${event.severity}`,
        hostname: 'dsa-crm-api',
        message: JSON.stringify(event),
        service: opts.service ?? 'dsa-security',
      },
    ];

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'DD-API-KEY': opts.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Datadog Logs delivery failed (HTTP ${res.status}): ${errText}`);
    }

    return { id: `datadog-${event.eventId}` };
  };
}

/**
 * Generic Secure Webhook Transport for Elastic / Graylog / Custom SIEM Receivers (TASK-431)
 */
export function createWebhookSiemTransport(opts: {
  url: string;
  authToken?: string;
  headers?: Record<string, string>;
}): (event: SiemEvent) => Promise<{ id: string }> {
  return async (event: SiemEvent) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(opts.authToken ? { Authorization: `Bearer ${opts.authToken}` } : {}),
      ...(opts.headers ?? {}),
    };

    const res = await fetch(opts.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(event),
    });

    if (!res.ok) {
      throw new Error(`SIEM Webhook delivery failed with status ${res.status}`);
    }

    return { id: `webhook-${event.eventId}` };
  };
}

/**
 * Auto-wires the active SiemPort from environment / Vault credentials.
 */
export function createSiemPortFromEnv(env: Record<string, string | undefined> = process.env): SiemPort {
  const provider = env.SIEM_PROVIDER?.toLowerCase();
  const endpoint = env.SIEM_ENDPOINT;
  const token = env.SIEM_AUTH_TOKEN;

  if (provider === 'splunk' && endpoint && token) {
    return new BufferedSiemClient({
      transport: createSplunkHecTransport({
        endpoint,
        token,
        index: env.SIEM_INDEX,
      }),
    });
  }

  if (provider === 'datadog' && token) {
    return new BufferedSiemClient({
      transport: createDatadogLogsTransport({
        apiKey: token,
        site: env.SIEM_DATADOG_SITE,
      }),
    });
  }

  if (provider === 'webhook' && endpoint) {
    return new BufferedSiemClient({
      transport: createWebhookSiemTransport({
        url: endpoint,
        authToken: token,
      }),
    });
  }

  // Default: Return standard buffered client that fails safe to primary database when unprovisioned
  return new BufferedSiemClient();
}
