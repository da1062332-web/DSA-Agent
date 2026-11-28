// The customer status page's progress rules, dates and failure copy (task P3-05, TEST-STATUS-UI-01).
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/client';
import { progressSteps, STATUS_ERROR_COPY, statusErrorKind, updatedLine } from './status-view';

const STEPS = ['Application started', 'Under processing', 'Under review', 'Submitted to lender', 'Approved', 'Disbursed'];

describe('TEST-STATUS-UI-01 progress shows only what the API has reached', () => {
  it('TEST-STATUS-UI-01 steps before the current one are completed, the current one is marked, the rest are upcoming', () => {
    const steps = progressSteps({ steps: STEPS, currentIndex: 2, closed: false });
    expect(steps.map((s) => s.state)).toEqual(['completed', 'completed', 'current', 'upcoming', 'upcoming', 'upcoming']);
    expect(steps[2]?.label).toBe('Under review');
  });

  it('TEST-STATUS-UI-01 nothing is completed when the application is on the first step', () => {
    const steps = progressSteps({ steps: STEPS, currentIndex: 0, closed: false });
    expect(steps[0]?.state).toBe('current');
    expect(steps.filter((s) => s.state === 'completed')).toHaveLength(0);
  });

  it('TEST-STATUS-UI-01 a closed application draws no steps, so no progress is invented', () => {
    expect(progressSteps({ steps: STEPS, currentIndex: null, closed: true })).toEqual([]);
  });

  it('TEST-STATUS-UI-01 a state off the path draws no steps', () => {
    expect(progressSteps({ steps: STEPS, currentIndex: null, closed: false })).toEqual([]);
  });
});

describe('TEST-STATUS-UI-01 the last update date', () => {
  it('TEST-STATUS-UI-01 shows a readable date, and no line for an unreadable one', () => {
    expect(updatedLine('2026-11-26')).toBe('Last updated 26 Nov 2026');
    expect(updatedLine('not-a-date')).toBeNull();
  });
});

describe('TEST-STATUS-UI-01 failure kinds and copy', () => {
  it('TEST-STATUS-UI-01 an expired, invalid or unknown link is one kind, and the copy says so', () => {
    const kind = statusErrorKind(new ApiError('LINK_EXPIRED', 410, 'This link is invalid or has expired.'));
    expect(kind).toBe('expired');
    expect(STATUS_ERROR_COPY.expired.title).toBe('This status link has expired or is no longer valid.');
  });

  it('TEST-STATUS-UI-01 a rate limit (429) is reported as too many attempts, not as expired', () => {
    const kind = statusErrorKind(new ApiError('RATE_LIMITED', 429, 'Too many requests.'));
    expect(kind).toBe('rate-limited');
    expect(STATUS_ERROR_COPY['rate-limited'].title).toBe('Too many attempts. Please try again in a minute.');
  });

  it('TEST-STATUS-UI-01 a dropped connection or any other failure is a failure to load, with the retry copy', () => {
    expect(statusErrorKind(new TypeError('Failed to fetch'))).toBe('network');
    expect(statusErrorKind(new ApiError('INTERNAL_ERROR', 500, 'An unexpected error occurred.'))).toBe('network');
    expect(STATUS_ERROR_COPY.network.title).toBe("We couldn't load your application status. Please try again.");
  });

  it('TEST-STATUS-UI-01 no copy shows a technical code, status number or server message', () => {
    for (const copy of Object.values(STATUS_ERROR_COPY)) {
      const text = `${copy.title} ${copy.body ?? ''}`;
      expect(text).not.toMatch(/\b(4\d\d|5\d\d|LINK_EXPIRED|RATE_LIMITED|INTERNAL_ERROR|error)\b/i);
    }
  });
});
