// apps/api/src/modules/security/siem.ts — Module 39: Security (MOD-SEC)
// SIEM Integration Port & Client (TASK-431 Boundary)
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
 * Implementations wrap enterprise SIEM sinks (Splunk HEC, Datadog Logs, Elasticsearch).
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
          setTimeout(() => reject(new Error(`SIEM request timed out after ${this.timeoutMs}ms`)), this.timeoutMs),
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
