import type { Page, Locator } from '@playwright/test';

export interface PersonaConfig {
  userId: string;
  email: string;
  displayName: string;
  roleCode: string;
  permissions: string[];
  primaryBranchId?: string;
  tenantId?: string;
}

export const PERSONAS: Record<string, PersonaConfig> = {
  // 01 — Platform Super Admin
  platformSuperAdmin: {
    userId: 'usr_platform_admin_01',
    email: 'vaibhav.qloax@gmail.com',
    displayName: 'Vaibhav Super Admin',
    roleCode: 'ROLE-PLATFORM-ADMIN',
    permissions: [
      'platform.console',
      'platform.flags',
      'platform.jobs',
      'platform.master_data',
      'platform.release',
      'platform.support_access',
      'platform.tenant.create',
      'platform.tenant.entitlements',
      'platform.tenant.offboard',
      'platform.tenant.suspend',
      'user.manage',
    ],
    tenantId: 'ten_01M4ZG67WTS51Q0XN7F1Y9CCYG',
  },
  // 02 — Tenant Admin
  tenantAdmin: {
    userId: 'usr_admin_01',
    email: 'admin@qloax.com',
    displayName: 'Asha Admin',
    roleCode: 'ROLE-TENANT-ADMIN',
    permissions: [
      'user.manage',
      'role.manage',
      'config.manage',
      'lead.read',
      'lead.create',
      'application.read',
      'finance.view',
      'report.read',
      'audit.read',
    ],
    primaryBranchId: 'MUM01',
  },
  // 03 — Organisation Owner
  orgOwner: {
    userId: 'usr_owner_01',
    email: 'owner@qloax.com',
    displayName: 'Omkar Owner',
    roleCode: 'ROLE-ORG-OWNER',
    permissions: [
      'lead.read',
      'application.read',
      'connector.read',
      'connector.manage',
      'finance.view',
      'payout.approve',
      'invoice.manage',
      'commission.calculate',
      'report.read',
      'audit.read',
    ],
    primaryBranchId: 'MUM01',
  },
  // 04 — Branch Manager
  branchMgr: {
    userId: 'usr_branchmgr_01',
    email: 'branchmgr@qloax.com',
    displayName: 'Bhavna Branch Mgr',
    roleCode: 'ROLE-BRANCH-MGR',
    permissions: [
      'lead.read',
      'lead.assign',
      'application.read',
      'application.assign',
      'task.read',
      'task.assign',
      'task.create',
      'task.update',
      'activity.create',
      'activity.update',
      'report.read',
      'rule.simulate',
      'connector.read',
      'complaint.manage',
    ],
    primaryBranchId: 'MUM01',
  },
  // 05 — Team Manager
  teamMgr: {
    userId: 'usr_teammgr_01',
    email: 'teammgr@qloax.com',
    displayName: 'Tarun Team Mgr',
    roleCode: 'ROLE-TEAM-MGR',
    permissions: [
      'lead.read',
      'lead.assign',
      'application.read',
      'task.read',
      'task.assign',
      'task.create',
      'task.update',
      'activity.create',
      'report.read',
    ],
    primaryBranchId: 'MUM01',
  },
  // 06 — Relationship Manager
  rm: {
    userId: 'usr_rm_01',
    email: 'rm@qloax.com',
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
    email: 'sales@qloax.com',
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
    email: 'loanops@qloax.com',
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
    email: 'verifier@qloax.com',
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
    email: 'compliance@qloax.com',
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
    email: 'ruleauthor@qloax.com',
    displayName: 'Rekha Author',
    roleCode: 'ROLE-RULE-AUTHOR',
    permissions: ['rule.author', 'rule.simulate'],
    primaryBranchId: 'MUM01',
  },
  // 12 — Rule Approver
  ruleApprover: {
    userId: 'usr_ruleapprover_01',
    email: 'ruleapprover@qloax.com',
    displayName: 'Ravi Approver',
    roleCode: 'ROLE-RULE-APPROVER',
    permissions: ['rule.approve', 'rule.publish', 'rule.suspend', 'rule.simulate'],
    primaryBranchId: 'MUM01',
  },
  // 13 — Finance Executive
  financeExec: {
    userId: 'usr_finance_01',
    email: 'finance@qloax.com',
    displayName: 'Farhan Finance',
    roleCode: 'ROLE-FINANCE-EXEC',
    permissions: ['finance.view', 'finance.reconcile', 'payout.request', 'adjustment.create', 'commission.plan.edit'],
    primaryBranchId: 'MUM01',
  },
  // 13 — Commission Approver
  commissionApprover: {
    userId: 'usr_cfo_01',
    email: 'commission@qloax.com',
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
    app_metadata: { tenant_id: persona.tenantId || 'ten_01M595WCNH6H3ZMCVS70XH9GAN' },
    user_metadata: { display_name: persona.displayName },
  };

  return `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(
    JSON.stringify(payload),
  )}.mock-signature`;
}

