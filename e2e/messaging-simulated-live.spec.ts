// LIVE messaging walkthrough on the LOCAL test stack. Simulated provider only: nothing is sent to a customer.
// The local API runs with ENABLE_MOCK_PROVIDERS=true (apps/api/.env.e2e). Run:
//   npm run test:e2e:live -- -g "messaging"
import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';

const PASSWORD = process.env.SALES_PASSWORD ?? '';
const RUN = Date.now().toString(36).slice(-5);
const CODE = `sim_notice_${RUN}`;
const AUTHOR = 'admin@alpha.com'; // creates the draft (has config.manage)
const APPROVER = 'owner@alpha.com'; // a different person approves it (config.manage)
const SENDER = 'sales1@alpha.com'; // sends messages (ROLE-SALES-EXEC: lead.read and message.send)
const SHOTS = path.resolve(process.cwd(), 'test-results', 'messaging');

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.locator('[data-testid="auth.email"]').fill(email);
  await page.locator('[data-testid="auth.password"]').fill(PASSWORD);
  await page.locator('[data-testid="auth.submit"]').click();
  await page.locator('[data-testid="mfa.code"]').fill('000000');
  await page.locator('[data-testid="mfa.submit"]').click();
  // After sign-in the app opens the page the person was last on, so only check that the login page is gone.
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
}

async function signOut(page: Page) {
  await page.locator('[data-testid="shell.account"]').click();
  await page.locator('[data-testid="shell.signout"]').click();
  await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
}

