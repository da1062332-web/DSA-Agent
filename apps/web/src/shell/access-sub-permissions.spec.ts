// Sub-permissions in the sidebar and the route guard (owner: Dev 1; migration M-098). A screen opens for the sub-permission that names
// it, still opens for the coarse code that opened it before the split (transition), and does not open for a role that holds neither.
import { PERMISSION_CODES } from '@dsa/contracts';
import { describe, expect, it } from 'vitest';
import {
  ACTION_RULES,
  EXTRA_ROUTE_RULES,
  NAV_GROUPS,
  getSearchableItems,
  routeAllowed,
  visibleGroups,
} from './access';

const labelsFor = (held: string[], opts: { disabledModules?: string[]; connectorLogin?: boolean } = {}) => {
  const set = new Set(held);
  return visibleGroups(
    false,
    (c) => set.has(c),
    false,
    opts.connectorLogin ?? false,
    opts.disabledModules ?? [],
  )
    .flatMap((g) => g.items)
    .filter((i) => i.to)
    .map((i) => i.label);
};

describe('a sub-permission opens exactly its own screen', () => {
  // [sub-permission, the screen it opens, a coarse code that opened it before the split]
  const CASES: [string, string, string | null][] = [
    ['lender_case.read', 'Lender cases', 'lender_case.submit'],
    ['sanction.read', 'Sanction and disbursement', 'sanction.record'],
    ['disbursement.read', 'Sanction and disbursement', 'disbursement.verify'],
    ['eligibility.read', 'Eligibility', null],
    ['org.manage', 'Organisation', 'config.manage'],
    ['team.manage', 'Teams', 'user.manage'],
    ['settings.manage', 'Configuration', 'config.manage'],
    ['message_template.manage', 'Messaging', 'config.manage'],
    ['user.read', 'Users', 'user.manage'],
    ['role.read', 'Access control', 'role.manage'],
    ['activity.read', 'Activity', 'activity.create'],
    ['complaint.read', 'Grievances', 'complaint.manage'],
    ['attendance.read', 'Workforce', 'attendance.manage'],
    ['commission.view', 'Commission', 'finance.view'],
    ['payout.view', 'Payouts', 'finance.view'],
    ['ledger.view', 'Ledger', 'finance.view'],
    ['reconciliation.view', 'Reconciliation', 'finance.view'],
    ['invoice.view', 'Invoices', 'finance.view'],
    ['performance.read', 'Performance Dashboard', null],
    ['target.read', 'Targets', 'target.manage'],
    ['privacy.read', 'Privacy and consent', 'privacy.manage'],
    ['security.read', 'Security events and incidents', 'security.incident'],
    ['import.read', 'Import and export', 'import.run'],
  ];

  for (const [sub, screen, legacy] of CASES) {
    it(`TEST-SUBPERM-01 ${sub} opens ${screen}${legacy ? `, and so still does ${legacy}` : ''}`, () => {
      expect(labelsFor([sub]), `${sub} alone`).toContain(screen);
      if (legacy) expect(labelsFor([legacy]), `${legacy} alone (transition)`).toContain(screen);
    });
  }

  it('TEST-SUBPERM-01 a broad read permission opens its own screens and not the ones that were split from it', () => {
    // These are the leaks behind "I can see a screen I have no business with": a role must keep application.read for Applications,
    // customer.read for Customers and report.read for Reports, and that must not also open Lender cases, Privacy or Performance.
    const apps = labelsFor(['application.read']);
    expect(apps).toContain('Applications');
    for (const gone of ['Lender cases', 'Eligibility', 'Documents', 'Activity'])
      expect(apps, gone).not.toContain(gone);

    const customers = labelsFor(['customer.read']);
    expect(customers).toContain('Customers');
    for (const gone of ['Privacy and consent', 'Activity']) expect(customers, gone).not.toContain(gone);

    const leads = labelsFor(['lead.read']);
    expect(leads).toContain('Leads');
    expect(leads).not.toContain('Activity');

    const reports = labelsFor(['report.read']);
    expect(reports).toContain('Reports & Catalogue');
    for (const gone of ['Performance Dashboard', 'Leaderboard', 'Targets'])
      expect(reports, gone).not.toContain(gone);

    const audit = labelsFor(['audit.read']);
    expect(audit).toContain('Audit');
    expect(audit).not.toContain('Privacy and consent');
  });

  it('TEST-SUBPERM-01 a sub-permission opens its screen and not a sibling screen that used to share its parent', () => {
    // finance.view opened all five finance screens; each sub-permission opens one.
    const finance = ['Commission', 'Payouts', 'Ledger', 'Invoices', 'Reconciliation'];
    for (const [sub, screen] of [
      ['commission.view', 'Commission'],
      ['payout.view', 'Payouts'],
      ['ledger.view', 'Ledger'],
      ['invoice.view', 'Invoices'],
      ['reconciliation.view', 'Reconciliation'],
    ] as const) {
      const shown = labelsFor([sub]);
      expect(shown, sub).toContain(screen);
      for (const other of finance.filter((f) => f !== screen))
        expect(shown, `${sub} must not open ${other}`).not.toContain(other);
    }
    // report.read opened Performance, Leaderboard, Targets and Reports; performance.read opens the first two only.
    const performance = labelsFor(['performance.read']);
    expect(performance).toEqual(expect.arrayContaining(['Performance Dashboard', 'Leaderboard']));
    expect(performance).not.toContain('Targets');
    expect(performance).not.toContain('Reports & Catalogue');
  });
});

