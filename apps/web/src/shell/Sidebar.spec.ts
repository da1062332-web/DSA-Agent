import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import { mfaRequired, type Me } from '../api/useMe';
import { shouldRetry } from './queryClient';
import { visibleGroups } from './Sidebar';

const labels = (can: (c: string) => boolean, admin = false) =>
  visibleGroups(admin, can).flatMap((g) => g.items.map((i) => i.label));

const grants = (...codes: string[]): Me['grants'] => codes.map((code) => ({ code, scope: 'TENANT', branchIds: [] }));

describe('sidebar visibility by permission', () => {
  it('hides screens whose API the user cannot call', () => {
    // ROLE-RM on the Beta tenant: no message.send, no complaint.*, no sanction.*.
    const rm = new Set(['lead.read', 'task.read', 'application.read', 'verification.read']);
    const shown = labels((c) => rm.has(c));
    expect(shown).toEqual(expect.arrayContaining(['Leads', 'Tasks', 'Applications', 'Lender cases', 'Verification']));
    expect(shown).not.toContain('Messaging');
    expect(shown).not.toContain('Grievances');
    expect(shown).not.toContain('Sanction and disbursement');
    expect(shown).not.toContain('Rule sets');
  });

  it('shows a screen when any one of its permissions is held', () => {
    expect(labels((c) => c === 'complaint.create')).toContain('Grievances');
    expect(labels((c) => c === 'config.manage')).toContain('Messaging');
    expect(labels((c) => c === 'rule.simulate')).toContain('Decisions');
  });

  it('keeps screens that name no read permission, and drops empty groups', () => {
    const shown = labels(() => false);
    expect(shown).toEqual(expect.arrayContaining(['Home', 'Lenders', 'Products', 'Activity']));
    const groups = visibleGroups(false, () => false).map((g) => g.title);
    expect(groups).not.toContain('Business rules (DOM-G)');
  });

  it('shows everything when no check is given', () => {
    expect(visibleGroups(true).flatMap((g) => g.items).length).toBeGreaterThan(30);
  });
});

describe('retry policy', () => {
  it('does not retry refused requests', () => {
    expect(shouldRetry(0, new ApiError('FORBIDDEN', 403, 'no'))).toBe(false);
    expect(shouldRetry(0, new ApiError('UNAUTHENTICATED', 401, 'no'))).toBe(false);
  });
  it('retries other failures up to three times', () => {
    expect(shouldRetry(0, new ApiError('DEPENDENCY_UNAVAILABLE', 503, 'down'))).toBe(true);
    expect(shouldRetry(3, new Error('network'))).toBe(false);
  });
});

describe('mfaRequired', () => {
  it('is required for privileged grants only', () => {
    const me = (...c: string[]) => ({ grants: grants(...c) }) as Me;
    expect(mfaRequired(me('config.manage'))).toBe(true);
    expect(mfaRequired(me('lender_case.submit'))).toBe(true);
    expect(mfaRequired(me('lead.read'))).toBe(false);
  });
});
