import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import { mfaRequired, type Me } from '../api/useMe';
import { shouldRetry } from './queryClient';
import { visibleGroups } from './Sidebar';

const labels = (can: (c: string) => boolean, admin = false) =>
  visibleGroups(admin, can).flatMap((g) => g.items.map((i) => i.label));

const grants = (...codes: string[]): Me['grants'] =>
  codes.map((code) => ({ code, scope: 'TENANT', branchIds: [] }));

describe('sidebar visibility by permission', () => {
  it('hides screens whose API the user cannot call', () => {
    // ROLE-RM on the Beta tenant: no message.send, no complaint.*, no sanction.*.
    const rm = new Set(['lead.read', 'task.read', 'application.read', 'verification.read']);
    const shown = labels((c) => rm.has(c));
    expect(shown).toEqual(
      expect.arrayContaining(['Leads', 'Tasks', 'Applications', 'Lender cases', 'Verification']),
    );
    expect(shown).not.toContain('Messaging');
    expect(shown).not.toContain('Grievances');
    expect(shown).not.toContain('Sanction and disbursement');
    expect(shown).not.toContain('Rule sets');
  });

  it('shows security events and incidents only to someone holding security.incident, and never to a platform operator', () => {
    expect(labels((c) => c === 'security.incident')).toContain('Security events and incidents');
    expect(labels((c) => c === 'lead.read')).not.toContain('Security events and incidents');
    const platform = visibleGroups(false, () => true, true).flatMap((g) => g.items.map((i) => i.label));
    expect(platform).not.toContain('Security events and incidents');
  });

  it('offers Documents as a real screen to anyone who can read applications', () => {
    const group = visibleGroups(false, (c) => c === 'application.read')
      .flatMap((g) => g.items)
      .find((i) => i.label === 'Documents');
    expect(group?.to).toBe('/documents');
    expect(group?.task).toBeUndefined();
  });

  it('shows the Platform Console only in the platform realm, even to a customer-tenant role that holds platform.console', () => {
    const customer = visibleGroups(true, () => true, false).flatMap((g) => g.items.map((i) => i.label));
    expect(customer).not.toContain('Platform Console');
    const platform = visibleGroups(false, () => true, true).flatMap((g) => g.items.map((i) => i.label));
    expect(platform).toContain('Platform Console');
  });

  it('shows a screen when any one of its permissions is held', () => {
    expect(labels((c) => c === 'complaint.create')).toContain('Grievances');
    expect(labels((c) => c === 'config.manage')).toContain('Messaging');
    expect(labels((c) => c === 'rule.simulate')).toContain('Decisions');
  });

  it('keeps screens that name no read permission, and drops empty groups', () => {
    const shown = labels(() => false);
    expect(shown).toEqual(expect.arrayContaining(['Home', 'Lenders', 'Products', 'Notifications']));
    // Every other screen is tied to the permission its list endpoint enforces, so none of these shows for someone with no grants.
    for (const hidden of [
      'Leads',
      'Customers',
      'Activity',
      'Commission',
      'Payouts',
      'Reconciliation',
      'Invoices',
      'Automation rules',
      'Verification workbench',
    ]) {
      expect(shown).not.toContain(hidden);
    }
    const groups = visibleGroups(false, () => false).map((g) => g.title);
    expect(groups).not.toContain('Finance & Settlement');
    expect(groups).not.toContain('Sales & CRM');
    expect(groups).not.toContain('Analytics & Performance');
  });

  it('shows everything when no check is given', () => {
    expect(visibleGroups(true).flatMap((g) => g.items).length).toBeGreaterThan(30);
  });
});

describe('platform realm in the sidebar', () => {
  it('TEST-REALM-WEB-001 a tenant administrator (no platform permission) sees Approvals but not the Platform Console', () => {
    const tenantAdmin = new Set([
      'config.manage',
      'user.manage',
      'data_correction.request',
      'data_correction.approve',
    ]);
    const shown = labels((c) => tenantAdmin.has(c), true);
    expect(shown).toContain('Approvals');
    expect(shown).not.toContain('Platform Console');
  });

  it('TEST-REALM-WEB-002 a platform operator sees the Platform Console, and not the tenant administration screens', () => {
    const operator = new Set(['platform.console', 'platform.flags', 'platform.support_access']);
    const shown = labels((c) => operator.has(c), false);
    expect(shown).not.toContain('Approvals');
    expect(
      visibleGroups(false, (c) => operator.has(c)).flatMap((g) => g.items.map((i) => i.label)),
    ).not.toContain('Users');
  });

  it('TEST-REALM-WEB-004 in the platform realm the menu has no tenant screens, whatever the permissions', () => {
    const everything = () => true;
    // Not an admin: a platform operator holds no config.manage or user.manage, and still needs the Platform Console.
    const shown = visibleGroups(false, everything, true).flatMap((g) => g.items.map((i) => i.label));
    expect([...shown].sort()).toEqual(['Home', 'Platform Console', 'Security']);
    for (const tenantScreen of [
      'Leads',
      'Customers',
      'Payouts',
      'Workforce',
      'Invoices',
      'Reconciliation',
      'Approvals',
    ])
      expect(shown).not.toContain(tenantScreen);
    // A customer tenant is unaffected, and still has no Platform Console without the permission.
    expect(visibleGroups(true, everything, false).flatMap((g) => g.items).length).toBeGreaterThan(30);
  });

  it('TEST-REALM-WEB-003 the Platform Console item is for the platform realm and needs platform.console there; a customer-tenant role never gets it', () => {
    const inPlatform = (can: (c: string) => boolean) =>
      visibleGroups(false, can, true).flatMap((g) => g.items.map((i) => i.label));
    expect(inPlatform((c) => c === 'platform.console')).toContain('Platform Console');
    expect(inPlatform(() => false)).not.toContain('Platform Console');
    // Customer realm: an admin without the permission, and (since 2026-10-17) a role that holds it by mistake, both get no entry.
    expect(labels((c) => c === 'config.manage' || c === 'user.manage', true)).not.toContain(
      'Platform Console',
    );
    expect(labels((c) => c === 'platform.console', true)).not.toContain('Platform Console');
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
