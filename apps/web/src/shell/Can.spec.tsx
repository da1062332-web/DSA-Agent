import React from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as useMeModule from '../api/useMe';
import { Can, useCan } from './Can';
import { ACTION_RULES, canPerformAction } from './access';
import { QLOAX_ROLE_GRANTS } from './role-grants.fixture';

vi.mock('../api/useMe', async () => {
  const actual = await vi.importActual<typeof useMeModule>('../api/useMe');
  return {
    ...actual,
    useMe: vi.fn(),
  };
});

describe('Phase 1: Can & useCan permission guards', () => {
  const mockUseMe = vi.mocked(useMeModule.useMe);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockPrincipal(grants: string[], isLoading = false, isError = false) {
    mockUseMe.mockReturnValue({
      data: isLoading || isError ? undefined : {
        id: 'usr_test',
        tenantId: 'ten_test',
        email: 'test@example.com',
        displayName: 'Test User',
        primaryBranchId: null,
        queueIds: [],
        grants: grants.map((code) => ({ code, scope: 'TENANT', branchIds: [] })),
        mfaVerifiedAt: null,
      },
      isLoading,
      isError,
    } as any);
  }

  it('fails closed when useMe is loading', () => {
    mockPrincipal(['lead.create'], true, false);
    const html = renderToString(
      <Can action="lead.create">
        <button id="create-btn">Create</button>
      </Can>,
    );
    expect(html).not.toContain('create-btn');
  });

  it('fails closed when useMe is errored', () => {
    mockPrincipal(['lead.create'], false, true);
    const html = renderToString(
      <Can action="lead.create">
        <button id="create-btn">Create</button>
      </Can>,
    );
    expect(html).not.toContain('create-btn');
  });

  it('hides action control when user lacks required permission', () => {
    mockPrincipal(['lead.read']);
    const html = renderToString(
      <Can action="lead.create">
        <button id="create-btn">Create</button>
      </Can>,
    );
    expect(html).not.toContain('create-btn');
  });

  it('renders action control when user possesses required permission', () => {
    mockPrincipal(['lead.create']);
    const html = renderToString(
      <Can action="lead.create">
        <button id="create-btn">Create</button>
      </Can>,
    );
    expect(html).toContain('create-btn');
  });

  it('renders fallback when unauthorized and fallback is provided', () => {
    mockPrincipal(['lead.read']);
    const html = renderToString(
      <Can action="lead.create" fallback={<span id="forbidden-hint">No access</span>}>
        <button id="create-btn">Create</button>
      </Can>,
    );
    expect(html).not.toContain('create-btn');
    expect(html).toContain('forbidden-hint');
  });

  it('respects optional "when" condition even if permission is held', () => {
    mockPrincipal(['lead.create']);
    const html = renderToString(
      <Can action="lead.create" when={false}>
        <button id="create-btn">Create</button>
      </Can>,
    );
    expect(html).not.toContain('create-btn');
  });

  it('evaluates alias rules properly (e.g. commission.calculate accepts commission.calculate or finance.view)', () => {
    // With finance.view
    mockPrincipal(['finance.view']);
    const html1 = renderToString(
      <Can action="commission.calculate">
        <button id="calc-btn">Calculate</button>
      </Can>,
    );
    expect(html1).toContain('calc-btn');

    // With commission.calculate
    mockPrincipal(['commission.calculate']);
    const html2 = renderToString(
      <Can action="commission.calculate">
        <button id="calc-btn">Calculate</button>
      </Can>,
    );
    expect(html2).toContain('calc-btn');

    // Without either
    mockPrincipal(['lead.read']);
    const html3 = renderToString(
      <Can action="commission.calculate">
        <button id="calc-btn">Calculate</button>
      </Can>,
    );
    expect(html3).not.toContain('calc-btn');
  });

  it('evaluates lender.manage and product.manage fallback to config.manage', () => {
    mockPrincipal(['config.manage']);
    const html = renderToString(
      <div>
        <Can action="lender.manage"><button id="lender-btn">Manage Lender</button></Can>
        <Can action="product.manage"><button id="product-btn">Manage Product</button></Can>
      </div>,
    );
    expect(html).toContain('lender-btn');
    expect(html).toContain('product-btn');
  });
});

describe('Phase 1: ACTION_RULES against live 14 roles fixture', () => {
  const canRole = (role: string) => {
    const grants = new Set(QLOAX_ROLE_GRANTS[role] || []);
    return (code: string) => grants.has(code);
  };

  it('sales executive can create leads and work them, but cannot publish rules, approve payouts, or manage lenders', () => {
    const can = canRole('ROLE-SALES-EXEC');
    expect(canPerformAction('lead.create', can)).toBe(true);
    expect(canPerformAction('lead.update', can)).toBe(true);
    expect(canPerformAction('rule.publish', can)).toBe(false);
    expect(canPerformAction('payout.approve', can)).toBe(false);
    expect(canPerformAction('lender.manage', can)).toBe(false);
  });

  it('compliance role is view-only on operational mutations', () => {
    const can = canRole('ROLE-COMPLIANCE');
    expect(canPerformAction('lead.create', can)).toBe(false);
    expect(canPerformAction('lead.update', can)).toBe(false);
    expect(canPerformAction('lender_case.submit', can)).toBe(false);
    expect(canPerformAction('payout.approve', can)).toBe(false);
    expect(canPerformAction('rule.publish', can)).toBe(false);
  });

  it('finance executive can reconcile finance, manage invoices, and calculate commission', () => {
    const can = canRole('ROLE-FINANCE-EXEC');
    expect(canPerformAction('commission.calculate', can)).toBe(true);
    expect(canPerformAction('finance.reconcile', can)).toBe(true);
    expect(canPerformAction('invoice.manage', can)).toBe(true);
    expect(canPerformAction('lead.create', can)).toBe(false);
  });
});
