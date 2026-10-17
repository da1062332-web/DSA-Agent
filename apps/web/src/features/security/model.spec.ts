import type { IncidentRecord } from '@dsa/contracts';
import { describe, expect, it } from 'vitest';
import { cleanQuery, label, needsAuthorityNotice, nextStatuses, severityTone } from './model';

const incident = (over: Partial<IncidentRecord>) =>
  ({ personalDataInvolved: true, status: 'OPEN', notifications: {}, ...over }) as IncidentRecord;

describe('security incident rules on the screen', () => {
  it('TEST-UI-SEC-01 a closed incident offers no further step, an open one moves forward', () => {
    expect(nextStatuses('CLOSED')).toEqual([]);
    expect(nextStatuses('OPEN')).toContain('INVESTIGATING');
    expect(nextStatuses('RESOLVED')).toContain('CLOSED');
  });

  it('TEST-UI-SEC-02 severity colours: high and critical are errors, medium a warning, low informational', () => {
    expect(['CRITICAL', 'HIGH'].map(severityTone)).toEqual(['error', 'error']);
    expect(severityTone('MEDIUM')).toBe('warning');
    expect(severityTone('LOW')).toBe('info');
  });

  it('TEST-UI-SEC-03 the authority-notice warning shows for open incidents with personal data and no recorded notice only', () => {
    expect(needsAuthorityNotice(incident({}))).toBe(true);
    expect(needsAuthorityNotice(incident({ personalDataInvolved: false }))).toBe(false);
    expect(needsAuthorityNotice(incident({ status: 'CLOSED' }))).toBe(false);
    expect(
      needsAuthorityNotice(
        incident({
          notifications: { authority: { notified: true, notifiedAt: '2026-10-16T10:00:00.000Z' } },
        }),
      ),
    ).toBe(false);
  });

  it('TEST-UI-SEC-04 empty filters are not sent, and codes read as words', () => {
    expect(cleanQuery({ status: 'OPEN', severity: '', type: undefined })).toEqual({ status: 'OPEN' });
    expect(label('UNAUTHORIZED_ACCESS')).toBe('Unauthorized access');
  });
});