describe('roles after the role matrix is applied (Notion Roles §6)', () => {
  it('TEST-SUBPERM-02 a Commission Approver sees Commission, Payouts and Approvals, not Ledger, Invoices or Reconciliation', () => {
    const shown = labelsFor([
      'commission.view',
      'payout.view',
      'commission.plan.approve',
      'payout.approve',
      'payout.record_payment',
      'adjustment.approve',
    ]);
    expect(shown).toEqual(expect.arrayContaining(['Commission', 'Payouts', 'Approvals']));
    for (const hidden of ['Ledger', 'Invoices', 'Reconciliation', 'Leads', 'Applications', 'Lender cases'])
      expect(shown, hidden).not.toContain(hidden);
  });

  it('TEST-SUBPERM-02 a Finance Executive sees the five finance screens and nothing of origination', () => {
    const shown = labelsFor([
      'commission.view',
      'payout.view',
      'ledger.view',
      'reconciliation.view',
      'invoice.view',
      'payout.request',
      'finance.reconcile',
      'invoice.manage',
    ]);
    expect(shown).toEqual(
      expect.arrayContaining(['Commission', 'Payouts', 'Ledger', 'Reconciliation', 'Invoices']),
    );
    for (const hidden of [
      'Leads',
      'Applications',
      'Lender cases',
      'Documents',
      'Verification',
      'Privacy and consent',
    ])
      expect(shown, hidden).not.toContain(hidden);
  });

  it('TEST-SUBPERM-02 a Branch Manager sees performance, targets and workforce, and no finance, lender case or privacy screen', () => {
    const shown = labelsFor([
      'lead.read',
      'lead.assign',
      'application.read',
      'task.read',
      'activity.read',
      'attendance.read',
      'performance.read',
      'target.read',
      'team.manage',
      'user.read',
      'eligibility.read',
    ]);
    expect(shown).toEqual(
      expect.arrayContaining([
        'Leads',
        'Applications',
        'Tasks',
        'Activity',
        'Workforce',
        'Performance Dashboard',
        'Targets',
      ]),
    );
    for (const hidden of [
      'Commission',
      'Payouts',
      'Ledger',
      'Invoices',
      'Lender cases',
      'Privacy and consent',
      'Documents',
    ])
      expect(shown, hidden).not.toContain(hidden);
  });

  it('TEST-SUBPERM-02 a Sales Executive sees leads, customers, tasks and activity, and no application or lender case screen', () => {
    const shown = labelsFor([
      'lead.read',
      'lead.create',
      'lead.update',
      'customer.read',
      'task.read',
      'task.update',
      'activity.read',
      'activity.create',
    ]);
    expect(shown).toEqual(expect.arrayContaining(['Leads', 'Customers', 'Tasks', 'Activity']));
    for (const hidden of [
      'Applications',
      'Lender cases',
      'Documents',
      'Privacy and consent',
      'Workforce',
      'Lenders',
    ])
      expect(shown, hidden).not.toContain(hidden);
  });

  it('TEST-SUBPERM-02 a Loan Operations user sees lender cases, sanctions and documents, and no finance screen', () => {
    const shown = labelsFor([
      'application.read',
      'application.review',
      'lender_case.read',
      'lender_case.submit',
      'sanction.read',
      'sanction.record',
      'disbursement.read',
      'disbursement.record',
      'eligibility.read',
      'document.review',
      'document.waive',
    ]);
    expect(shown).toEqual(
      expect.arrayContaining([
        'Applications',
        'Lender cases',
        'Sanction and disbursement',
        'Eligibility',
        'Documents',
      ]),
    );
    for (const hidden of [
      'Commission',
      'Payouts',
      'Ledger',
      'Invoices',
      'Reconciliation',
      'Privacy and consent',
    ])
      expect(shown, hidden).not.toContain(hidden);
  });

  it('TEST-SUBPERM-02 a Compliance officer sees privacy, security and audit, and no lender case or finance screen', () => {
    const shown = labelsFor([
      'audit.read',
      'audit.export_evidence',
      'privacy.read',
      'security.read',
      'customer.read',
      'complaint.read',
    ]);
    expect(shown).toEqual(
      expect.arrayContaining(['Audit', 'Privacy and consent', 'Security events and incidents', 'Grievances']),
    );
    for (const hidden of ['Lender cases', 'Commission', 'Ledger', 'Documents', 'Applications'])
      expect(shown, hidden).not.toContain(hidden);
  });
});

