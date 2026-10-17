// apps/api/src/modules/crm/notifications/preference-resolver.ts — owner: Dev 1 / Dev 5
// CMP-NTF.02.1: Notification Preference Resolver (MOD-NTF / SUB-NTF.02)
import type { NotificationCategory, NotificationPreferences } from '@dsa/contracts';

export class PreferenceResolver {
  static readonly DEFAULT_PREFERENCES: NotificationPreferences = {
    channels: {
      inApp: true,
      email: false,
      sms: false,
      whatsapp: false,
    },
    digestFrequency: 'IMMEDIATE',
    mutedCategories: [],
  };

  /**
   * Resolves whether an in-app notification should be produced and delivered for a given category.
   * In-app notifications are suppressed if:
   * 1. channels.inApp is explicitly false, or
   * 2. the category is included in mutedCategories, or
   * 3. digestFrequency is 'MUTED'.
   */
  static shouldDeliverInApp(
    category: NotificationCategory,
    preferences?: NotificationPreferences | null,
  ): boolean {
    const prefs = preferences ?? PreferenceResolver.DEFAULT_PREFERENCES;

    if (prefs.channels?.inApp === false) {
      return false;
    }

    if (prefs.digestFrequency === 'MUTED') {
      return false;
    }

    if (prefs.mutedCategories && prefs.mutedCategories.includes(category)) {
      return false;
    }

    return true;
  }

  /**
   * Normalizes raw preference objects into validated NotificationPreferences with defaults.
   */
  static normalizePreferences(raw?: unknown): NotificationPreferences {
    if (!raw || typeof raw !== 'object') {
      return { ...PreferenceResolver.DEFAULT_PREFERENCES };
    }

    const obj = raw as Record<string, unknown>;
    const channels = (obj.channels as Record<string, boolean>) ?? {};

    return {
      channels: {
        inApp: channels.inApp ?? true,
        email: channels.email ?? false,
        sms: channels.sms ?? false,
        whatsapp: channels.whatsapp ?? false,
      },
      digestFrequency:
        obj.digestFrequency === 'DAILY_DIGEST' || obj.digestFrequency === 'MUTED'
          ? obj.digestFrequency
          : 'IMMEDIATE',
      mutedCategories: Array.isArray(obj.mutedCategories)
        ? (obj.mutedCategories as NotificationCategory[])
        : [],
    };
  }
}
