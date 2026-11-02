// The API gates added by the sub-permission split (owner: Dev 1; migration M-098). For each route: the new code opens it, the older code
// that opened it before the split still does (transition), and a broad or sibling permission does not. A refused call is a 403 before any
// work; an allowed call gets past the permission check (it then meets the empty database stub and fails differently, which is the point:
// anything but 403 proves the gate let it through).
import type { PermissionCode, RequestContext, Tx, TxRunner } from '@dsa/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestApp, fakeAuth, testPrincipal } from './support/fake-auth';

const stubTx: TxRunner = {
  async withTenantTx<T>(_ctx: RequestContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return fn({} as Tx);
  },
};

const appFor = (...codes: PermissionCode[]) =>
  createTestApp({
    auth: fakeAuth(
      testPrincipal({ grants: codes.map((code) => ({ code, scope: 'TENANT' as const, branchIds: [] })) }),
    ),
    deps: { txRunner: stubTx },
  });

type Method = 'get' | 'post';
interface Gate {
  /** What the gate protects, for the test name. */
  name: string;
  method: Method;
  path: string;
  /** Each of these, alone, must get past the gate. */
  opens: PermissionCode[];
  /** Each of these, alone, must be refused with 403. */
  refuses: PermissionCode[];
  /** A valid request, for routes that validate the headers and body before they reach the permission check. */
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
}

const IDEM = { 'Idempotency-Key': 'sub-permission-gate-test' };