export async function setupPersonaSession(
  page: Page,
  persona: PersonaConfig,
  aal: 'aal1' | 'aal2' = 'aal2',
  seedStorage = true,
) {
  const token = createMockJwt(persona, aal);
  const tenantId = persona.tenantId || 'ten_01M595WCNH6H3ZMCVS70XH9GAN';
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
      app_metadata: { tenant_id: tenantId },
      user_metadata: { display_name: persona.displayName },
      created_at: '2026-01-01T00:00:00.000Z',
    },
  };

  // Seed localStorage if requested
  if (seedStorage) {
    await page.addInitScript(
      ({ session }) => {
        localStorage.setItem('sb-mlpkwwhnagxzinaohdxg-auth-token', JSON.stringify(session));
      },
      { session: sessionData },
    );
  }

  // Mock Supabase token endpoint (signInWithPassword)
  await page.route('**/auth/v1/token*', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(sessionData),
      });
    } else {
      await route.continue();
    }
  });

  // Mock Supabase sign-out
  await page.route('**/auth/v1/logout*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{}',
    });
  });

  // Mock test-login endpoint for fast bypass fallback
  await page.route('**/public/v1/auth/test-login', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          access_token: token,
          session: sessionData,
        },
      }),
    });
  });

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
        tenantId: tenantId,
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
        id: tenantId,
        slug: 'qloax-dsa',
        legalName: 'Qloax Finserv Private Limited',
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

export async function performRoleLogin(
  page: Page,
  persona: PersonaConfig,
  targetPath = '/',
  password = 'Qloax@DSA#2026',
): Promise<void> {
  // 1. Setup API route mocks for the persona without pre-seeding localStorage
  await setupPersonaSession(page, persona, 'aal1', false);

  // 2. Navigate to /login
  await page.goto('/login');
  await page.waitForLoadState('domcontentloaded');

  const emailInput = page.locator('[data-testid="auth.email"]');
  const isLoginPage = await emailInput.isVisible({ timeout: 4000 }).catch(() => false);

  if (isLoginPage) {
    await showDemoBanner(
      page,
      'Authentication Gate',
      `Signing in as ${persona.displayName} (${persona.roleCode})`,
    );

    const passwordInput = page.locator('[data-testid="auth.password"]');
    const submitBtn = page.locator('[data-testid="auth.submit"]');

    await humanType(emailInput, persona.email);
    await humanType(passwordInput, password);
    await pauseForDemo(page, 400);
    await humanClick(submitBtn, 600);
  }

  // 3. Handle MFA OTP step if presented
  const mfaInput = page.locator('[data-testid="auth.mfa.code"]');
  const isMfaPage = await mfaInput.isVisible({ timeout: 4000 }).catch(() => false);

  if (isMfaPage) {
    await showDemoBanner(page, '2FA Step-Up', 'Verifying MFA TOTP Code: 000000');
    const mfaSubmit = page.locator('[data-testid="auth.mfa.submit"]');
    await humanType(mfaInput, '000000');
    await pauseForDemo(page, 400);
    await humanClick(mfaSubmit, 800);
  }

  // 4. Ensure destination is reached
  if (targetPath && targetPath !== '/' && !page.url().includes(targetPath)) {
    await page.goto(targetPath);
  }
  await page.waitForLoadState('domcontentloaded');
  await pauseForDemo(page, 800);
}

export async function performRoleLogout(page: Page): Promise<void> {
  await showDemoBanner(page, 'Session Sign-Out', 'Signing out of role session');
  const accountBtn = page.locator('[data-testid="shell.account"]');
  if (await accountBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await humanClick(accountBtn, 300);
    const signoutBtn = page.locator('[data-testid="shell.signout"]');
    if (await signoutBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await humanClick(signoutBtn, 800);
    }
  } else {
    // If shell header is not visible (e.g. 403 or non-shell screen), clear storage and return to login
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.goto('/login');
  }
  const submitBtn = page.locator('[data-testid="auth.submit"]');
  await submitBtn.waitFor({ state: 'visible', timeout: 15000 });
  await showDemoBanner(page, 'Signed Out', 'Returned cleanly to Sign-In gate');
  await pauseForDemo(page, 1000);
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
