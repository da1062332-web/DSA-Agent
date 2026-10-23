import type { Page, Locator } from '@playwright/test';

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
      'customer.update',
      'customer.read',
      'consent.record',
      'application.create',
      'application.update',
      'application.read',
      'document.upload',
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
      'task.create',
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
    permissions: ['finance.view', 'finance.reconcile', 'payout.request', 'adjustment.create', 'commission.plan.edit'],
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
  return Buffer.from(str).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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

export const isHeaded = process.env.HEADED === 'true' || process.argv.includes('--headed');

export async function showDemoBanner(page: Page, title: string, subtitle?: string): Promise<void> {
  if (!isHeaded) return;
  try {
    await page.evaluate(({ title, subtitle }) => {
      let host = document.getElementById('demo-step-banner-host') as any;
      if (!host) {
        host = document.createElement('div');
        host.id = 'demo-step-banner-host';
        host.style.position = 'fixed';
        host.style.top = '12px';
        host.style.left = '50%';
        host.style.transform = 'translateX(-50%)';
        host.style.zIndex = '999999';
        host.style.pointerEvents = 'none';

        // Use closed shadow DOM so that Playwright test locators (getByText, etc.)
        // never collide with demo banner text during headed runs.
        const shadow = host.attachShadow({ mode: 'closed' });
        host._demoShadow = shadow;
        document.body.appendChild(host);
      }

      const shadow = host._demoShadow;
      if (shadow) {
        shadow.innerHTML = `
          <div style="
            background-color: rgba(15, 23, 42, 0.94);
            color: #ffffff;
            padding: 8px 18px;
            border-radius: 9999px;
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 0 15px rgba(59, 130, 246, 0.5);
            font-family: system-ui, -apple-system, sans-serif;
            font-size: 13px;
            font-weight: 600;
            border: 1px solid rgba(96, 165, 250, 0.6);
            backdrop-filter: blur(10px);
            transition: all 0.2s ease;
            display: flex;
            align-items: center;
            gap: 8px;
          ">
            <span style="background:#2563eb;color:#fff;font-size:10px;font-weight:700;padding:2px 7px;border-radius:9999px;text-transform:uppercase;letter-spacing:0.05em;">Step</span>
            <span>${title}</span>
            ${subtitle ? `<span style="color:#94a3b8;font-weight:400;">— ${subtitle}</span>` : ''}
          </div>
        `;
      }
    }, { title, subtitle });
  } catch {
    // Ignore in case page is navigating
  }
}

export async function pauseForDemo(page: Page, ms = 1400): Promise<void> {
  if (isHeaded) {
    const demoMs = Math.min(ms, 2000);
    await page.waitForTimeout(demoMs);
  }
}

async function showSpotlight(locator: Locator, action: 'click' | 'type'): Promise<void> {
  if (!isHeaded) return;
  try {
    await locator.evaluate((el: HTMLElement, { action }) => {
      // Find or create host with closed shadow DOM to prevent Playwright locator collisions
      let host = document.getElementById('demo-spotlight-host') as any;
      if (!host) {
        host = document.createElement('div');
        host.id = 'demo-spotlight-host';
        host.style.position = 'fixed';
        host.style.top = '0';
        host.style.left = '0';
        host.style.width = '0';
        host.style.height = '0';
        host.style.zIndex = '999998';
        host.style.pointerEvents = 'none';
        const shadow = host.attachShadow({ mode: 'closed' });
        host._shadow = shadow;
        document.body.appendChild(host);
      }

      const rect = el.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) return;

      // Extract a short readable label from the element (button text, placeholder, or aria-label)
      let label = (
        el.getAttribute('aria-label') ||
        el.getAttribute('placeholder') ||
        el.innerText ||
        el.getAttribute('name') ||
        el.getAttribute('data-testid') ||
        el.tagName
      ).trim().split('\n')[0].trim();
      if (label.length > 26) label = label.slice(0, 23) + '...';

      const isClick = action === 'click';
      const color = isClick ? '#f59e0b' : '#3b82f6';
      const bg = isClick ? '#b45309' : '#1d4ed8';
      const icon = isClick ? '👉 Click:' : '✍️ Fill:';

      const shadow = host._shadow;
      if (shadow) {
        shadow.innerHTML = `
          <div style="
            position: fixed;
            left: ${Math.max(0, rect.left - 4)}px;
            top: ${Math.max(0, rect.top - 4)}px;
            width: ${rect.width + 8}px;
            height: ${rect.height + 8}px;
            border-radius: 8px;
            border: 3px solid ${color};
            box-shadow: 0 0 18px 4px ${color}, inset 0 0 8px ${color};
            pointer-events: none;
            box-sizing: border-box;
            transition: all 0.15s ease-out;
          ">
            <div style="
              position: absolute;
              bottom: calc(100% + 5px);
              left: 50%;
              transform: translateX(-50%);
              background: ${bg};
              color: #ffffff;
              font-family: system-ui, -apple-system, sans-serif;
              font-size: 11px;
              font-weight: 700;
              letter-spacing: 0.02em;
              padding: 3px 8px;
              border-radius: 6px;
              box-shadow: 0 4px 12px rgba(0,0,0,0.5);
              white-space: nowrap;
              border: 1px solid rgba(255,255,255,0.4);
            ">
              ${icon} ${label}
            </div>
            ${isClick ? `
            <div style="
              position: absolute;
              top: 50%;
              left: 50%;
              transform: translate(-50%, -50%);
              width: 14px;
              height: 14px;
              border-radius: 50%;
              background: #ef4444;
              border: 2px solid #ffffff;
              box-shadow: 0 0 12px 4px #ef4444;
              pointer-events: none;
            "></div>
            ` : ''}
          </div>
        `;
      }
    }, { action });
  } catch {
    // Ignore in case element is navigating or unmounted
  }
}

async function clearSpotlight(locator: Locator): Promise<void> {
  if (!isHeaded) return;
  try {
    await locator.page().evaluate(() => {
      const host = document.getElementById('demo-spotlight-host') as any;
      if (host?._shadow) {
        host._shadow.innerHTML = '';
      }
    });
  } catch {}
}

export async function humanType(locator: Locator, text: string, charDelay = 30): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  if (isHeaded) {
    await showSpotlight(locator, 'type');
    await locator.page().waitForTimeout(200);
    await clearSpotlight(locator);
  }
  await locator.click();
  await locator.fill('');
  await locator.pressSequentially(text, { delay: charDelay });
  if (isHeaded) {
    await locator.page().waitForTimeout(300);
  }
}

export async function humanClick(locator: Locator, pauseAfter = 400): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  if (isHeaded) {
    await showSpotlight(locator, 'click');
    await locator.hover();
    await locator.page().waitForTimeout(380); // Clear visual pause so observer registers the target
    await clearSpotlight(locator);
  }
  await locator.click();
  if (isHeaded) {
    const tunedPause = Math.min(pauseAfter, 600);
    await locator.page().waitForTimeout(tunedPause);
  }
}