const GATES: Gate[] = [
  // Security
  {
    name: 'security events (read)',
    method: 'get',
    path: '/v1/security/events',
    opens: ['security.read', 'security.incident'],
    refuses: ['lead.read', 'audit.read', 'privacy.read'],
  },
  {
    name: 'incidents (read)',
    method: 'get',
    path: '/v1/incidents',
    opens: ['security.read', 'security.incident'],
    refuses: ['lead.read', 'audit.read'],
  },
  {
    name: 'filing a security event stays security.incident',
    method: 'post',
    path: '/v1/security/events',
    opens: ['security.incident'],
    refuses: ['security.read'],
  },

  // Platform: roles and permissions are read with role.read, written with role.manage / user.manage
  {
    name: 'roles (read)',
    method: 'get',
    path: '/v1/roles',
    opens: ['role.read', 'role.manage', 'user.manage'],
    refuses: ['customer.read', 'lead.read', 'user.read'],
  },
  {
    name: 'permission catalogue (read)',
    method: 'get',
    path: '/v1/permissions',
    opens: ['role.read', 'role.manage', 'user.manage'],
    refuses: ['customer.read', 'user.read'],
  },
  {
    name: 'creating a role is not a read',
    method: 'post',
    path: '/v1/roles',
    opens: ['role.manage', 'user.manage'],
    refuses: ['role.read'],
  },
  {
    name: 'branches (create)',
    method: 'post',
    path: '/v1/branches',
    opens: ['org.manage', 'config.manage'],
    refuses: ['user.manage', 'settings.manage', 'team.manage'],
  },
  {
    name: 'tenant configuration (read)',
    method: 'get',
    path: '/v1/config',
    opens: ['settings.manage', 'config.manage'],
    refuses: ['org.manage', 'user.manage'],
  },
  {
    name: 'organisation profile (read)',
    method: 'get',
    path: '/v1/organisations',
    opens: ['org.manage', 'config.manage'],
    refuses: ['settings.manage', 'user.manage'],
  },
  {
    name: 'staff invitations',
    method: 'post',
    path: '/v1/users/invitations',
    opens: ['user.invite', 'user.manage'],
    refuses: ['user.offboard', 'role.manage', 'user.read'],
  },
  {
    name: 'user deactivation',
    method: 'post',
    path: '/v1/users/usr_x/deactivation',
    opens: ['user.offboard', 'user.manage'],
    refuses: ['user.invite', 'user.read'],
  },
  {
    name: 'access reviews (start)',
    method: 'post',
    path: '/v1/access-reviews',
    opens: ['access_review.manage', 'user.manage'],
    refuses: ['role.manage', 'user.invite'],
  },

  // Messaging templates
  {
    name: 'message templates (create)',
    method: 'post',
    path: '/v1/message-templates',
    opens: ['message_template.manage', 'config.manage'],
    refuses: ['message.send', 'settings.manage'],
  },

  // Targets: report.read no longer opens them
  {
    name: 'targets (read)',
    method: 'get',
    path: '/v1/targets',
    opens: ['target.read', 'target.manage'],
    refuses: ['report.read', 'performance.read', 'lead.read'],
  },
  {
    name: 'team performance dashboard',
    method: 'get',
    path: '/v1/dashboards/TEAM_PERFORMANCE',
    opens: ['performance.read', 'report.manage', 'config.manage'],
    refuses: ['report.read', 'target.read', 'lead.read'],
  },
  {
    name: 'leaderboard dashboard',
    method: 'get',
    path: '/v1/dashboards/leaderboard',
    opens: ['performance.read', 'report.manage', 'config.manage'],
    refuses: ['report.read', 'target.read', 'lead.read'],
  },
  {
    name: 'executive dashboard stays report.read',
    method: 'get',
    path: '/v1/dashboards/EXECUTIVE',
    opens: ['report.read', 'report.manage', 'config.manage'],
    refuses: ['performance.read', 'target.read', 'lead.read'],
  },

  // Connectors
  {
    name: 'connector bank accounts (create)',
    method: 'post',
    path: '/v1/connectors/con_1/bank-accounts',
    headers: IDEM,
    body: { accountHolderName: 'Test Connector', accountNumber: '000011112222', ifscCode: 'TEST0000001' },
    opens: ['connector.bank_account_manage', 'connector.manage'],
    refuses: ['connector.agreement_manage', 'connector.portal_user_manage', 'connector.bank_change_approve'],
  },
  {
    name: 'connector agreements (create)',
    method: 'post',
    path: '/v1/connectors/con_1/agreements',
    headers: IDEM,
    body: {
      validFrom: '2026-01-01T00:00:00.000Z',
      validTo: '2027-01-01T00:00:00.000Z',
      permittedProducts: ['PL'],
      shareRuleScope: 'ALL',
      evidenceRef: 'ref-001',
    },
    opens: ['connector.agreement_manage', 'connector.manage'],
    refuses: ['connector.bank_account_manage', 'connector.portal_user_manage'],
  },
  {
    name: 'connector agreements (read)',
    method: 'get',
    path: '/v1/connectors/con_1/agreements',
    opens: ['connector.agreement_manage', 'connector.manage'],
    refuses: ['connector.read', 'connector.bank_account_manage'],
  },
  {
    name: 'connector portal users (invite)',
    method: 'post',
    path: '/v1/connectors/con_1/users',
    headers: IDEM,
    body: { email: 'portal.user@example.test', displayName: 'Portal User' },
    opens: ['connector.portal_user_manage', 'connector.manage'],
    refuses: ['connector.agreement_manage', 'connector.bank_account_manage'],
  },
  {
    name: 'connector portal users (list)',
    method: 'get',
    path: '/v1/connectors/con_1/users',
    opens: ['connector.portal_user_manage', 'connector.manage'],
    refuses: ['connector.read', 'connector.agreement_manage'],
  },

  // Imports: import.read is view-only
  {
    name: 'import batches (list)',
    method: 'get',
    path: '/v1/imports',
    opens: ['import.read', 'import.run', 'config.manage', 'customer.create'],
    refuses: ['lead.read', 'application.read', 'report.read'],
  },
  {
    name: 'starting an import is not a read',
    method: 'post',
    path: '/v1/imports',
    body: { targetEntity: 'CUSTOMER', filename: 'customers.csv' },
    opens: ['import.run', 'config.manage'],
    refuses: ['import.read'],
  },

  // Finance
  {
    name: 'payout requests (list)',
    method: 'get',
    path: '/v1/payout-requests',
    opens: ['payout.view', 'finance.view'],
    refuses: ['lead.read', 'commission.view', 'ledger.view', 'invoice.view'],
  },
  {
    name: 'payout batches (create)',
    method: 'post',
    path: '/v1/payout-batches',
    opens: ['payout.disburse', 'payout.record_payment'],
    refuses: ['payout.view', 'finance.view', 'payout.request'],
  },
  {
    name: 'commission plans (list)',
    method: 'get',
    path: '/v1/commission-plans',
    opens: ['commission.view', 'finance.view', 'commission.plan.edit'],
    refuses: ['lead.read', 'payout.view', 'ledger.view'],
  },
  {
    name: 'ledger journals (list)',
    method: 'get',
    path: '/v1/ledger/journals',
    opens: ['ledger.view', 'finance.view'],
    refuses: ['commission.view', 'payout.view', 'invoice.view'],
  },
  {
    name: 'lender statements (list)',
    method: 'get',
    path: '/v1/lender-statements',
    opens: ['reconciliation.view', 'finance.view'],
    refuses: ['ledger.view', 'commission.view', 'invoice.view'],
  },
  {
    name: 'invoices (list)',
    method: 'get',
    path: '/v1/invoices',
    opens: ['invoice.view', 'finance.view', 'invoice.manage'],
    refuses: ['ledger.view', 'commission.view', 'payout.view'],
  },

  // Origination
  {
    name: 'lender cases (list)',
    method: 'get',
    path: '/v1/lender-cases',
    opens: ['lender_case.read', 'lender_case.submit'],
    refuses: ['application.read', 'customer.read', 'sanction.read'],
  },
  {
    name: 'sanctions (list)',
    method: 'get',
    path: '/v1/sanctions',
    opens: ['sanction.read', 'sanction.record'],
    refuses: ['application.read', 'disbursement.read', 'lender_case.read'],
  },
  {
    name: 'disbursements (list)',
    method: 'get',
    path: '/v1/disbursements',
    opens: ['disbursement.read', 'disbursement.verify'],
    refuses: ['application.read', 'sanction.read'],
  },
  {
    name: 'eligibility assessments (read)',
    method: 'get',
    path: '/v1/applications/app_1/eligibility-assessments',
    opens: ['eligibility.read'],
    refuses: ['application.read', 'lender_case.read', 'customer.read'],
  },

  // Privacy
  {
    name: 'privacy data-sharing register',
    method: 'get',
    path: '/v1/compliance/data-sharing-records',
    opens: ['privacy.read', 'privacy.manage'],
    refuses: ['audit.read', 'customer.read'],
  },

  // Audit
  {
    name: 'sealing the audit chain',
    method: 'post',
    path: '/v1/audit-chain/seal',
    opens: ['audit.seal'],
    refuses: ['audit.read', 'config.manage'],
  },
];

