import { test, expect } from '@playwright/test';
import { PERSONAS, apiErrorBody } from './helpers/mock-session';
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
  // TC-DV-02 QA-DV-001: reject an invalid document with a reason code; completion is blocked while a mandatory item is
  // rejected, and allowed once every mandatory item is resolved
  // (Notion QA Plan Module 09 steps 3-7: "mandatory checks gate completion as specified")
  // =========================================================================
  test('TC-DV-02 QA-DV-001: completion blocked while a mandatory checklist item is rejected', async ({ page }) => {
    const authPage = new AuthPage(page);
    const vrfPage = new VerificationPage(page);

    // QA plan test data: QA_ADDRESS_PROOF_001, QA_INCOME_PROOF_001 and QA_INVALID_DOCUMENT_001, all mandatory
    const ADDRESS = 'chk_qa_address_001';
    const INCOME = 'chk_qa_income_001';
    const INVALID = 'chk_qa_invalid_001';
    const mockVerificationCase: Record<string, unknown> = {
      id: 'vrf_case_002',
      applicationId: 'app_qa_001',
      verificationType: 'DOCUMENT_REVIEW',
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      findingsSummary: null,
      lockVersion: 1,
      checklistItmIds: [ADDRESS, INCOME, INVALID],
      createdBy: 'usr_rm_01',
      createdAt: new Date().toISOString(),
    };

    // Mandatory checks gate completion: every mandatory item must be ACCEPTED or WAIVED
    const attestations = new Map<string, { status: string; rejectReason?: string }>();
    let completeCalls = 0;
    await page.route('**/v1/verification-requests**', async (route) => {
      const url = new URL(route.request().url()).pathname;
      if (url.endsWith('/vrf_case_002/checklist-review')) {
        const body = JSON.parse(route.request().postData() || '{}');
        attestations.set(body.checklistItemId, { status: body.status, rejectReason: body.rejectReason });
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            checklistItemId: body.checklistItemId,
            status: body.status,
            reviewedBy: 'usr_verifier_01',
            reviewedAt: new Date().toISOString(),
          }),
        });
      } else if (url.endsWith('/vrf_case_002/complete')) {
        completeCalls += 1;
        const open = (mockVerificationCase.checklistItmIds as string[]).filter(
          (id) => !['ACCEPTED', 'WAIVED'].includes(attestations.get(id)?.status ?? 'PENDING'),
        );
        if (open.length > 0) {
          await route.fulfill({
            status: 422,
            contentType: 'application/json',
            body: apiErrorBody(
              'COMPLETENESS_FAILED',
              422,
              `Mandatory checklist item ${open.join(', ')} is not accepted or waived.`,
            ),
          });
          return;
        }
        Object.assign(mockVerificationCase, {
          status: 'VERIFIED',
          outcome: 'POSITIVE',
          findingsSummary: JSON.parse(route.request().postData() || '{}').findingsSummary,
          lockVersion: 2,
        });
        await route.fulfill({
          status: 200,
          headers: { ETag: '"2"' },
          contentType: 'application/json',
          body: JSON.stringify(mockVerificationCase),
        });
      } else {
        await route.fulfill({
          status: 200,
          headers: { ETag: `"${mockVerificationCase.lockVersion}"` },
          contentType: 'application/json',
          body: JSON.stringify(mockVerificationCase),
        });
      }
    });

    await authPage.loginAs(PERSONAS.docVerifier, '/verifications/vrf_case_002');
    await vrfPage.showBanner('Checklist Review', 'Reviewing APP-QA-001 documents against the checklist');
    await vrfPage.pause(1500);

    // 3-4. Accept the address proof and the income proof
    await vrfPage.attestChecklistItem(ADDRESS, 'ACCEPTED');
    await expect(page.getByText(`Checklist item ${ADDRESS} marked as ACCEPTED!`)).toBeVisible();
    await vrfPage.attestChecklistItem(INCOME, 'ACCEPTED');
    await expect(page.getByText(`Checklist item ${INCOME} marked as ACCEPTED!`)).toBeVisible();

    // 5. Reject the unreadable document with a structured reason code
    await vrfPage.showBanner('Reject Invalid Document', 'Verdict REJECTED with reason code ILLEGIBLE');
    await vrfPage.attestChecklistItem(INVALID, 'REJECTED', 'Document is unreadable and blurry', 'Illegible / Blurry');
    await expect(page.getByText(`Checklist item ${INVALID} marked as REJECTED!`)).toBeVisible();
    expect(attestations.get(INVALID)).toEqual({ status: 'REJECTED', rejectReason: 'ILLEGIBLE' });

    // Findings are mandatory on finalization (client-side check)
    await vrfPage.click(vrfPage.completeAssessmentBtn, 1500);
    await vrfPage.findingsField.fill('ok');
    await vrfPage.click(vrfPage.submitVerdictBtn);
    await expect(page.getByText(/Findings summary must be at least 5 characters/i)).toBeVisible();
    expect(completeCalls).toBe(0);

    // 6. Completion is refused while a mandatory item is rejected, and the case stays open
    await vrfPage.showBanner('Completion Gate', 'Finalizing with a rejected mandatory document must fail');
    await vrfPage.type(vrfPage.findingsField, 'Address and income proofs verified; one document unreadable.');
    await vrfPage.click(vrfPage.submitVerdictBtn, 2000);
    await expect(page.getByText(`Mandatory checklist item ${INVALID} is not accepted or waived.`)).toBeVisible();
    await expect(page.getByText(/successfully finalized/i)).toHaveCount(0);
    expect(completeCalls).toBe(1);
    await vrfPage.click(page.getByRole('dialog').getByRole('button', { name: 'Cancel' }), 800);
    await expect(page.getByText('IN_PROGRESS', { exact: true })).toBeVisible();

    // 7. The customer re-submitted a readable file: accept it, then completion succeeds
    await vrfPage.showBanner('Resolve and Complete', 'Re-reviewed document accepted; verification completes');
    await vrfPage.attestChecklistItem(INVALID, 'ACCEPTED', 'Readable replacement received');
    await expect(page.getByText(`Checklist item ${INVALID} marked as ACCEPTED!`)).toBeVisible();
    await vrfPage.completeVerification('All mandatory documents reviewed and accepted.');
    await expect(page.getByText(/successfully finalized/i)).toBeVisible();
    await expect(page.locator('.MuiChip-label').getByText('VERIFIED', { exact: true })).toBeVisible();
    expect(completeCalls).toBe(2);
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
    // Manual flow 09 negative tests: no lead or customer screens, no document-sharing (upload link) screen
    for (const path of ['/leads', '/customers', '/document-sharing']) {
      await vrfPage.goto(path);
      await expect(page.getByText('You do not have permission to access this page.')).toBeVisible();
    }
    await vrfPage.showBanner('Operational Boundaries Enforced', 'Verifier restricted to checklist reviews');
    await vrfPage.pause(2000);
    await authPage.logout();
  });
});
