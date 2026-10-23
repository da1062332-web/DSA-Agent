import { test, expect } from '@playwright/test';
import {
  PERSONAS,
  setupPersonaSession,
  performRoleLogin,
  performRoleLogout,
  pauseForDemo,
  humanType,
  humanClick,
  showDemoBanner,
} from './helpers/mock-session';

test.describe('Persona 09: Document Verifier (ROLE-DOC-VERIFIER)', () => {


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
    await performRoleLogin(page, PERSONAS.docVerifier, '/verifications');
    await showDemoBanner(page, 'Reviewing Document Verification Queue', 'To inspect applicant documents and record checklist item verifications');
    await pauseForDemo(page, 1500);
    await expect(page.getByText('vrf_case_001')).toBeVisible();

    // 2. Open Initiate Verification Dialog and test validation
    const newCaseBtn = page.getByRole('button', { name: /Initiate Verification/i });
    if (await newCaseBtn.isVisible()) {
      await showDemoBanner(page, 'Initiate Case Dialog', 'Testing empty Application ID validation check');
      await humanClick(newCaseBtn, 1500);
      const submitBtn = page.getByRole('button', { name: /Initiate Case|Submit/i });
      await humanClick(submitBtn);
      await expect(page.getByText(/Application ID is required/i)).toBeVisible();
      await pauseForDemo(page, 1500);
      await humanClick(page.getByRole('button', { name: /Cancel/i }));
    }

    // 3. Open Verification Detail Page
    await page.goto('/verifications/vrf_case_001');
    await showDemoBanner(page, 'Case vrf_case_001 Detail', 'Inspecting checklist items for APP-QA-001');
    await pauseForDemo(page, 1500);
    await expect(page.getByText('DOCUMENT REVIEW', { exact: true })).toBeVisible();

    // 4. Attest Checklist Document Item (QA_ADDRESS_PROOF_001 / chk_pan_01)
    await showDemoBanner(page, 'Attest PAN Card', 'Opening checklist attestation modal for chk_pan_01');
    const attestPanBtn = page.locator('[data-testid="verification.attest.chk_pan_01"]');
    await expect(attestPanBtn).toBeVisible();
    await humanClick(attestPanBtn, 1500);

    // Submit Attestation as ACCEPTED
    await showDemoBanner(page, 'Attestation: ACCEPTED', 'Confirming document validity with audit note');
    const submitAttestBtn = page.getByRole('button', { name: /Submit Attestation/i });
    await humanClick(submitAttestBtn, 2000);

    // Verify attestation success message
    await showDemoBanner(page, 'Attestation Saved', 'PAN Card checklist item confirmed valid');
    await expect(page.getByRole('alert')).toContainText(/marked as ACCEPTED/i);
    await pauseForDemo(page, 2500);
    await performRoleLogout(page);
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

    await performRoleLogin(page, PERSONAS.docVerifier, '/verifications/vrf_case_002');
    await showDemoBanner(page, 'Rejecting Illegible Document', 'To record verification rejection reasons and enforce mandatory assessment findings');
    await pauseForDemo(page, 1500);

    // 1. Open Attestation Dialog for Invalid Document
    await showDemoBanner(page, 'Review Invalid Document', 'Opening attestation dialog for unreadable file');
    const attestInvalidBtn = page.locator('[data-testid="verification.attest.chk_invalid_doc_01"]');
    await expect(attestInvalidBtn).toBeVisible();
    await humanClick(attestInvalidBtn, 1500);

    // 2. Select REJECTED verdict with ILLEGIBLE reason
    await showDemoBanner(page, 'Select REJECTED Verdict', 'Attesting verdict: REJECTED with reason ILLEGIBLE');
    const verdictSelect = page.getByLabel('Review Verdict');
    await humanClick(verdictSelect);
    await humanClick(page.getByRole('option', { name: /REJECTED/i }), 1000);

    // Add note
    await showDemoBanner(page, 'Attestation Note', 'Entering note: Document is unreadable and blurry');
    const noteField = page.getByLabel('Attestation Note');
    await humanType(noteField, 'Document is unreadable and blurry');
    await pauseForDemo(page, 1200);

    // Submit Attestation
    await showDemoBanner(page, 'Submit Rejection', 'Persisting REJECTED attestation code');
    await humanClick(page.getByRole('button', { name: /Submit Attestation/i }), 2000);
    await expect(page.getByText(/marked as REJECTED/i)).toBeVisible();
    await pauseForDemo(page, 1500);

    // 3. Complete Verification Assessment: Test validation error for short findings (< 5 chars)
    await showDemoBanner(page, 'Finalize Assessment', 'Opening assessment completion dialog');
    const completeBtn = page.locator('[data-testid="verification.btn.complete"]');
    await expect(completeBtn).toBeVisible();
    await humanClick(completeBtn, 1500);

    await showDemoBanner(page, 'Findings Length Check', 'Testing rejection of short findings (< 5 chars)');
    const findingsField = page.locator('[data-testid="verification.complete.findings"] textarea').first();
    await findingsField.fill('ok'); // < 5 chars
    const submitVerdictBtn = page.locator('[data-testid="verification.complete.submit"]');
    await humanClick(submitVerdictBtn);
    await expect(page.getByText(/Findings summary must be at least 5 characters/i)).toBeVisible();
    await pauseForDemo(page, 1500);

    // 4. Enter valid findings and finalize verification
    await showDemoBanner(page, 'Submit Valid Findings', 'Entering comprehensive summary findings');
    await humanType(findingsField, 'All required documents reviewed and attested.');
    await pauseForDemo(page, 1200);

    await showDemoBanner(page, 'Confirm Finalization', 'Submitting final assessment');
    await humanClick(submitVerdictBtn, 2000);

    // Verify successful finalization
    await showDemoBanner(page, 'Verification Finalized', 'Case successfully verified and closed');
    await expect(page.getByText(/successfully finalized/i)).toBeVisible();
    await pauseForDemo(page, 2500);
    await performRoleLogout(page);
  });

  // =========================================================================
  // TC-DV-03: Segregation of Duties (SoD) & Access Control Enforcement
  // (Notion Architecture SoD Boundaries: Denies Sanction Recording & Finance Payouts)
  // =========================================================================
  test('TC-DV-03: Segregation of Duties (SoD) & Access Control Enforcement', async ({ page }) => {
    await performRoleLogin(page, PERSONAS.docVerifier, '/sanctions');
    await showDemoBanner(page, 'Enforcing Document Verifier Boundaries', 'To ensure Verifiers cannot record sanctions, configure commission, or approve payouts');
    await pauseForDemo(page, 1200);

    // 1. Verify Document Verifier cannot access Sanctions & Disbursements
    await showDemoBanner(page, 'Route Guard: Sanctions', 'Navigating to /sanctions (Expect 403 Forbidden)');
    await expect(page.getByText('You do not have permission to access this page.')).toBeVisible();
    await pauseForDemo(page, 1500);

    // 2. Verify Document Verifier cannot access Commission & Payouts
    await showDemoBanner(page, 'Route Guard: Commission', 'Navigating to /commission (Expect 403 Forbidden)');
    await page.goto('/commission');
    await expect(page.getByText('You do not have permission to access this page.')).toBeVisible();
    await pauseForDemo(page, 1500);

    await showDemoBanner(page, 'Route Guard: Approvals', 'Navigating to /approvals (Expect 403 Forbidden)');
    await page.goto('/approvals');
    await expect(page.getByText('You do not have permission to access this page.')).toBeVisible();
    await showDemoBanner(page, 'Operational Boundaries Enforced', 'Verifier restricted to checklist reviews');
    await pauseForDemo(page, 2000);
    await performRoleLogout(page);
  });
});
