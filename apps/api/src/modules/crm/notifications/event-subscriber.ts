// Notifications from domain events (owner: Dev 1; DSA Notion CMP-NTF.01.1). The outbox relay hands every published event to
// this subscriber. Only the events listed in noticesFor() notify anyone, and each one names its recipient in its own data.
// Events that carry no recipient (for example a lender case status change) notify nobody until a recipient is defined.
import type { DomainEventEnvelope, RequestContext } from '@dsa/contracts';
import type { ApiDeps } from '../../types';
import { NotificationService } from './notification-service';

export interface Notice {
  userId: string;
  category: 'TASK' | 'LEAD' | 'APPLICATION';
  title: string;
  deepLink: string;
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

/** Who is told about a domain event, and what they are told. Pure: no database, no clock. */
export function noticesFor(event: DomainEventEnvelope): Notice[] {
  const data = event.data as Record<string, unknown>;
  switch (event.type) {
    case 'lead.assigned': {
      const owner = text(data.ownerUserId);
      if (!owner) return []; // routed to a queue: queue members are not named, so nobody is told here
      return [{ userId: owner, category: 'LEAD', title: 'A lead has been assigned to you', deepLink: `/leads/${event.subject.id}` }];
    }
    case 'task.created': {
      const owner = text(data.ownerUserId);
      if (!owner) return [];
      return [{ userId: owner, category: 'TASK', title: `New task: ${text(data.title) ?? 'follow-up'}`, deepLink: '/tasks' }];
    }
    case 'application.assigned': {
      const owners = [...new Set([text(data.salesOwnerId), text(data.opsOwnerId)].filter((v): v is string => v !== null))];
      return owners.map((userId) => ({
        userId,
        category: 'APPLICATION' as const,
        title: 'A loan application has been assigned to you',
        deepLink: `/applications/${event.subject.id}`,
      }));
    }
    default:
      return [];
  }
}

/**
 * The subscriber the relay calls. Each notice carries the event id, so a retried delivery of the same event creates nothing
 * new (migration 0090). An error here makes the relay retry the event, which is safe for that reason.
 */
export function createNotificationSubscriber(deps: ApiDeps) {
  const service = new NotificationService(deps.txRunner);
  return async (ctx: RequestContext, event: DomainEventEnvelope): Promise<void> => {
    for (const notice of noticesFor(event)) {
      await service.createNotification(ctx, {
        userId: notice.userId,
        category: notice.category,
        title: notice.title,
        deepLink: notice.deepLink,
        sourceEventId: event.id,
      });
    }
  };
}
