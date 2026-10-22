import { test, expect } from '@playwright/test';
import { PERSONAS, setupPersonaSession, pauseForDemo, humanType, humanClick } from './helpers/mock-session';

test.describe('Persona 09: Document Verifier (ROLE-DOC-VERIFIER)', () => {
  test.beforeEach(async ({ page }) => {
    await setupPersonaSession(page, PERSONAS.docVerifier);
  });

  // =========================================================================
  // TC-DV-01: Verification Case Initiation & Checklist Attestation
  // (Notion QA Plan Module 09 Steps 1-4, MOD-VRF, CMP-VRF.01)
  // =========================================================================
  test('TC-DV-01: Verification Case Initiation & Checklist Attestation', async ({ page }) => {
    const mockVerificationCase = {
      id: 'vrf_case_001',
      applicationId: 'APP-QA-001',
      verificationType: 'DOCUMENT_REVIEW',
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      findingsSummary: null,
      lockVersion: 1,
      checklistItmIds: ['chk_pan_01', 'chk_itr_01'],
      createdAt: new Date().toISOString(),
    };

    await page.route('**/v1/verification-requests**', async (route) => {
      const url = route.request().url();
      if (url.includes('/vrf_case_001/attestation')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        });
      } else if (url.includes('/vrf_case_001')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: mockVerificationCase }),
        });
      } else if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ data: mockVerificationCase }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [mockVerificationCase], meta: { total: 1 } }),
        });
      }
    });

    // 1. Visit Verifications queue
    await page.goto('/verifications');
    await pauseForDemo(page, 2000);
    await expect(page.getByText('vrf_case_001')).toBeVisible();

    // 2. Open Initiate Verification Dialog and test validation
    const newCaseBtn = page.getByRole('button', { name: /Initiate Verification/i });
    if (await newCaseBtn.isVisible()) {
      await humanClick(newCaseBtn, 1500);
      const submitBtn = page.getByRole('button', { name: /Initiate Case|Submit/i });
      await humanClick(submitBtn);
      await expect(page.getByText(/Application ID is required/i)).toBeVisible();
      await pauseForDemo(page, 2000);
      await humanClick(page.getByRole('button', { name: /Cancel/i }));
    }

    // 3. Open Verification Detail Page
    await page.goto('/verifications/vrf_case_001');
    await pauseForDemo(page, 2000);
    await expect(page.getByText('DOCUMENT REVIEW', { exact: true })).toBeVisible();

    // 4. Attest Checklist Document Item (QA_ADDRESS_PROOF_001 / chk_pan_01)
    const attestPanBtn = page.locator('[data-testid="verification.attest.chk_pan_01"]');
    await expect(attestPanBtn).toBeVisible();
    await humanClick(attestPanBtn, 2000);

    // Submit Attestation as ACCEPTED
    const submitAttestBtn = page.getByRole('button', { name: /Submit Attestation/i });
    await humanClick(submitAttestBtn, 2500);

    // Verify attestation success message
    await expect(page.getByText(/marked as ACCEPTED/i)).toBeVisible();
    await pauseForDemo(page, 3000);
  });

  // =========================================================================
  // TC-DV-02: Document Rejection & Mandatory Findings Validation on Finalization
  // (Notion QA Plan Module 09 Steps 5-7, MOD-VRF, CMP-VRF.02)
  // =========================================================================
  test('TC-DV-02: Document Rejection & Mandatory Findings Validation on Finalization', async ({ page }) => {
    const mockVerificationCase = {
      id: 'vrf_case_002',
      applicationId: 'APP-QA-001',
      verificationType: 'DOCUMENT_REVIEW',
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      findingsSummary: null,
      lockVersion: 1,
      checklistItmIds: ['chk_invalid_doc_01'],
      createdAt: new Date().toISOString(),
    };

    await page.route('**/v1/verification-requests**', async (route) => {
      const url = route.request().url();
      if (url.includes('/vrf_case_002/complete')) {
        mockVerificationCase.status = 'VERIFIED';
        mockVerificationCase.findingsSummary = 'All required documents reviewed and attested.';
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: mockVerificationCase }),
        });
      } else if (url.includes('/vrf_case_002/attestation')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        });
      } else if (url.includes('/vrf_case_002')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: mockVerificationCase }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [mockVerificationCase], meta: { total: 1 } }),
        });
      }
    });

    await page.goto('/verifications/vrf_case_002');
    await pauseForDemo(page, 2000);

    // 1. Open Attestation Dialog for Invalid Document
    const attestInvalidBtn = page.locator('[data-testid="verification.attest.chk_invalid_doc_01"]');
    await expect(attestInvalidBtn).toBeVisible();
    await humanClick(attestInvalidBtn, 2000);

    // 2. Select REJECTED verdict with ILLEGIBLE reason
    const verdictSelect = page.getByLabel('Review Verdict');
    await humanClick(verdictSelect);
    await humanClick(page.getByRole('option', { name: /REJECTED/i }), 1000);

    // Add note
    const noteField = page.getByLabel('Attestation Note');
    await humanType(noteField, 'Document is unreadable and blurry');
    await pauseForDemo(page, 1500);

    // Submit Attestation
    await humanClick(page.getByRole('button', { name: /Submit Attestation/i }), 2500);
    await expect(page.getByText(/marked as REJECTED/i)).toBeVisible();
    await pauseForDemo(page, 2000);

    // 3. Complete Verification Assessment: Test validation error for short findings (< 5 chars)
    const completeBtn = page.locator('[data-testid="verification.btn.complete"]');
    await expect(completeBtn).toBeVisible();
    await humanClick(completeBtn, 2000);

    const findingsField = page.locator('[data-testid="verification.complete.findings"] textarea').first();
    await findingsField.fill('ok'); // < 5 chars
    const submitVerdictBtn = page.locator('[data-testid="verification.complete.submit"]');
    await humanClick(submitVerdictBtn);
    await expect(page.getByText(/Findings summary must be at least 5 characters/i)).toBeVisible();
    await pauseForDemo(page, 2000);

    // 4. Enter valid findings and finalize verification
    await humanType(findingsField, 'All required documents reviewed and attested.');
    await pauseForDemo(page, 1500);
    await humanClick(submitVerdictBtn, 2500);

    // Verify successful finalization
    await expect(page.getByText(/successfully finalized/i)).toBeVisible();
    await pauseForDemo(page, 3000);
  });

  // =========================================================================
  // TC-DV-03: Segregation of Duties (SoD) & Access Control Enforcement
  // (Notion Architecture SoD Boundaries: Denies Sanction Recording & Finance Payouts)
  // =========================================================================
  test('TC-DV-03: Segregation of Duties (SoD) & Access Control Enforcement', async ({ page }) => {
    // 1. Verify Document Verifier cannot access Sanctions & Disbursements
    await page.goto('/sanctions');
    await pauseForDemo(page, 1500);
    await expect(page.getByText('You do not have permission to access this page.')).toBeVisible();

    // 2. Verify Document Verifier cannot access Commission & Payouts
    await page.goto('/commission');
    await pauseForDemo(page, 1500);
    await expect(page.getByText('You do not have permission to access this page.')).toBeVisible();

    await page.goto('/approvals');
    await pauseForDemo(page, 1500);
    await expect(page.getByText('You do not have permission to access this page.')).toBeVisible();
    await pauseForDemo(page, 2000);
  });
});
