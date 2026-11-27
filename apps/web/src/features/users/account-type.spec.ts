// What the Users screens show for a STAFF account and for a CONNECTOR (partner portal) account: the role cell in the list, the tabs on the
// detail page, and the account-type label. The rules are pure functions in account-type.ts, so both account types are tested here.
import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_TYPE_LABEL,
  contactText,
  detailTabValues,
  hasRoleDetail,
  isPartnerAccount,
  roleCell,
} from './account-type';
import type { AccountType, UserListItem } from './types';

const staff = (assignedRoles: string[] = []) => ({ userType: 'STAFF' as AccountType, assignedRoles });
const partner = () => ({ userType: 'CONNECTOR' as AccountType, assignedRoles: [] as string[] });

describe('account type labels (TEST-ACCT-TYPE)', () => {
  it('TEST-ACCT-TYPE-01 each account type has a readable label', () => {
    expect(ACCOUNT_TYPE_LABEL.STAFF).toBe('Staff');
    expect(ACCOUNT_TYPE_LABEL.CONNECTOR).toBe('Partner portal');
  });

  it('TEST-ACCT-TYPE-02 only a CONNECTOR account is a partner login', () => {
    expect(isPartnerAccount(staff(['ROLE-RM']))).toBe(false);
    expect(isPartnerAccount(partner())).toBe(true);
  });
});

describe('role column in the user list (TEST-ACCT-ROLE)', () => {
  it('TEST-ACCT-ROLE-01 a staff account shows its roles, unchanged', () => {
    expect(roleCell(staff(['ROLE-RM', 'ROLE-LOAN-OPS']))).toEqual({
      partner: false,
      labels: ['ROLE-RM', 'ROLE-LOAN-OPS'],
    });
  });

  it('TEST-ACCT-ROLE-02 a staff account with no roles shows none (an empty label list, so the page prints None)', () => {
    expect(roleCell(staff())).toEqual({ partner: false, labels: [] });
  });

  it('TEST-ACCT-ROLE-03 a partner login shows the Partner portal chip instead of None, and never a role', () => {
    expect(roleCell(partner())).toEqual({ partner: true, labels: ['Partner portal'] });
  });

  it('TEST-ACCT-ROLE-04 a partner login shows no role even if a role name were present on the record', () => {
    // The API never returns a role for a connector login; if one were ever present, the partner cell still hides it.
    expect(roleCell({ userType: 'CONNECTOR', assignedRoles: ['ROLE-RM'] })).toEqual({
      partner: true,
      labels: ['Partner portal'],
    });
  });
});

// GET /v1/users returns the full row only to a user.manage holder (the DSA owner holds user.read but not user.manage). The short directory row
// has no account type, roles or masked contact; the list page used to read assignedRoles.length from it and crashed (Application Error).
describe('short directory row for a user.read holder without user.manage (TEST-ACCT-DIR)', () => {
  const directoryRow: UserListItem = {
    id: 'usr_1',
    displayName: 'Qloax Rule Approver',
    primaryBranchId: 'br_1',
    status: 'ACTIVE',
    availability: 'AVAILABLE',
  };

  it('TEST-ACCT-DIR-01 the role cell does not throw on a short row and gives no labels', () => {
    expect(roleCell(directoryRow)).toEqual({ partner: false, labels: [] });
  });

  it('TEST-ACCT-DIR-02 only a row with role data counts as having role detail: a full staff row (even with no roles) or a partner login', () => {
    expect(hasRoleDetail(directoryRow)).toBe(false);
    expect(hasRoleDetail(staff())).toBe(true);
    expect(hasRoleDetail(staff(['ROLE-RM']))).toBe(true);
    expect(hasRoleDetail(partner())).toBe(true);
  });

  it('TEST-ACCT-DIR-03 the contact cell shows a dash when the row has no masked e-mail, and the masked e-mail when it has one', () => {
    expect(contactText(directoryRow)).toBe('—');
    expect(contactText({ emailMasked: null })).toBe('—');
    expect(contactText({ emailMasked: 'r***r@qloax.com' })).toBe('r***r@qloax.com');
  });

  it('TEST-ACCT-DIR-04 the detail tabs and the partner check tolerate a row without an account type', () => {
    expect(isPartnerAccount(directoryRow)).toBe(false);
    expect(detailTabValues(directoryRow)).toEqual([0, 1, 2, 3]);
  });
});

describe('tabs on the user detail page (TEST-ACCT-TABS)', () => {
  it('TEST-ACCT-TABS-01 a staff account keeps all four tabs: profile, status, roles, audit', () => {
    expect(detailTabValues(staff(['ROLE-RM']))).toEqual([0, 1, 2, 3]);
  });

  it('TEST-ACCT-TABS-02 a partner login has no Roles tab: profile, status and audit only', () => {
    expect(detailTabValues(partner())).toEqual([0, 1, 3]);
    expect(detailTabValues(partner())).not.toContain(2);
  });
});
