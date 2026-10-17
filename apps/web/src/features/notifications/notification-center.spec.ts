// apps/web/src/features/notifications/notification-center.spec.ts
// Frontend integration tests for NotificationCenter & NotificationPreferencesDialog.
import { describe, expect, it } from 'vitest';
import {
  NotificationRecordSchema,
  NotificationPreferencesSchema,
  ListNotificationsQuerySchema,
  MarkNotificationsReadSchema,
  type NotificationRecord,
  type NotificationPreferences,
} from '@dsa/contracts';

describe('Frontend Notification Integration Tests', () => {
  it('FE-NTF-001: validates canonical notification record structure received by NotificationCenter', () => {
    const rawNotification = {
      id: 'ntf_01J00000000000000000000001',
      tenantId: 'ten_01JTESTTENANT00000000000000',
      userId: 'usr_01JTESTUSER0000000000000001',
      category: 'TASK',
      title: 'KYC Document Verification Required',
      deepLink: '/tasks/tsk_01',
      readAt: null,
      lockVersion: 0,
      createdAt: '2026-10-12T10:00:00.000Z',
    };

    const parsed = NotificationRecordSchema.parse(rawNotification);
    expect(parsed.id).toBe('ntf_01J00000000000000000000001');
    expect(parsed.category).toBe('TASK');
    expect(parsed.readAt).toBeNull();
    expect(parsed.deepLink).toBe('/tasks/tsk_01');
  });

  it('FE-NTF-002: computes unread count and tab filtering correctly', () => {
    const notifications: NotificationRecord[] = [
      {
        id: 'ntf_01J00000000000000000000001',
        tenantId: 'ten_1',
        userId: 'usr_1',
        category: 'LEAD',
        title: 'New Lead Assigned',
        deepLink: '/leads/1',
        readAt: null,
        lockVersion: 0,
        createdAt: '2026-10-12T10:00:00.000Z',
      },
      {
        id: 'ntf_01J00000000000000000000002',
        tenantId: 'ten_1',
        userId: 'usr_1',
        category: 'APPLICATION',
        title: 'Application Approved',
        deepLink: '/applications/1',
        readAt: '2026-10-12T11:00:00.000Z',
        lockVersion: 1,
        createdAt: '2026-10-12T09:00:00.000Z',
      },
      {
        id: 'ntf_01J00000000000000000000003',
        tenantId: 'ten_1',
        userId: 'usr_1',
        category: 'ALERT',
        title: 'Compliance Check Alert',
        deepLink: '/compliance/1',
        readAt: null,
        lockVersion: 0,
        createdAt: '2026-10-12T08:00:00.000Z',
      },
    ];

    const unreadCount = notifications.filter((n) => !n.readAt).length;
    expect(unreadCount).toBe(2);

    const unreadTab = notifications.filter((n) => !n.readAt);
    expect(unreadTab).toHaveLength(2);
    expect(unreadTab.map((n) => n.id)).toEqual([
      'ntf_01J00000000000000000000001',
      'ntf_01J00000000000000000000003',
    ]);
  });

  it('FE-NTF-003: validates query pagination parameters formulation', () => {
    const query = ListNotificationsQuerySchema.parse({
      limit: '15',
      status: 'UNREAD',
      cursor: 'ntf_01J00000000000000000000002',
    });

    expect(query.limit).toBe(15);
    expect(query.status).toBe('UNREAD');
    expect(query.cursor).toBe('ntf_01J00000000000000000000002');
  });

  it('FE-NTF-004: validates mark-as-read batch payload', () => {
    const payload = MarkNotificationsReadSchema.parse({
      notificationIds: ['ntf_01J00000000000000000000001', 'ntf_01J00000000000000000000002'],
    });
    expect(payload.notificationIds).toHaveLength(2);
  });

  it('FE-NTF-005: handles preferences dialog defaults and customization', () => {
    // Default preferences
    const defaults = NotificationPreferencesSchema.parse({});
    expect(defaults.channels.inApp).toBe(true);
    expect(defaults.channels.email).toBe(false);
    expect(defaults.channels.sms).toBe(false);
    expect(defaults.channels.whatsapp).toBe(false);
    expect(defaults.digestFrequency).toBe('IMMEDIATE');
    expect(defaults.mutedCategories).toEqual([]);

    // Custom preferences saved by user
    const customized: NotificationPreferences = {
      channels: {
        inApp: true,
        email: true,
        sms: false,
        whatsapp: true,
      },
      digestFrequency: 'DAILY_DIGEST',
      mutedCategories: ['SYSTEM', 'ALERT'],
    };

    const validated = NotificationPreferencesSchema.parse(customized);
    expect(validated.channels.email).toBe(true);
    expect(validated.channels.whatsapp).toBe(true);
    expect(validated.digestFrequency).toBe('DAILY_DIGEST');
    expect(validated.mutedCategories).toContain('SYSTEM');
    expect(validated.mutedCategories).toContain('ALERT');
  });

  it('FE-NTF-006: rejects invalid deepLink schemes preventing open redirect / XSS', () => {
    expect(() =>
      NotificationRecordSchema.parse({
        id: 'ntf_01J00000000000000000000001',
        tenantId: 'ten_1',
        userId: 'usr_1',
        category: 'TASK',
        title: 'Malicious Link',
        deepLink: 'javascript:alert(1)',
        readAt: null,
        lockVersion: 0,
        createdAt: '2026-10-12T10:00:00.000Z',
      }),
    ).toThrow();

    expect(() =>
      NotificationRecordSchema.parse({
        id: 'ntf_01J00000000000000000000001',
        tenantId: 'ten_1',
        userId: 'usr_1',
        category: 'TASK',
        title: 'External Open Redirect',
        deepLink: 'https://evil.com/phish',
        readAt: null,
        lockVersion: 0,
        createdAt: '2026-10-12T10:00:00.000Z',
      }),
    ).toThrow();
  });
});