describe('verification screens', () => {
  it('TEST-SUBPERM-03 the workbench needs verification.read and verification.perform together; the list needs read', () => {
    expect(labelsFor(['verification.read'])).toContain('Verification');
    expect(labelsFor(['verification.read'])).not.toContain('Verification workbench');
    // perform alone opens neither: both lists answer 403 without verification.read.
    expect(labelsFor(['verification.perform'])).not.toContain('Verification');
    expect(labelsFor(['verification.perform'])).not.toContain('Verification workbench');
    expect(labelsFor(['verification.read', 'verification.perform'])).toEqual(
      expect.arrayContaining(['Verification', 'Verification workbench']),
    );
    const can = (c: string) => ['verification.read', 'verification.perform'].includes(c);
    expect(routeAllowed('/verifications/workbench', can, false)).toBe(true);
    expect(routeAllowed('/verifications/workbench', (c) => c === 'verification.read', false)).toBe(false);
  });
});

describe('tenant module entitlements', () => {
  it('TEST-SUBPERM-04 a screen of a module the tenant has switched off is neither shown nor opened', () => {
    const held = ['verification.read', 'verification.perform', 'finance.view', 'document.upload'];
    const on = labelsFor(held);
    expect(on).toEqual(
      expect.arrayContaining([
        'Verification',
        'Verification workbench',
        'Commission',
        'Ledger',
        'Document sharing',
      ]),
    );

    const off = labelsFor(held, { disabledModules: ['MOD-VER', 'MOD-COM', 'MOD-DSH'] });
    for (const gone of ['Verification', 'Verification workbench', 'Commission', 'Document sharing'])
      expect(off, gone).not.toContain(gone);
    // The ledger is not a gated module, so it stays.
    expect(off).toContain('Ledger');

    const can = (c: string) => held.includes(c);
    expect(routeAllowed('/verifications', can, false, [])).toBe(true);
    expect(routeAllowed('/verifications', can, false, ['MOD-VER'])).toBe(false);
    expect(routeAllowed('/verifications/workbench', can, false, ['MOD-VER'])).toBe(false);
    expect(routeAllowed('/ledger', can, false, ['MOD-VER'])).toBe(true);
  });

  it('TEST-SUBPERM-04 search and the route guard agree with the sidebar on a switched-off module', () => {
    const held = new Set(['verification.read', 'verification.perform']);
    const can = (c: string) => held.has(c);
    const found = (disabled: string[]) =>
      getSearchableItems(false, can, false, false, disabled).map((i) => i.to);
    expect(found([])).toContain('/verifications');
    expect(found(['MOD-VER'])).not.toContain('/verifications');
    expect(found(['MOD-VER'])).not.toContain('/verifications/workbench');
  });
});

describe('connector portal logins', () => {
  it('TEST-SUBPERM-05 a connector login is offered its own portal and nothing else, even when a module is switched off', () => {
    expect(labelsFor([], { connectorLogin: true })).toEqual(['Connector Portal']);
    expect(labelsFor([], { connectorLogin: true, disabledModules: ['MOD-CPT'] })).toEqual([
      'Connector Portal',
    ]);
    const found = getSearchableItems(false, () => false, false, true).map((i) => i.to);
    expect(found).toEqual(['/connector-portal']);
  });

  it('TEST-SUBPERM-05 staff never see the connector portal, even with connector.read', () => {
    expect(labelsFor(['connector.read', 'connector.manage'])).not.toContain('Connector portal');
    expect(labelsFor(['connector.read'])).toContain('Connectors');
    expect(routeAllowed('/connector-portal', () => true, false)).toBe(false);
  });
});

describe('the rules use only real permission codes', () => {
  const catalogue = new Set<string>(PERMISSION_CODES);
  const named = (rule: { anyOf?: string[]; allOf?: string[] }) => [
    ...(rule.anyOf ?? []),
    ...(rule.allOf ?? []),
  ];

  it('TEST-SUBPERM-06 every code in the sidebar and route rules is in the permission catalogue', () => {
    const unknown = [
      ...NAV_GROUPS.flatMap((g) => g.items).flatMap(named),
      ...EXTRA_ROUTE_RULES.flatMap(named),
    ].filter((c) => !catalogue.has(c));
    expect([...new Set(unknown)]).toEqual([]);
  });

  it('TEST-SUBPERM-06 every code an action rule names is in the permission catalogue (lead.convert and user.read were not)', () => {
    const unknown = Object.values(ACTION_RULES)
      .flat()
      .filter((c) => !catalogue.has(c));
    expect([...new Set(unknown)]).toEqual([]);
  });

  it('TEST-SUBPERM-06 holding document.review no longer shows the verification-perform buttons, and the reverse', () => {
    const only = (code: string) => (c: string) => c === code;
    expect(ACTION_RULES['verification.perform']).not.toContain('document.review');
    expect(ACTION_RULES['document.review']).not.toContain('verification.perform');
    expect(only('document.review')('verification.perform')).toBe(false);
  });
});
