import { test, expect } from '@playwright/test';
import { PERSONAS, setupPersonaSession } from './helpers/mock-session';

test.describe('Persona 06: Relationship Manager (ROLE-RM)', () => {
  test.beforeEach(async ({ page }) => {
    await setupPersonaSession(page, PERSONAS.rm);
  });

  test('TC-RM-01: Lead Intake with proactive client-side field validation', async ({ page }) => {
    // Mock lead creation endpoint
    await page.route('**/v1/leads', async (route) => {
      if (route.request().method() === 'POST') {
        const body = JSON.parse(route.request().postData() || '{}');
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'led_test_001',
            fullName: body.fullName,
            mobileMasked: '******3210',
            productCategory: body.productCategory,
            state: 'DRAFT',
            branchId: body.branchId,
            lockVersion: 1,
            createdAt: new Date().toISOString(),
          }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [], meta: { total: 0 } }),
        });
      }
    });

    await page.goto('/leads/new');

    // 1. Check page title and subtitle
    await expect(page.locator('h1')).toContainText('Create New Lead');

    // 2. Test empty submission validation
    const submitBtn = page.getByRole('button', { name: /Create Lead/i });
    await submitBtn.click();

    // Verify inline field validation errors
    await expect(page.getByText('Enter the full name (at least 2 characters).')).toBeVisible();
    await expect(page.getByText('Enter a mobile number.')).toBeVisible();

    // 3. Test invalid mobile number validation
    const mobileInput = page.locator('input[data-testid="lead-form.mobile"]');
    await mobileInput.fill('12345');
    await submitBtn.click();
    await expect(
      page.getByText('Enter a 10-digit mobile number starting with 6, 7, 8 or 9.'),
    ).toBeVisible();

    // 4. Test invalid email format validation
    const emailInput = page.locator('input[data-testid="lead-form.email"]');
    await emailInput.fill('invalid-email');
    await submitBtn.click();
    await expect(page.getByText('Enter a valid email address, or leave it blank.')).toBeVisible();

    // 5. Test invalid pincode validation
    const pincodeInput = page.locator('input[data-testid="lead-form.pincode"]');
    await pincodeInput.fill('012345');
    await submitBtn.click();
    await expect(page.getByText('Enter a 6-digit pincode that does not start with 0.')).toBeVisible();

    // 6. Test invalid amount (zero or negative)
    const amountInput = page.locator('input[data-testid="lead-form.amount"]');
    await amountInput.fill('0');
    await submitBtn.click();
    await expect(page.getByText(/Enter an amount greater than zero/i)).toBeVisible();

    // 7. Fix all fields with valid data
    await page.locator('input[data-testid="lead-form.fullName"]').fill('Kavya Deshmukh');
    await mobileInput.fill('9876543210');
    await emailInput.fill('kavya.deshmukh@example.com');
    await pincodeInput.fill('400008');
    await amountInput.fill('750000');

    // Submit valid form
    await submitBtn.click();

    // Verify successful redirection to lead detail page
    await expect(page).toHaveURL(/\/leads\/led_test_001/);
  });

  test('TC-RM-02: Lead Qualification, Conversion to Loan Application & DPDP Consents', async ({ page }) => {
    const mockLead = {
      id: 'led_test_001',
      fullName: 'Kavya Deshmukh',
      mobileMasked: '******3210',
      emailMasked: 'k***@example.com',
      pincode: '400008',
      productCategory: 'PL',
      indicativeAmount: { amount: '750000.00', currency: 'INR' },
      priority: 'HIGH',
      state: 'IN_PROGRESS',
      branchId: 'MUM01',
      source: 'WALK_IN',
      duplicateFlag: 'NONE',
      contactAttempts: 2,
      lockVersion: 1,
      createdAt: new Date().toISOString(),
    };

    await page.route('**/v1/leads/led_test_001', async (route) => {
      await route.fulfill({
        status: 200,
        headers: { ETag: 'W/"v1"' },
        contentType: 'application/json',
        body: JSON.stringify(mockLead),
      });
    });

    // Mock transition to QUALIFIED
    await page.route('**/v1/leads/led_test_001/transitions', async (route) => {
      mockLead.state = 'QUALIFIED';
      await route.fulfill({
        status: 200,
        headers: { ETag: 'W/"v2"' },
        contentType: 'application/json',
        body: JSON.stringify({ ...mockLead, lockVersion: 2 }),
      });
    });

    // Mock conversion to Application
    await page.route('**/v1/leads/led_test_001/conversion', async (route) => {
      mockLead.state = 'CONVERTED';
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          applicationId: 'app_loan_001',
          customerId: 'cus_kavya_001',
          leadId: 'led_test_001',
        }),
      });
    });

    await page.goto('/leads/led_test_001');

    // 1. Verify lead details rendered
    await expect(page.locator('h1')).toContainText('Kavya Deshmukh');

    // 2. Click "Qualify Lead" button to open modal
    const qualifyBtn = page.locator('[data-testid="lead.action.qualify"]');
    await expect(qualifyBtn).toBeVisible();
    await qualifyBtn.click();

    // 3. Test Qualify Dialog validation: clear income and amount
    const incomeField = page.locator('[data-testid="qualify.monthlyIncome"] input');
    await incomeField.fill('');
    const submitQualifyBtn = page.locator('[data-testid="qualify.submit"]');
    await submitQualifyBtn.click();
    await expect(page.getByText('Enter a valid monthly income greater than zero.')).toBeVisible();

    // Fill valid qualification data
    await incomeField.fill('85000');
    await submitQualifyBtn.click();

    // 4. Verify status updated to QUALIFIED
    await expect(page.getByText('Lead lifecycle state updated successfully.')).toBeVisible();

    // 5. Convert to Loan Application
    const convertBtn = page.locator('[data-testid="lead.action.convert"]');
    await expect(convertBtn).toBeVisible();
    await convertBtn.click();

    // 6. Verify Conversion Result Box
    await expect(page.getByRole('heading', { name: 'Lead Converted Successfully' })).toBeVisible();
    await expect(page.getByText('app_loan_001')).toBeVisible();
    await expect(page.getByText('cus_kavya_001')).toBeVisible();

    // Verify navigation link to DPDP Consents
    const consentsLink = page.getByRole('link', { name: /Manage Customer DPDP Consents/i });
    await expect(consentsLink).toBeVisible();
  });
});
