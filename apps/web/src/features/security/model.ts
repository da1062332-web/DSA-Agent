// Pure helpers for the security events and incidents screen (owner: Akash, Module 39). Kept apart from the page so the rules can be tested.
import type { IncidentRecord, IncidentStatus } from '@dsa/contracts';

/** The forward steps the screen offers. The API is the authority (a CLOSED incident cannot be changed at all). */
const NEXT_STATUS: Record<IncidentStatus, IncidentStatus[]> = {
  OPEN: ['INVESTIGATING', 'CONTAINED', 'RESOLVED'],
  INVESTIGATING: ['CONTAINED', 'RESOLVED'],
  CONTAINED: ['INVESTIGATING', 'RESOLVED'],
  RESOLVED: ['CLOSED', 'INVESTIGATING'],
  CLOSED: [],
};

export const nextStatuses = (status: IncidentStatus): IncidentStatus[] => NEXT_STATUS[status];

export type Tone = 'default' | 'info' | 'warning' | 'error';
export const severityTone = (severity: string): Tone =>
  severity === 'CRITICAL' || severity === 'HIGH' ? 'error' : severity === 'MEDIUM' ? 'warning' : 'info';

/** True when personal data is involved and no notification to the authority has been recorded yet (a DPDP follow-up). */
export const needsAuthorityNotice = (
  i: Pick<IncidentRecord, 'personalDataInvolved' | 'notifications' | 'status'>,
): boolean => i.personalDataInvolved && i.status !== 'CLOSED' && !i.notifications.authority?.notified;

/** The query the API accepts: empty filters are left out. */
export function cleanQuery(filters: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(filters)) if (v !== undefined && v !== '') out[k] = v;
  return out;
}

export const label = (code: string) =>
  code
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
