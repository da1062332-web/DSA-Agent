// apps/web/src/features/platform-admin/tenant-flags-model.ts
// What the tenant page says about a flag, kept out of the component so it can be tested without a browser.
import type { TenantFeatureFlag } from '@dsa/contracts';

export const onOff = (value: boolean): string => (value ? 'ON' : 'OFF');

/** "Overridden" when this tenant has its own value, otherwise it follows the platform default. */
export function flagState(flag: TenantFeatureFlag): { label: string; overridden: boolean } {
  return flag.overridden
    ? { label: `Overridden (${onOff(flag.value)}, default ${onOff(flag.defaultValue)})`, overridden: true }
    : { label: `Using default (${onOff(flag.defaultValue)})`, overridden: false };
}

/** The sentence the operator confirms. It names the tenant and says what is NOT affected. */
export function confirmMessage(tenantName: string, flag: TenantFeatureFlag, next: boolean): string {
  return `Turn ${flag.key} ${onOff(next)} for ${tenantName} only? The platform default (${onOff(flag.defaultValue)}), the global flags and every other tenant are not changed.`;
}

/** What the page sends: the tenant it is showing, the flag, the new value and the override version it read (0 = none yet). */
export function updateRequest(
  tenantId: string,
  flag: TenantFeatureFlag,
  next: boolean,
): { tenantId: string; key: string; value: boolean; version: number } {
  // The flag row came from this tenant's list; refuse to send it anywhere else.
  if (flag.tenantId !== tenantId)
    throw new Error('This flag belongs to a different tenant than the one on screen.');
  return { tenantId, key: flag.key, value: next, version: flag.lockVersion };
}
