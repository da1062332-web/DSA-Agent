import { test, expect } from '@playwright/test';
import { PERSONAS } from './helpers/mock-session';
import { AuthPage, VerificationPage } from './pages';

test.describe('Persona 09: Document Verifier (ROLE-DOC-VERIFIER)', () => {

  // =========================================================================
  // TC-DV-01: Verification Case Initiation & Checklist Attestation
  // (Notion QA Plan Module 09 Steps 1-4, MOD-VRF, CMP-VRF.01)
  // =========================================================================
  test('TC-DV-01: Verification Case Initiation & Checklist Attestation', async ({ page }) => {
    const authPage = new AuthPage(page);
    const vrfPage = new VerificationPage(page);

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

    // 1. Visit Verifications queue via Page Object
    await authPage.loginAs(PERSONAS.docVerifier, '/verifications');
    await vrfPage.showBanner('Reviewing Document Verification Queue', 'To inspect applicant documents and record checklist item verifications');
    await vrfPage.pause(1500);
    await expect(page.getByText('vrf_case_001')).toBeVisible();

    // 2. Open Initiate Verification Dialog and test validation
    if (await vrfPage.newCaseBtn.isVisible()) {
      await vrfPage.showBanner('Initiate Case Dialog', 'Testing empty Application ID validation check');
      await vrfPage.click(vrfPage.newCaseBtn, 1500);
      await vrfPage.click(vrfPage.submitInitiateBtn);
      await expect(page.getByText(/Application ID is required/i)).toBeVisible();
      await vrfPage.pause(1500);
      await vrfPage.click(vrfPage.cancelInitiateBtn);
    }

    // 3. Open Verification Detail Page
    await vrfPage.goto('/verifications/vrf_case_001');
    await vrfPage.showBanner('Case vrf_case_001 Detail', 'Inspecting checklist items for APP-QA-001');
    await vrfPage.pause(1500);
    await expect(page.getByText('DOCUMENT REVIEW', { exact: true })).toBeVisible();

    // 4. Attest Checklist Document Item (QA_ADDRESS_PROOF_001 / chk_pan_01)
    await vrfPage.showBanner('Attest PAN Card', 'Opening checklist attestation modal for chk_pan_01');
    await expect(vrfPage.getAttestBtn('chk_pan_01')).toBeVisible();
    await vrfPage.attestChecklistItem('chk_pan_01', 'ACCEPTED');

    // Verify attestation success message
    await vrfPage.showBanner('Attestation Saved', 'PAN Card checklist item confirmed valid');
    await expect(page.getByRole('alert')).toContainText(/marked as ACCEPTED/i);
    await vrfPage.pause(2500);
    await authPage.logout();
  });

  // =========================================================================
  // TC-DV-02: Document Rejection & Mandatory Findings Validation on Finalization
  // (Notion QA Plan Module 09 Steps 5-7, MOD-VRF, CMP-VRF.02)
  // =========================================================================
  test('TC-DV-02: Document Rejection & Mandatory Findings Validation on Finalization', async ({ page }) => {
    const authPage = new AuthPage(page);
    const vrfPage = new VerificationPage(page);

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

    await authPage.loginAs(PERSONAS.docVerifier, '/verifications/vrf_case_002');
    await vrfPage.showBanner('Rejecting Illegible Document', 'To record verification rejection reasons and enforce mandatory assessment findings');
    await vrfPage.pause(1500);

    // 1. Open Attestation Dialog for Invalid Document
    await vrfPage.showBanner('Review Invalid Document', 'Opening attestation dialog for unreadable file');
    await expect(vrfPage.getAttestBtn('chk_invalid_doc_01')).toBeVisible();

    // 2. Select REJECTED verdict with ILLEGIBLE reason & note
    await vrfPage.showBanner('Select REJECTED Verdict', 'Attesting verdict: REJECTED with reason ILLEGIBLE');
    await vrfPage.showBanner('Attestation Note', 'Entering note: Document is unreadable and blurry');
    await vrfPage.showBanner('Submit Rejection', 'Persisting REJECTED attestation code');
    await vrfPage.attestChecklistItem('chk_invalid_doc_01', 'REJECTED', 'Document is unreadable and blurry');
    await expect(page.getByText(/marked as REJECTED/i)).toBeVisible();
    await vrfPage.pause(1500);

    // 3. Complete Verification Assessment: Test validation error for short findings (< 5 chars)
    await vrfPage.showBanner('Finalize Assessment', 'Opening assessment completion dialog');
    await expect(vrfPage.completeAssessmentBtn).toBeVisible();
    await vrfPage.click(vrfPage.completeAssessmentBtn, 1500);

    await vrfPage.showBanner('Findings Length Check', 'Testing rejection of short findings (< 5 chars)');
    await vrfPage.findingsField.fill('ok'); // < 5 chars
    await vrfPage.click(vrfPage.submitVerdictBtn);
    await expect(page.getByText(/Findings summary must be at least 5 characters/i)).toBeVisible();
    await vrfPage.pause(1500);

    // 4. Enter valid findings and finalize verification
    await vrfPage.showBanner('Submit Valid Findings', 'Entering comprehensive summary findings');
    await vrfPage.type(vrfPage.findingsField, 'All required documents reviewed and attested.');
    await vrfPage.pause(1200);

    await vrfPage.showBanner('Confirm Finalization', 'Submitting final assessment');
    await vrfPage.click(vrfPage.submitVerdictBtn, 2000);

    // Verify successful finalization
    await vrfPage.showBanner('Verification Finalized', 'Case successfully verified and closed');
    await expect(page.getByText(/successfully finalized/i)).toBeVisible();
    await vrfPage.pause(2500);
    await authPage.logout();
  });

  // =========================================================================
  // TC-DV-03: Segregation of Duties (SoD) & Access Control Enforcement
  // (Notion Architecture SoD Boundaries: Denies Sanction Recording & Finance Payouts)
  // =========================================================================
  test('TC-DV-03: Segregation of Duties (SoD) & Access Control Enforcement', async ({ page }) => {
    const authPage = new AuthPage(page);
    const vrfPage = new VerificationPage(page);

    await authPage.loginAs(PERSONAS.docVerifier, '/sanctions');
    await vrfPage.showBanner('Enforcing Document Verifier Boundaries', 'To ensure Verifiers cannot record sanctions, configure commission, or approve payouts');
    await vrfPage.pause(1200);

    // 1. Verify Document Verifier cannot access Sanctions & Disbursements
    await vrfPage.showBanner('Route Guard: Sanctions', 'Navigating to /sanctions (Expect 403 Forbidden)');
    await expect(page.getByText('You do not have permission to access this page.')).toBeVisible();
    await vrfPage.pause(1500);

    // 2. Verify Document Verifier cannot access Commission & Payouts
    await vrfPage.showBanner('Route Guard: Commission', 'Navigating to /commission (Expect 403 Forbidden)');
    await vrfPage.goto('/commission');
    await expect(page.getByText('You do not have permission to access this page.')).toBeVisible();
    await vrfPage.pause(1500);

    await vrfPage.showBanner('Route Guard: Approvals', 'Navigating to /approvals (Expect 403 Forbidden)');
    await vrfPage.goto('/approvals');
    await expect(page.getByText('You do not have permission to access this page.')).toBeVisible();
    await vrfPage.showBanner('Operational Boundaries Enforced', 'Verifier restricted to checklist reviews');
    await vrfPage.pause(2000);
    await authPage.logout();
  });
});