test.describe('Messaging: simulated SMS and email (test only)', () => {
  test.skip(process.env.E2E_LIVE !== '1', 'Run with: npm run test:e2e:live');
  test.skip(!PASSWORD, 'No password: check DEMO_USER_PASSWORD in apps/api/.env.e2e');

  test('author drafts a template, another person approves it, and a simulated SMS is sent and marked', async ({ page }) => {
    test.setTimeout(240_000);

    // 1. Author creates a draft template, using the common-variable chips and the language dropdown.
    await signIn(page, AUTHOR);
    await page.goto('/messaging');
    await page.getByRole('button', { name: 'New Template' }).click();
    await page.getByLabel('Template Code').fill(CODE);
    await page.getByLabel('Channel').click();
    await page.getByRole('option', { name: 'SMS' }).click();
    await page.getByLabel('Language').click();
    await expect(page.getByRole('option', { name: /Hindi/ })).toBeVisible();
    await page.getByRole('option', { name: /English/ }).click();

    const body = page.getByLabel('Template Body');
    await body.fill('Hi {{applicantName}}, your loan of {{loanAmount}} is ready.');
    const common = page.getByTestId('template.common-variables');
    await common.getByText('{{dueDate}}', { exact: true }).click();
    await expect(body).toHaveValue(/\{\{dueDate\}\}/);
    // Every placeholder in the body is declared automatically.
    await expect(page.getByText('Declared Variables:')).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, '1-template-form.png'), fullPage: true }).catch(() => {});

    await page.getByRole('button', { name: 'Save as draft (needs approval)' }).click();
    const row = page.getByRole('row', { name: new RegExp(CODE) });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row.getByText('DRAFT')).toBeVisible();
    await expect(row.getByText('Waiting for another approver')).toBeVisible();
    await signOut(page);

    // 2. A different person approves it.
    await signIn(page, APPROVER);
    await page.goto('/messaging');
    const approvalRow = page.getByRole('row', { name: new RegExp(CODE) });
    await approvalRow.getByRole('button', { name: 'Approve' }).click();
    await expect(approvalRow.getByText('APPROVED')).toBeVisible({ timeout: 20_000 });
    await signOut(page);

    // 3. The sender sends a simulated SMS to a test number.
    await signIn(page, SENDER);
    await page.goto('/messaging');
    await page.getByRole('tab', { name: 'Dispatch & Send Guard' }).click();
    await page.getByLabel('Select Lead').click();
    await page.getByRole('option').first().click();
    await page.getByLabel('Channel').click();
    await page.getByRole('option', { name: 'SMS' }).click();
    await page.getByLabel('Approved Template').click();
    await page.getByRole('option', { name: new RegExp(CODE) }).click();
    await page.getByLabel('Recipient Mobile Number (E.164)').fill('+919000000104');
    await page.getByLabel('applicantName').fill('Test Customer');
    await page.getByLabel('loanAmount').fill('200000');
    await page.getByLabel('dueDate').fill('31/10/2026');
    await page.getByRole('button', { name: /send|dispatch/i }).last().click();

    // The result says plainly that nothing was delivered.
    await expect(page.getByText('SIMULATED — NOT SENT')).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: path.join(SHOTS, '2-simulated-sent.png'), fullPage: true }).catch(() => {});

    // 4. The delivery history shows the simulated label, and a test result can be recorded.
    await page.getByRole('tab', { name: 'Delivery History' }).click();
    const msgRow = page.getByRole('row').filter({ hasText: 'SIMULATED — NOT SENT' }).first();
    await expect(msgRow).toBeVisible();
    await msgRow.getByRole('button', { name: 'Mark delivered' }).click();
    await expect(msgRow.getByText('DELIVERED', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: path.join(SHOTS, '3-delivery-history.png'), fullPage: true }).catch(() => {});

    // 5. A simulated failure: the test number ending in 999 makes the simulated provider refuse the message.
    await page.getByRole('tab', { name: 'Dispatch & Send Guard' }).click();
    await page.getByLabel('Select Lead').click();
    await page.getByRole('option').first().click();
    await page.getByLabel('Channel').click();
    await page.getByRole('option', { name: 'SMS' }).click();
    await page.getByLabel('Approved Template').click();
    await page.getByRole('option', { name: new RegExp(CODE) }).click();
    await page.getByLabel('Recipient Mobile Number (E.164)').fill('+919000000999');
    await page.getByLabel('applicantName').fill('Test Customer');
    await page.getByLabel('loanAmount').fill('200000');
    await page.getByLabel('dueDate').fill('31/10/2026');
    await page.getByRole('button', { name: /dispatch/i }).last().click();
    await page.getByRole('tab', { name: 'Delivery History' }).click();
    const failedRow = page.getByRole('row').filter({ hasText: 'FAILED' }).filter({ hasText: 'SIMULATED — NOT SENT' }).first();
    await expect(failedRow).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: path.join(SHOTS, '4-simulated-failure.png'), fullPage: true }).catch(() => {});
    await signOut(page);
  });

  test('a simulated email: draft, approval by a different person, simulated send, and a simulated failure', async ({ page }) => {
    test.setTimeout(240_000);
    const EMAIL_CODE = `sim_email_${RUN}`;

    await signIn(page, AUTHOR);
    await page.goto('/messaging');
    await page.getByRole('button', { name: 'New Template' }).click();
    await page.getByLabel('Template Code').fill(EMAIL_CODE);
    await page.getByLabel('Channel').click();
    await page.getByRole('option', { name: 'EMAIL' }).click();
    await page.getByLabel('Template Body').fill('Dear {{applicantName}}, your application {{applicationId}} needs {{documentName}}.');
    await page.getByRole('button', { name: 'Save as draft (needs approval)' }).click();
    const draftRow = page.getByRole('row', { name: new RegExp(EMAIL_CODE) });
    await expect(draftRow.getByText('DRAFT')).toBeVisible({ timeout: 20_000 });
    await signOut(page);

    await signIn(page, APPROVER);
    await page.goto('/messaging');
    const approveRow = page.getByRole('row', { name: new RegExp(EMAIL_CODE) });
    await approveRow.getByRole('button', { name: 'Approve' }).click();
    await expect(approveRow.getByText('APPROVED')).toBeVisible({ timeout: 20_000 });
    await signOut(page);

    await signIn(page, SENDER);
    await page.goto('/messaging');
    await page.getByRole('tab', { name: 'Dispatch & Send Guard' }).click();
    await page.getByLabel('Select Lead').click();
    await page.getByRole('option').first().click();
    await page.getByLabel('Channel').click();
    await page.getByRole('option', { name: 'EMAIL' }).click();
    await page.getByLabel('Approved Template').click();
    await page.getByRole('option', { name: new RegExp(EMAIL_CODE) }).click();
    await page.getByLabel('Recipient Email').fill('borrower.test@example.com');
    await page.getByLabel('applicantName').fill('Test Customer');
    await page.getByLabel('applicationId').fill('APP-TEST-1');
    await page.getByLabel('documentName').fill('salary slip');
    await page.getByRole('button', { name: /dispatch/i }).last().click();
    await expect(page.getByText('SIMULATED — NOT SENT')).toBeVisible({ timeout: 20_000 });

    // A test address whose local part ends in +fail is refused by the simulated provider.
    await page.getByRole('tab', { name: 'Dispatch & Send Guard' }).click();
    await page.getByLabel('Select Lead').click();
    await page.getByRole('option').first().click();
    await page.getByLabel('Channel').click();
    await page.getByRole('option', { name: 'EMAIL' }).click();
    await page.getByLabel('Approved Template').click();
    await page.getByRole('option', { name: new RegExp(EMAIL_CODE) }).click();
    await page.getByLabel('Recipient Email').fill('borrower+fail@example.com');
    await page.getByLabel('applicantName').fill('Test Customer');
    await page.getByLabel('applicationId').fill('APP-TEST-2');
    await page.getByLabel('documentName').fill('salary slip');
    await page.getByRole('button', { name: /dispatch/i }).last().click();
    await page.getByRole('tab', { name: 'Delivery History' }).click();
    await expect(
      page.getByRole('row').filter({ hasText: 'FAILED' }).filter({ hasText: 'SIMULATED — NOT SENT' }).first(),
    ).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: path.join(SHOTS, '5-simulated-email.png'), fullPage: true }).catch(() => {});
    await signOut(page);
  });
});
