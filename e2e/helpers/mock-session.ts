import type { Page } from '@playwright/test';

export interface PersonaConfig {
  userId: string;
  email: string;
  displayName: string;
  roleCode: string;
  permissions: string[];
  primaryBranchId?: string;
}

export const PERSONAS: Record<string, PersonaConfig> = {
  // 06 — Relationship Manager
  rm: {
    userId: 'usr_rm_01',
    email: 'rm1@alpha.com',
    displayName: 'Riya RM',
    roleCode: 'ROLE-RM',
    permissions: [
      'lead.read',
      'lead.create',
      'lead.update',
      'lead.qualify',
      'customer.create',
      'customer.read',
      'consent.record',
      'application.create',
      'application.update',
      'task.read',
      'task.create',
      'task.update',
      'activity.create',
    ],
    primaryBranchId: 'MUM01',
  },
  // 07 — Sales Executive
  salesExec: {
    userId: 'usr_sales_01',
    email: 'sales1@alpha.com',
    displayName: 'Sameer Sales',
    roleCode: 'ROLE-SALES-EXEC',
    permissions: [
      'lead.create',
      'lead.read',
      'lead.update',
      'task.read',
      'task.update',
      'activity.create',
    ],
    primaryBranchId: 'MUM01',
  },
  // 08 — Loan Operations
  loanOps: {
    userId: 'usr_loanops_01',
    email: 'loanops@alpha.com',
    displayName: 'Lata Loan Ops',
    roleCode: 'ROLE-LOAN-OPS',
    permissions: [
      'application.read',
      'application.review',
      'lender_case.submit',
      'lender_case.update_status',
      'sanction.record',
      'disbursement.record',
    ],
    primaryBranchId: 'MUM01',
  },
  // 09 — Document Verifier
  docVerifier: {
    userId: 'usr_verifier_01',
    email: 'verifier@alpha.com',
    displayName: 'Vikas Verifier',
    roleCode: 'ROLE-DOC-VERIFIER',
    permissions: [
      'verification.read',
      'verification.perform',
      'verification.create',
      'verification.complete',
      'document.review',
      'application.read',
    ],
    primaryBranchId: 'MUM01',
  },
  // 10 — Compliance Officer
  compliance: {
    userId: 'usr_compliance_01',
    email: 'compliance@alpha.com',
    displayName: 'Chetan Compliance',
    roleCode: 'ROLE-COMPLIANCE',
    permissions: [
      'audit.read',
      'audit.export_evidence',
      'customer.read',
      'security.incident',
      'security.vuln',
      'report.read',
      'privacy.manage',
    ],
    primaryBranchId: 'MUM01',
  },
  // 11 — Rule Author
  ruleAuthor: {
    userId: 'usr_ruleauthor_01',
    email: 'ruleauthor@alpha.com',
    displayName: 'Rekha Author',
    roleCode: 'ROLE-RULE-AUTHOR',
    permissions: ['rule.author', 'rule.simulate'],
    primaryBranchId: 'MUM01',
  },
  // 12 — Rule Approver
  ruleApprover: {
    userId: 'usr_ruleapprover_01',
    email: 'ruleapprover@alpha.com',
    displayName: 'Ravi Approver',
    roleCode: 'ROLE-RULE-APPROVER',
    permissions: ['rule.approve', 'rule.publish', 'rule.suspend', 'rule.simulate'],
    primaryBranchId: 'MUM01',
  },
  // 13 — Finance Executive
  financeExec: {
    userId: 'usr_finance_01',
    email: 'finance@alpha.com',
    displayName: 'Farhan Finance',
    roleCode: 'ROLE-FINANCE-EXEC',
    permissions: ['finance.view', 'finance.reconcile', 'payout.request', 'adjustment.create'],
    primaryBranchId: 'MUM01',
  },
  // 13 — Commission Approver
  commissionApprover: {
    userId: 'usr_cfo_01',
    email: 'cfo@alpha.com',
    displayName: 'Charu Approver',
    roleCode: 'ROLE-COMMISSION-APPROVER',
    permissions: [
      'finance.view',
      'commission.plan.approve',
      'payout.approve',
      'payout.record_payment',
      'adjustment.approve',
    ],
    primaryBranchId: 'MUM01',
  },
};

function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function createMockJwt(persona: PersonaConfig, aal: 'aal1' | 'aal2' = 'aal2'): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: persona.userId,
    role: 'authenticated',
    aud: 'authenticated',
    email: persona.email,
    exp: now + 86400,
    iat: now,
    aal,
    amr: [
      { method: 'password', timestamp: now },
      ...(aal === 'aal2' ? [{ method: 'totp', timestamp: now }] : []),
    ],
    app_metadata: { tenant_id: 'ten_alpha' },
    user_metadata: { display_name: persona.displayName },
  };

  return `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(
    JSON.stringify(payload),
  )}.mock-signature`;
}

export async function setupPersonaSession(page: Page, persona: PersonaConfig, aal: 'aal1' | 'aal2' = 'aal2') {
  const token = createMockJwt(persona, aal);
  const sessionData = {
    access_token: token,
    token_type: 'bearer',
    expires_in: 86400,
    expires_at: Math.floor(Date.now() / 1000) + 86400,
    refresh_token: 'mock-refresh-token',
    user: {
      id: persona.userId,
      aud: 'authenticated',
      role: 'authenticated',
      email: persona.email,
      app_metadata: { tenant_id: 'ten_alpha' },
      user_metadata: { display_name: persona.displayName },
      created_at: '2026-01-01T00:00:00.000Z',
    },
  };

  // Seed localStorage before page scripts mount
  await page.addInitScript(
    ({ session }) => {
      localStorage.setItem('sb-mlpkwwhnagxzinaohdxg-auth-token', JSON.stringify(session));
    },
    { session: sessionData },
  );

  // Mock Supabase Auth routes
  await page.route('**/auth/v1/user', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(sessionData.user),
    });
  });

  await page.route('**/auth/v1/factors', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        all: [{ id: 'factor_totp_1', factor_type: 'totp', status: 'verified' }],
        totp: [{ id: 'factor_totp_1', status: 'verified' }],
      }),
    });
  });

  // Mock /v1/me endpoint
  await page.route('**/v1/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: persona.userId,
        email: persona.email,
        displayName: persona.displayName,
        tenantId: 'ten_alpha',
        primaryBranchId: persona.primaryBranchId || 'MUM01',
        queueIds: ['queue_01'],
        roles: [persona.roleCode],
        grants: persona.permissions.map((p) => ({
          code: p,
          scope: 'TENANT',
          branchIds: ['MUM01'],
        })),
        mfaVerifiedAt: new Date().toISOString(),
        lockVersion: 1,
      }),
    });
  });

  // Mock /v1/tenant endpoint
  await page.route('**/v1/tenant', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'ten_alpha',
        slug: 'alpha',
        legalName: 'Alpha Finserv Private Limited',
        tenantType: 'DSA',
        dataRegion: 'ap-south-1',
        timezone: 'Asia/Kolkata',
        status: 'ACTIVE',
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    });
  });

  // Mock /v1/notifications
  await page.route('**/v1/notifications**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [], meta: { unreadCount: 0 } }),
    });
  });

  // Mock /v1/branches
  await page.route('**/v1/branches**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [
          { id: 'MUM01', code: 'MUM01', name: 'Mumbai Central' },
          { id: 'PUN01', code: 'PUN01', name: 'Pune Camp' },
        ],
      }),
    });
  });
}
