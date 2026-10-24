import { describe, expect, it } from 'vitest';
import {
  CreateNotificationInputSchema,
  ListNotificationsQuerySchema,
  MarkNotificationsReadSchema,
  NotificationPreferencesSchema,
  NotificationRecordSchema,
} from './notification';

describe('Notification Contracts (packages/contracts/src/notification.ts)', () => {
  it('validates canonical NotificationRecord schema', () => {
    const valid = {
      id: 'ntf_01J00000000000000000000001',
      tenantId: 'ten_01JTESTTENANT00000000000000',
      userId: 'usr_01JTESTUSER0000000000000001',
      category: 'TASK',
      title: 'First-contact call due for Lead Amit',
      deepLink: '/leads/lead_01J00000000000000000000001',
      readAt: null,
      lockVersion: 0,
      createdAt: '2026-10-12T10:00:00.000Z',
    };

    const parsed = NotificationRecordSchema.parse(valid);
    expect(parsed.id).toBe(valid.id);
    expect(parsed.category).toBe('TASK');
    expect(parsed.readAt).toBeNull();
  });

  it('rejects external or dangerous deep links in CreateNotificationInputSchema', () => {
    const dangerousLinks = [
      'https://malicious.com/phish',
      'javascript:alert(1)',
      '//attacker.com/leak',
      'relative/without/leading/slash',
    ];

    for (const deepLink of dangerousLinks) {
      expect(() =>
        CreateNotificationInputSchema.parse({
          userId: 'usr_01JTESTUSER0000000000000001',
          category: 'LEAD',
          title: 'New Lead Assigned',
          deepLink,
        }),
      ).toThrow();
    }

    const safe = CreateNotificationInputSchema.parse({
      userId: 'usr_01JTESTUSER0000000000000001',
      category: 'LEAD',
      title: 'New Lead Assigned',
      deepLink: '/leads/lead_01J00000000000000000000001',
    });
    expect(safe.deepLink).toBe('/leads/lead_01J00000000000000000000001');
  });

  it('validates MarkNotificationsRead payload constraints', () => {
    expect(() => MarkNotificationsReadSchema.parse({ notificationIds: [] })).toThrow();

    const valid = MarkNotificationsReadSchema.parse({
      notificationIds: [
        'ntf_01J00000000000000000000001',
        'ntf_01J00000000000000000000002',
        '01M5PQB2M2P6KX7HKVDPYCP8PN', // bare ULID
        'ntf_alpha_001', // seed format
      ],
    });
    expect(valid.notificationIds.length).toBe(4);
  });

  it('validates and applies defaults for NotificationPreferences', () => {
    const emptyParsed = NotificationPreferencesSchema.parse({});
    expect(emptyParsed.channels.inApp).toBe(true);
    expect(emptyParsed.channels.email).toBe(false);
    expect(emptyParsed.digestFrequency).toBe('IMMEDIATE');
    expect(emptyParsed.mutedCategories).toEqual([]);

    const customized = NotificationPreferencesSchema.parse({
      channels: { inApp: true, email: true, sms: false, whatsapp: false },
      digestFrequency: 'DAILY_DIGEST',
      mutedCategories: ['SYSTEM', 'ALERT'],
    });
    expect(customized.channels.email).toBe(true);
    expect(customized.digestFrequency).toBe('DAILY_DIGEST');
    expect(customized.mutedCategories).toContain('SYSTEM');
  });

  it('validates ListNotificationsQuery pagination and filtering', () => {
    const q1 = ListNotificationsQuerySchema.parse({});
    expect(q1.limit).toBe(20);
    expect(q1.status).toBe('ALL');

    const q2 = ListNotificationsQuerySchema.parse({
      cursor: 'ntf_01J00000000000000000000001',
      limit: '50',
      status: 'UNREAD',
    });
    expect(q2.limit).toBe(50);
    expect(q2.status).toBe('UNREAD');
  });
});