/** Call the gate's route as a caller holding only these codes. */
const callAs = (gate: Gate, ...codes: PermissionCode[]) => {
  const req = request(appFor(...codes))[gate.method](gate.path);
  return req.set(gate.headers ?? {}).send(gate.body ?? {});
};

describe('API gates for the sub-permissions', () => {
  for (const gate of GATES) {
    for (const code of gate.opens) {
      it(`TEST-SUBGATE ${gate.name}: ${code} alone gets past the gate`, async () => {
        const res = await callAs(gate, code);
        expect(
          res.status,
          `${gate.method.toUpperCase()} ${gate.path} with ${code}: ${JSON.stringify(res.body?.error ?? res.body)}`,
        ).not.toBe(403);
      });
    }
    for (const code of gate.refuses) {
      it(`TEST-SUBGATE ${gate.name}: ${code} alone is refused with 403`, async () => {
        const res = await callAs(gate, code);
        expect(
          res.status,
          `${gate.method.toUpperCase()} ${gate.path} with ${code}: ${JSON.stringify(res.body?.error ?? res.body)}`,
        ).toBe(403);
      });
    }
    it(`TEST-SUBGATE ${gate.name}: a caller with no permission is refused with 403`, async () => {
      const res = await callAs(gate);
      expect(res.status).toBe(403);
    });
  }
});
