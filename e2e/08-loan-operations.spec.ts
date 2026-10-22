import { test, expect } from '@playwright/test';
import { PERSONAS, setupPersonaSession } from './helpers/mock-session';

test.describe('Persona 08: Loan Operations (ROLE-LOAN-OPS)', () => {
  test.beforeEach(async ({ page }) => {
    await setupPersonaSession(page, PERSONAS.loanOps);
  });

  test('TC-LO-01: Sanction Terms Recording & Tranche Limit Validation', async ({ page }) => {
    const mockSanctions: any[] = [];
    const mockTranches: any[] = [];

    // Mock sanctions API
    await page.route('**/v1/lender-cases/lcs_case_001/sanctions', async (route) => {
      if (route.request().method() === 'POST') {
        const body = JSON.parse(route.request().postData() || '{}');
        const newSanction = {
          id: 'snc_001',
          lenderCaseId: 'lcs_case_001',
          amount: body.amount,
          tenureMonths: body.tenureMonths,
          rateValue: body.rateValue,
          rateType: body.rateType,
          status: 'ACTIVE',
          sanctionDate: body.sanctionDate,
          validUntil: body.validUntil,
          createdAt: new Date().toISOString(),
        };
        mockSanctions.push(newSanction);
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ data: newSanction }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: mockSanctions }),
        });
      }
    });

    await page.route('**/v1/sanctions/snc_001/tranches', async (route) => {
      if (route.request().method() === 'POST') {
        const body = JSON.parse(route.request().postData() || '{}');
        const newTranche = {
          id: 'trn_001',
          sanctionId: 'snc_001',
          trancheNo: 1,
          amount: body.amount,
          disbursedOn: body.disbursedOn,
          status: 'RECORDED',
          utrMasked: 'UTR***0001',
          loanAccountMasked: 'LA***3210',
          recordedBy: 'usr_loanops_01',
          createdAt: new Date().toISOString(),
        };
        mockTranches.push(newTranche);
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ data: newTranche }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: mockTranches }),
        });
      }
    });

    // Navigate to Sanctions Panel with case ID
    await page.goto('/sanctions/lcs_case_001');

    // 1. Verify Sanctions Panel is loaded
    await expect(page.locator('[data-testid="sanctions-panel"]')).toBeVisible();

    // 2. Open "Record Sanction" dialog
    const recordSanctionBtn = page.locator('[data-testid="record-sanction-btn"]');
    await expect(recordSanctionBtn).toBeVisible();
    await recordSanctionBtn.click();

    // 3. Test Sanction validation: enter 0 amount and 0 tenure
    const amountField = page.locator('input[data-testid="sanction.amount"]');
    await amountField.fill('0');
    const tenureField = page.locator('input[data-testid="sanction.tenureMonths"]');
    await tenureField.fill('0');
    const rateField = page.locator('input[data-testid="sanction.rateValue"]');
    await rateField.fill('150'); // Rate > 100%

    const saveSanctionBtn = page.locator('button[data-testid="sanction.save-btn"]');
    await saveSanctionBtn.click();

    // Verify validation errors
    await expect(page.getByText('Sanction amount must be greater than zero.')).toBeVisible();
    await expect(page.getByText('Tenure must be at least 1 month.')).toBeVisible();
    await expect(page.getByText('Interest rate must be between 0.01% and 100%.')).toBeVisible();

    // 4. Fill valid sanction details
    await amountField.fill('1500000');
    await tenureField.fill('180');
    await rateField.fill('9.25');
    await saveSanctionBtn.click();

    // Verify Sanction recorded and displayed
    await expect(page.getByRole('heading', { name: '₹15,00,000' }).first()).toBeVisible();

    // 5. Open "Record Tranche" dialog
    const recordTrancheBtn = page.locator('[data-testid="record-tranche-btn"]');
    await expect(recordTrancheBtn).toBeVisible();
    await recordTrancheBtn.click();

    // 6. Test Tranche validation: amount exceeding sanction limit
    const trancheAmountField = page.locator('input[data-testid="tranche.amount"]');
    await trancheAmountField.fill('2000000'); // Exceeds 15,00,000
    const trancheSaveBtn = page.locator('button[data-testid="tranche.save-btn"]');

    // Button should be disabled or error surfaced
    if (await trancheSaveBtn.isEnabled()) {
      await trancheSaveBtn.click();
      await expect(page.getByText(/exceed remaining limit/i)).toBeVisible();
    }

    // Fill valid tranche details
    await trancheAmountField.fill('750000');
    await page.locator('input[data-testid="tranche.utr"]').fill('UTR202610219999');
    await page.locator('input[data-testid="tranche.loanAccount"]').fill('LN8877665544');
    await trancheSaveBtn.click();

    // Verify Tranche recorded in table
    await expect(page.getByRole('cell', { name: '₹7,50,000' })).toBeVisible();
    await expect(page.getByText('#1')).toBeVisible();
    await expect(page.getByText('RECORDED')).toBeVisible();
  });
});
