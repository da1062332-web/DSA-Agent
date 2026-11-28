// The customer status page's wording and error rules (task P3-05, TEST-STATUS-UI-01).
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/client';
import { linkErrorMessage, pendingLine, updatedLine } from './status-view';

describe('TEST-STATUS-UI-01 the customer status wording', () => {
  it('TEST-STATUS-UI-01 names the documents still pending, and shows nothing when none are', () => {
    expect(pendingLine(['Salary slip'])).toBe('Pending: Salary slip');
    expect(pendingLine(['Salary slip', 'Bank statement'])).toBe('Pending: Salary slip, Bank statement');
    expect(pendingLine([])).toBeNull();
  });

  it('TEST-STATUS-UI-01 shows the last update as a readable date, and no line for an unreadable date', () => {
    expect(updatedLine('2026-11-26')).toBe('Last updated 26 Nov 2026');
    expect(updatedLine('not-a-date')).toBeNull();
  });

  it('TEST-STATUS-UI-01 an expired link says so, and asks for a new one', () => {
    const msg = linkErrorMessage(new ApiError('LINK_EXPIRED', 410, 'This link is invalid or has expired.'));
    expect(msg.title).toBe('This link has expired');
    expect(msg.body).toContain('new status link');
  });

  it('TEST-STATUS-UI-01 a rate limit asks the customer to wait, and is not reported as expired', () => {
    const msg = linkErrorMessage(new ApiError('RATE_LIMITED', 429, 'Too many requests.'));
    expect(msg.title).toBe('Too many tries');
    expect(msg.title).not.toContain('expired');
  });

  it('TEST-STATUS-UI-01 any other failure says the link could not be opened', () => {
    expect(linkErrorMessage(new Error('network down')).title).toBe('This link could not be opened');
  });
});
