// What each role sees in the sidebar, using the grants those roles hold on the shared hosted project (demo-alpha tenant, read 2026-10-17).
// A role must see the screens its work needs and none whose API would answer 403 (owner: Dev 1; spec: role catalogue, DSA Notion).
import { describe, expect, it } from 'vitest';
import { visibleGroups } from './Sidebar';

const HOSTED_GRANTS: Record<string, string[]> = {
  'ROLE-RULE-AUTHOR': ['rule.author', 'rule.simulate'],
  'ROLE-RULE-APPROVER': ['rule.approve', 'rule.publish', 'rule.simulate', 'rule.suspend'],
  'ROLE-FINANCE-EXEC': [
    'adjustment.create',
    'finance.dispute',
    'finance.reconcile',
    'finance.view',
    'invoice.manage',
  ],
  'ROLE-COMMISSION-APPROVER': [
    'adjustment.approve',
    'finance.view',
    'payout.approve',
    'payout.record_payment',
  ],
  'ROLE-DOC-VERIFIER': [
    'application.read',
    'document.review',
    'verification.complete',
    'verification.create',
    'verification.perform',
    'verification.read',
    'verification.update',
  ],
  'ROLE-SALES-EXEC': [
    'activity.create',
    'consent.record',
    'customer.read',
    'lead.create',
    'lead.qualify',
    'lead.read',
    'lead.update',
    'message.send',
    'task.read',
    'task.update',
  ],
  'ROLE-RM': [
    'activity.create',
    'application.cancel',
    'application.create',
    'application.read',
    'application.update',
    'consent.record',
    'customer.create',
    'customer.read',
    'customer.update',
    'lead.create',
    'lead.qualify',
    'lead.read',
    'lead.update',
    'message.send',
    'task.create',
    'task.read',
    'task.update',
    'verification.read',
  ],
  'ROLE-COMPLIANCE': [
    'application.read',
    'audit.export_evidence',
    'audit.read',
    'customer.read',
    'lead.read',
    'verification.read',
  ],
  'ROLE-LOAN-OPS': [
    'application.read',
    'application.review',
    'application.update',
    'automation.execute',
    'automation.read',
    'connector.attribution_change',
    'connector.dispute_resolve',
    'connector.manage',
    'connector.read',
    'data_correction.request',
    'document.review',
    'document.upload',
    'lender_case.submit',
    'lender_case.update_status',
    'message.send',
    'share.create',
    'task.read',
    'task.update',
    'verification.perform',
    'verification.read',
  ],
};

const screens = (role: string) => {
  const held = new Set(HOSTED_GRANTS[role]);
  return visibleGroups(false, (c) => held.has(c))
    .flatMap((g) => g.items)
    .filter((i) => i.to)
    .map((i) => i.label);
};

const EXPECT: Record<string, { sees: string[]; hidden: string[] }> = {
  'ROLE-RULE-AUTHOR': {
    sees: ['Rule sets', 'Decisions'],
    hidden: [
      'Leads',
      'Customers',
      'Applications',
      'Commission',
      'Payouts',
      'Reconciliation',
      'Invoices',
      'Audit',
      'Automation rules',
    ],
  },
  'ROLE-RULE-APPROVER': {
    sees: ['Rule sets', 'Decisions'],
    hidden: [
      'Leads',
      'Customers',
      'Applications',
      'Commission',
      'Payouts',
      'Reconciliation',
      'Invoices',
      'Audit',
    ],
  },
  'ROLE-FINANCE-EXEC': {
    sees: ['Commission', 'Ledger', 'Payouts', 'Reconciliation', 'Invoices'],
    hidden: ['Leads', 'Customers', 'Applications', 'Rule sets', 'Verification', 'Audit'],
  },
  'ROLE-COMMISSION-APPROVER': {
    // Approvals: the finance checker's queue (QA plan Module 13B, "open /approvals").
    sees: ['Commission', 'Ledger', 'Payouts', 'Approvals'],
    hidden: ['Leads', 'Customers', 'Applications', 'Rule sets', 'Verification'],
  },
  'ROLE-DOC-VERIFIER': {
    sees: ['Documents', 'Verification', 'Verification workbench', 'Applications'],
    hidden: [
      'Leads',
      'Customers',
      'Commission',
      'Payouts',
      'Invoices',
      'Reconciliation',
      'Automation rules',
      'Rule sets',
    ],
  },
  'ROLE-SALES-EXEC': {
    sees: ['Leads', 'Customers', 'Tasks'],
    hidden: [
      'Applications',
      'Lender cases',
      'Commission',
      'Payouts',
      'Invoices',
      'Reconciliation',
      'Rule sets',
    ],
  },
  'ROLE-RM': {
    sees: ['Leads', 'Customers', 'Applications', 'Documents', 'Tasks'],
    hidden: ['Commission', 'Payouts', 'Invoices', 'Reconciliation', 'Automation rules', 'Rule sets', 'Audit'],
  },
  'ROLE-COMPLIANCE': {
    sees: ['Audit', 'Privacy and consent', 'Applications'],
    hidden: ['Commission', 'Payouts', 'Invoices', 'Reconciliation', 'Rule sets', 'Automation rules'],
  },
  'ROLE-LOAN-OPS': {
    sees: ['Applications', 'Lender cases', 'Documents', 'Document sharing', 'Verification'],
    hidden: ['Commission', 'Payouts', 'Invoices', 'Reconciliation', 'Rule sets', 'Audit'],
  },
};

describe('what each role sees in the sidebar', () => {
  for (const [role, want] of Object.entries(EXPECT)) {
    it(`TEST-ROLENAV ${role} sees its working screens and none of the screens its API would refuse`, () => {
      const shown = screens(role);
      for (const s of want.sees) expect(shown, `${role} should see ${s}`).toContain(s);
      for (const s of want.hidden) expect(shown, `${role} should not see ${s}`).not.toContain(s);
    });
  }
});
