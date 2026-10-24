// packages/contracts/src/notification.ts — owner: Dev 1 / Dev 5
// Module: MOD-NTF (Domain DOM-C — Follow-ups & Communication)
// Canonical entity: ENT-033 (notification)
import { z } from 'zod';
import { IdSchema } from './ids';

export const NOTIFICATION_CATEGORIES = ['TASK', 'LEAD', 'APPLICATION', 'SYSTEM', 'ALERT'] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];
export const NotificationCategorySchema = z.enum(NOTIFICATION_CATEGORIES);

export const DIGEST_FREQUENCIES = ['IMMEDIATE', 'DAILY_DIGEST', 'MUTED'] as const;
export type DigestFrequency = (typeof DIGEST_FREQUENCIES)[number];
export const DigestFrequencySchema = z.enum(DIGEST_FREQUENCIES);

/**
 * Notification Channel Preferences
 */
export const NotificationChannelsSchema = z.object({
  inApp: z.boolean().default(true),
  email: z.boolean().default(false),
  sms: z.boolean().default(false),
  whatsapp: z.boolean().default(false),
});
export type NotificationChannels = z.infer<typeof NotificationChannelsSchema>;

/**
 * SUB-NTF.02: User Notification Preferences (stored on ENT-005 app_user)
 */
export const NotificationPreferencesSchema = z.object({
  channels: NotificationChannelsSchema.default({
    inApp: true,
    email: false,
    sms: false,
    whatsapp: false,
  }),
  digestFrequency: DigestFrequencySchema.default('IMMEDIATE'),
  mutedCategories: z.array(NotificationCategorySchema).default([]),
});
export type NotificationPreferences = z.infer<typeof NotificationPreferencesSchema>;

/**
 * ENT-033: Canonical Notification Record
 */
export const NotificationRecordSchema = z.object({
  id: IdSchema('ntf'),
  tenantId: z.string(),
  userId: z.string(),
  category: NotificationCategorySchema,
  title: z.string().min(1).max(250),
  deepLink: z
    .string()
    .min(1)
    .max(500)
    .regex(/^\/[a-zA-Z0-9_.-]+(\/[a-zA-Z0-9_.-]+)*$/, 'Must be an internal relative path starting with /')
    .refine((val) => !val.startsWith('//'), 'Protocol-relative URLs are not allowed'),
  readAt: z.string().nullable(),
  lockVersion: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type NotificationRecord = z.infer<typeof NotificationRecordSchema>;

/**
 * API-NTF-001: Query parameters for listing user notifications
 */
export const ListNotificationsQuerySchema = z.object({
  cursor: IdSchema('ntf').optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['ALL', 'UNREAD', 'READ']).default('ALL'),
});
export type ListNotificationsQuery = z.infer<typeof ListNotificationsQuerySchema>;

/**
 * Identifier schema for notifications. Accepts:
 * - Canonical ULID: ntf_01J... (with or without case-sensitivity)
 * - Seed / test identifiers: ntf_alpha_001, ntf_test_...
 * - Bare ULID: 01J... (26 chars)
 */
export const NotificationIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine(
    (id) =>
      /^ntf_[0-9A-HJKMNP-TV-Z]{26}$/i.test(id) ||
      /^ntf_[a-zA-Z0-9_.-]+$/i.test(id) ||
      /^[0-9A-HJKMNP-TV-Z]{26}$/i.test(id),
    { message: 'must be a valid notification identifier' },
  );

/**
 * API-NTF-002: Payload for marking notifications as read
 */
export const MarkNotificationsReadSchema = z.object({
  notificationIds: z.array(NotificationIdSchema).min(1).max(100),
});
export type MarkNotificationsReadInput = z.infer<typeof MarkNotificationsReadSchema>;

/**
 * Internal Input for creating notifications (server-side only)
 */
export const CreateNotificationInputSchema = z.object({
  userId: z.string(),
  category: NotificationCategorySchema,
  title: z.string().min(1).max(250),
  deepLink: z
    .string()
    .min(1)
    .max(500)
    .regex(/^\/[a-zA-Z0-9_.-]+(\/[a-zA-Z0-9_.-]+)*$/, 'Must be an internal relative path starting with /')
    .refine((val) => !val.startsWith('//'), 'Protocol-relative URLs are not allowed'),
});
export type CreateNotificationInput = z.infer<typeof CreateNotificationInputSchema>;

/**
 * API-USR-009: PATCH /v1/me notification preferences update payload
 */
export const UpdateProfilePreferencesSchema = z
  .object({
    notificationPreferences: NotificationPreferencesSchema.optional(),
    preferences: NotificationPreferencesSchema.optional(),
  })
  .refine((data) => data.notificationPreferences !== undefined || data.preferences !== undefined, {
    message: 'Either notificationPreferences or preferences must be provided',
  });
export type UpdateProfilePreferencesInput = z.infer<typeof UpdateProfilePreferencesSchema>;

/**
 * API-USR-010: GET /v1/me user profile representation
 */
export const UserProfileSchema = z.object({
  id: IdSchema('usr'),
  tenantId: z.string(),
  email: z.string().email(),
  displayName: z.string(),
  userType: z.string(),
  status: z.string(),
  availability: z.string(),
  primaryBranchId: z.string(),
  lockVersion: z.number().int().nonnegative(),
  notificationPreferences: NotificationPreferencesSchema,
});
export type UserProfile = z.infer<typeof UserProfileSchema>;
