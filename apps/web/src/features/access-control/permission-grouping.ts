// Groups the permission catalogue for the role editor by module and feature (owner: Dev 1; TASK-412). The grouping is PERMISSION_GROUPS in
// @dsa/contracts, so a sub-permission sits under the feature it belongs to (Finance > Payouts: payout.view, payout.request,
// payout.approve, payout.disburse), not under whatever its name starts with. A code the contracts do not group is shown under "Other"
// instead of vanishing, so a new permission is always visible to an administrator. Presentation only: it grants nothing.
import { PERMISSION_GROUPS } from '@dsa/contracts';
import type { Permission } from './types';

export interface PermissionFeatureGroup {
  /** Stable key: `<module>/<feature>`, or `other`. */
  key: string;
  moduleLabel: string;
  featureLabel: string;
  permissions: Permission[];
}

export function groupPermissionsForEditor(permissions: readonly Permission[]): PermissionFeatureGroup[] {
  const byCode = new Map(permissions.map((p) => [p.code, p]));
  const placed = new Set<string>();
  const groups: PermissionFeatureGroup[] = [];

  for (const module of PERMISSION_GROUPS) {
    for (const feature of module.features) {
      // Only the codes this tenant's catalogue actually has, in the order the contracts give them.
      const members = feature.codes.map((c) => byCode.get(c)).filter((p): p is Permission => !!p);
      for (const m of members) placed.add(m.code);
      if (members.length > 0) {
        groups.push({
          key: `${module.id}/${feature.id}`,
          moduleLabel: module.label,
          featureLabel: feature.label,
          permissions: members,
        });
      }
    }
  }

  const other = permissions.filter((p) => !placed.has(p.code)).sort((a, b) => a.code.localeCompare(b.code));
  if (other.length > 0)
    groups.push({ key: 'other', moduleLabel: 'Other', featureLabel: 'Not yet grouped', permissions: other });
  return groups;
}
