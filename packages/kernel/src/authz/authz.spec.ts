import type { AppError, Principal, ScopedRecordRef } from '@dsa/contracts';
import { describe, expect, it } from 'vitest';
import { createAuthz, requirePermissionForBranch } from './authz';

const authz = createAuthz();
const principal = (p: Partial<Principal> = {}): Principal => ({
  kind: 'USER',
  id: 'usr_ME',
  tenantId: 'ten_T',
  primaryBranchId: 'br_A',
  managedTeamMemberIds: [],
  queueIds: [],
  grants: [],
  authTime: null,
  ...p,
});
const ctx = (p: Principal, now = new Date('2026-10-12T10:00:00Z')) => ({
  principal: p,
  correlationId: 'c',
  now,
});
const rec = (r: Partial<ScopedRecordRef> = {}): ScopedRecordRef => ({
  recordType: 'LEAD',
  branchId: 'br_A',
  ownerUserIds: [],
  queueIds: [],
  ...r,
});

const codeOf = (fn: () => void) => {
  try {
    fn();
    return 'OK';
  } catch (e) {
    return (e as AppError).code;
  }
};

describe('Authz (TASK-104)', () => {
  it('TEST-ACL-104-01 requirePermission: 403 without the code, OK with it', () => {
    expect(codeOf(() => authz.requirePermission(ctx(principal()), 'config.manage'))).toBe('FORBIDDEN');
    const p = principal({ grants: [{ code: 'config.manage', scope: 'TENANT', branchIds: [] }] });
    expect(codeOf(() => authz.requirePermission(ctx(p), 'config.manage'))).toBe('OK');
  });

  it('TEST-ACL-104-02 OWN scope: own record OK, colleague record 404', () => {
    const p = principal({ grants: [{ code: 'lead.read', scope: 'OWN', branchIds: [] }] });
    expect(codeOf(() => authz.requireOnRecord(ctx(p), 'lead.read', rec({ ownerUserIds: ['usr_ME'] })))).toBe(
      'OK',
    );
    expect(codeOf(() => authz.requireOnRecord(ctx(p), 'lead.read', rec({ ownerUserIds: ['usr_X'] })))).toBe(
      'NOT_FOUND',
    );
  });

  it('TEST-ACL-104-03 visible but missing the code is 403; null record is 404', () => {
    const p = principal({ grants: [{ code: 'lead.read', scope: 'TENANT', branchIds: [] }] });
    expect(codeOf(() => authz.requireOnRecord(ctx(p), 'lead.qualify', rec()))).toBe('FORBIDDEN');
    expect(codeOf(() => authz.requireOnRecord(ctx(p), 'lead.read', null))).toBe('NOT_FOUND');
  });

  it('TEST-ACL-104-04 BRANCH scope follows the granted branches; TEAM covers managed members and queues', () => {
    const b = principal({ grants: [{ code: 'lead.read', scope: 'BRANCH', branchIds: ['br_A'] }] });
    expect(codeOf(() => authz.requireOnRecord(ctx(b), 'lead.read', rec({ branchId: 'br_A' })))).toBe('OK');
    expect(codeOf(() => authz.requireOnRecord(ctx(b), 'lead.read', rec({ branchId: 'br_B' })))).toBe(
      'NOT_FOUND',
    );

    const t = principal({
      managedTeamMemberIds: ['usr_RM'],
      queueIds: ['wq_1'],
      grants: [{ code: 'lead.read', scope: 'TEAM', branchIds: [] }],
    });
    expect(codeOf(() => authz.requireOnRecord(ctx(t), 'lead.read', rec({ ownerUserIds: ['usr_RM'] })))).toBe(
      'OK',
    );
    expect(codeOf(() => authz.requireOnRecord(ctx(t), 'lead.read', rec({ queueIds: ['wq_1'] })))).toBe('OK');
    expect(codeOf(() => authz.requireOnRecord(ctx(t), 'lead.read', rec({ ownerUserIds: ['usr_X'] })))).toBe(
      'NOT_FOUND',
    );
  });

  it('TEST-ACL-104-05 step-up: needs a TOTP verification within 900 s', () => {
    const now = new Date('2026-10-12T10:00:00Z');
    expect(codeOf(() => authz.requireStepUp(ctx(principal(), now)))).toBe('STEP_UP_REQUIRED');
    const fresh = principal({ authTime: '2026-10-12T09:50:00Z' });
    expect(codeOf(() => authz.requireStepUp(ctx(fresh, now)))).toBe('OK');
    const stale = principal({ authTime: '2026-10-12T09:40:00Z' });
    expect(codeOf(() => authz.requireStepUp(ctx(stale, now)))).toBe('STEP_UP_REQUIRED');
  });

  it('TEST-ACL-104-06 branch-scoped admin: own branch OK, other or cross-branch 403; TENANT covers all', () => {
    const bm = principal({ grants: [{ code: 'user.manage', scope: 'BRANCH', branchIds: ['br_A'] }] });
    const check = (p: Principal, branchId: string | null) =>
      codeOf(() => requirePermissionForBranch(ctx(p), ['config.manage', 'user.manage'], branchId));
    expect(check(bm, 'br_A')).toBe('OK');
    expect(check(bm, 'br_B')).toBe('FORBIDDEN');
    expect(check(bm, null)).toBe('FORBIDDEN');
    expect(check(principal(), 'br_A')).toBe('FORBIDDEN');
    const admin = principal({ grants: [{ code: 'config.manage', scope: 'TENANT', branchIds: [] }] });
    expect(check(admin, null)).toBe('OK');
    expect(requirePermissionForBranch(ctx(admin), ['config.manage', 'user.manage'], 'br_B')).toBe(
      'config.manage',
    );
  });
});
