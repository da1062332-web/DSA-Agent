// apps/api/src/modules/crm/notifications/stream-hub.ts — owner: Dev 1 / Dev 5
// Module: MOD-NTF (CMP-NTF.01.1 Server-Sent Events Stream Hub)
import type { Response } from 'express';

export interface SseClient {
  id: string;
  res: Response;
  tenantId: string;
  userId: string;
  connectedAt: Date;
}

export class NotificationStreamHub {
  private static instance: NotificationStreamHub;
  // Key: `${tenantId}:${userId}` -> Set of active SseClient objects
  private clients = new Map<string, Set<SseClient>>();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startHeartbeat();
  }

  static getInstance(): NotificationStreamHub {
    if (!NotificationStreamHub.instance) {
      NotificationStreamHub.instance = new NotificationStreamHub();
    }
    return NotificationStreamHub.instance;
  }

  /**
   * Registers an active SSE client connection
   */
  registerClient(tenantId: string, userId: string, res: Response): () => void {
    return this.subscribe(tenantId, userId, res);
  }

  /**
   * Subscribes an active SSE client connection
   */
  subscribe(tenantId: string, userId: string, res: Response): () => void {
    const key = `${tenantId}:${userId}`;
    const clientId = `conn_${Math.random().toString(36).slice(2, 9)}`;

    const client: SseClient = {
      id: clientId,
      res,
      tenantId,
      userId,
      connectedAt: new Date(),
    };

    if (!this.clients.has(key)) {
      this.clients.set(key, new Set());
    }
    this.clients.get(key)!.add(client);

    // Initial connection comment (Contracts §12)
    res.write(`: connected at ${client.connectedAt.toISOString()}\n\n`);

    const unsubscribe = () => {
      const userClients = this.clients.get(key);
      if (userClients) {
        userClients.delete(client);
        if (userClients.size === 0) {
          this.clients.delete(key);
        }
      }
    };

    if (typeof res.on === 'function') {
      res.on('close', unsubscribe);
    }
    return unsubscribe;
  }

  /**
   * Emits a typed event to all active streams for a specific user within a tenant
   */
  emit(tenantId: string, userId: string, event: string, data: unknown): void {
    const key = `${tenantId}:${userId}`;
    const userClients = this.clients.get(key);
    if (!userClients || userClients.size === 0) {
      return;
    }

    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

    for (const client of userClients) {
      try {
        client.res.write(payload);
      } catch {
        // Handled by close listener
      }
    }
  }

  /**
   * Periodic ping heartbeats every 15s to keep connections alive and prevent proxy timeouts
   */
  private startHeartbeat(): void {
    if (this.heartbeatInterval) return;
    this.heartbeatInterval = setInterval(() => {
      for (const clientSet of this.clients.values()) {
        for (const client of clientSet) {
          try {
            client.res.write(': ping\n\n');
          } catch {
            // Ignore closed sockets
          }
        }
      }
    }, 15000);

    // Unref so timer doesn't prevent Node process exit in tests
    if (this.heartbeatInterval.unref) {
      this.heartbeatInterval.unref();
    }
  }

  /**
   * Observability and test helpers
   */
  getClientCount(tenantId?: string, userId?: string): number {
    if (tenantId && userId) {
      return this.clients.get(`${tenantId}:${userId}`)?.size ?? 0;
    }
    let total = 0;
    for (const set of this.clients.values()) {
      total += set.size;
    }
    return total;
  }

  reset(): void {
    this.clients.clear();
  }
}
