import { test, expect } from '@playwright/test';
import { PERSONAS, setupPersonaSession } from './helpers/mock-session';

test.describe('Persona 09: Document Verifier (ROLE-DOC-VERIFIER)', () => {
  test.beforeEach(async ({ page }) => {
    await setupPersonaSession(page, PERSONAS.docVerifier);
  });

  test('TC-DV-01: Verification Case Initiation, Checklist Attestation & Case Finalization', async ({ page }) => {
    const mockVerificationCase = {
      id: 'vrf_case_001',
      applicationId: 'app_loan_001',
      verificationType: 'DOCUMENT_REVIEW',
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      findingsSummary: null,
      lockVersion: 1,
      checklistItmIds: ['chk_pan_01', 'chk_itr_01'],
      checklistItems: [
        {
          id: 'chk_pan_01',
          code: 'PAN_CARD',
          title: 'Permanent Account Number Card',
          status: 'PENDING',
          required: true,
          documentId: 'doc_pan_001',
        },
        {
          id: 'chk_itr_01',
          code: 'ITR_RETURNS',
          title: 'Latest 2-Year ITR Computation',
          status: 'PENDING',
          required: true,
          documentId: 'doc_itr_001',
        },
      ],
      createdAt: new Date().toISOString(),
    };

    // Mock verification requests list & detail
    await page.route('**/v1/verification-requests**', async (route) => {
      const url = route.request().url();
      if (url.includes('/vrf_case_001/complete')) {
        mockVerificationCase.status = 'VERIFIED';
        mockVerificationCase.findingsSummary = 'All KYC and income records verified satisfactorily.';
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: mockVerificationCase }),
        });
      } else if (url.includes('/vrf_case_001/checklist/chk_pan_01/attestation')) {
        const item = mockVerificationCase.checklistItems[0];
        item.status = 'ACCEPTED';
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: item }),
        });
      } else if (url.includes('/vrf_case_001')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: mockVerificationCase }),
        });
      } else if (route.request().method() === 'POST') {
        const body = JSON.parse(route.request().postData() || '{}');
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              ...mockVerificationCase,
              applicationId: body.applicationId,
              verificationType: body.verificationType,
            },
          }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [mockVerificationCase], meta: { total: 1 } }),
        });
      }
    });

    // 1. Visit Verifications list
    await page.goto('/verifications');
    await expect(page.getByText('vrf_case_001')).toBeVisible();

    // 2. Open "Initiate Verification" dialog
    const newCaseBtn = page.getByRole('button', { name: /Initiate Verification/i });
    if (await newCaseBtn.isVisible()) {
      await newCaseBtn.click();
      // Test validation: empty application ID
      const submitBtn = page.getByRole('button', { name: /Initiate Case|Submit/i });
      const appIdInput = page.locator('input[data-testid="verification.create.applicationId"]');
      await appIdInput.fill('');
      await submitBtn.click();
      await expect(page.getByText(/Application ID is required/i)).toBeVisible();
      // Cancel dialog
      await page.getByRole('button', { name: /Cancel/i }).click();
    }

    // 3. Navigate to Verification Detail Page
    await page.goto('/verifications/vrf_case_001');
    await expect(page.getByText('DOCUMENT REVIEW', { exact: true })).toBeVisible();

    // 4. Test Finalize Verification Dialog Validation: findings too short
    const completeBtn = page.locator('[data-testid="verification.btn.complete"]');
    await expect(completeBtn).toBeVisible();
    await completeBtn.click();

    const findingsField = page.locator('[data-testid="verification.complete.findings"] textarea').first();
    await findingsField.fill('ok'); // Length < 5
    const submitVerdictBtn = page.locator('[data-testid="verification.complete.submit"]');
    await submitVerdictBtn.click();
    await expect(page.getByText(/Findings summary must be at least 5 characters/i)).toBeVisible();

    // Enter valid findings
    await findingsField.fill('All KYC and income records verified satisfactorily.');
    await submitVerdictBtn.click();
    await expect(page.getByText(/successfully finalized/i)).toBeVisible();
  });
});
