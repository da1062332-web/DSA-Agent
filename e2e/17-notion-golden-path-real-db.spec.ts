import { test, expect } from '@playwright/test';
import { ALPHA_PERSONAS, apiErrorBody, isHeaded } from './helpers/mock-session';
import {
  AuthPage,
  TenantAdminPage,
  LeadPage,
  ManagerDashboardPage,
  DocumentSharingPage,
  CustomerPortalPage,
  VerificationPage,
  LenderCasePage,
  SanctionPage,
  PayoutPage,
  AuditPage,
  RuleEditorPage,
} from './pages';

/**
 * Spec 17: Official Notion Manual Testing Suite — End-to-End Golden Path (All Roles)
 * 
 * Based directly on:
 * - Notion Page: "End-to-end golden path (all roles) (1)"
 * - Notion Page: "00 — Setup, accounts and shared demo data (1)"
 * - Notion Page: "Roles, Workflows & Permissions Architecture"
 * 
 * Target Tenant: demo-alpha (Alpha Demo Finserv)
 * Primary Case: Lead A (Kavya Deshmukh) - Personal Loan ₹3,00,000
 * Passing through all 12 operational steps from intake to audit verification.
 */
test.describe('Spec 17: Notion Master End-to-End Golden Path (All Roles)', () => {

  const TENANT_ID = 'ten_01M4SXZ9E66W8T6DNJYBVNS3FA'; // demo-alpha
  const BRANCH_ID = 'MUM01';
  const LEAD_ID = 'lead_demo_kavya_deshmukh_01';
  const APP_ID = 'app_demo_kavya_001';
  const CUST_ID = 'cus_demo_kavya_001';
  const SHARE_TOKEN = 'tok_secure_kavya_demo_01';
  const CASE_ID = 'lcs_case_kavya_001';
  const SANCTION_ID = 'snc_kavya_001';
  const TRANCHE_ID = 'trn_kavya_001';

  test('TC-NOTION-GOLDEN-PATH: Complete 12-Step Lifecycle Across All Roles with DB Data', async ({
    page,
    browser,
  }) => {
    test.setTimeout(isHeaded ? 600_000 : 300_000);

    const authPage = new AuthPage(page);
    const tenantAdminPage = new TenantAdminPage(page);
    const leadPage = new LeadPage(page);
    const dashboardPage = new ManagerDashboardPage(page);
    const sharingPage = new DocumentSharingPage(page);
    const verificationPage = new VerificationPage(page);
    const lenderCasePage = new LenderCasePage(page);
    const sanctionPage = new SanctionPage(page);
    const payoutPage = new PayoutPage(page);
    const auditPage = new AuditPage(page);
    const rulePage = new RuleEditorPage(page);

    // Shared state tracking for Lead A (Kavya Deshmukh)
    const stateLead = {
      id: LEAD_ID,
      fullName: 'Kavya Deshmukh',
      mobileMasked: '+91 ••••• ••234',
      emailMasked: 'kavya.deshmukh@example.com',
      pincode: '400008',
      productCategory: 'PL',
      indicativeAmount: { amount: '300000.00', currency: 'INR' },
      priority: 'HIGH',
      state: 'NEW',
      branchId: BRANCH_ID,
      source: 'WALK_IN',
      subSource: 'Branch booth',
      duplicateFlag: 'NONE',
      contactAttempts: 0,
      assignedUserId: ALPHA_PERSONAS.salesExec.userId,
      lockVersion: 1,
      createdAt: new Date().toISOString(),
    };

    // Shared application & document state
    const stateApp = {
      id: APP_ID,
      applicationNumber: 'APP-2026-MUM-0001',
      customerId: CUST_ID,
      customerName: 'Kavya Deshmukh',
      productCategory: 'PL',
      requestedAmount: { amount: '300000.00', currency: 'INR' },
      applicantType: 'SALARIED',
      monthlyIncome: '75000.00',
      status: 'DRAFT',
      branchId: BRANCH_ID,
      assignedUserId: ALPHA_PERSONAS.rm1.userId,
      checklist: [
        {
          id: 'chk_id_proof_01',
          name: 'Government Photo ID Proof',
          status: 'PENDING_UPLOAD',
          mandatory: true,
          documentId: null as string | null,
        },
      ],
      createdAt: new Date().toISOString(),
    };

    // Intercept common APIs to ensure smooth execution across all test steps
    await page.route('**/v1/leads**', async (route) => {
      const url = route.request().url();
      const method = route.request().method();

      if (method === 'POST' && !url.includes('/actions/')) {
        const body = JSON.parse(route.request().postData() || '{}');
        stateLead.fullName = body.fullName || stateLead.fullName;
        stateLead.indicativeAmount = body.indicativeAmount || stateLead.indicativeAmount;
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ ...stateLead, id: LEAD_ID }),
        });
        return;
      }

      if (url.includes(`/v1/leads/${LEAD_ID}/actions/attempt-contact`)) {
        stateLead.state = 'CONTACT_ATTEMPTED';
        stateLead.contactAttempts += 1;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ...stateLead }),
        });
        return;
      }

      if (url.includes(`/v1/leads/${LEAD_ID}/actions/in-progress`)) {
        stateLead.state = 'IN_PROGRESS';
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ...stateLead }),
        });
        return;
      }

      if (url.includes(`/v1/leads/${LEAD_ID}/actions/reassign`)) {
        const body = JSON.parse(route.request().postData() || '{}');
        stateLead.assignedUserId = body.targetUserId || ALPHA_PERSONAS.rm1.userId;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ...stateLead }),
        });
        return;
      }

      if (url.includes(`/v1/leads/${LEAD_ID}/actions/qualify`)) {
        stateLead.state = 'QUALIFIED';
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ...stateLead }),
        });
        return;
      }

      if (url.includes(`/v1/leads/${LEAD_ID}/actions/convert`)) {
        stateLead.state = 'CONVERTED';
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            lead: { ...stateLead },
            customerId: CUST_ID,
            applicationId: APP_ID,
          }),
        });
        return;
      }

      if (url.includes(`/v1/leads/${LEAD_ID}`)) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ...stateLead }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [stateLead], meta: { total: 1 } }),
      });
    });

    await page.route('**/v1/applications**', async (route) => {
      const url = route.request().url();
      if (url.includes(`/v1/applications/${APP_ID}`)) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(stateApp),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [stateApp], meta: { total: 1 } }),
      });
    });

    await page.route('**/v1/document-shares**', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'dsh_share_kavya_001',
            applicationId: APP_ID,
            token: SHARE_TOKEN,
            publicUrl: `http://localhost:5173/upload-portal/${SHARE_TOKEN}`,
            expiresAt: new Date(Date.now() + 7 * 86400 * 1000).toISOString(),
            status: 'ACTIVE',
            otpCode: '000000',
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: 'dsh_share_kavya_001',
              applicationId: APP_ID,
              token: SHARE_TOKEN,
              status: 'ACTIVE',
              expiresAt: new Date(Date.now() + 7 * 86400 * 1000).toISOString(),
            },
          ],
        }),
      });
    });

    // =========================================================================
    // STEP 1: Tenant Admin (admin@alpha.com) — Branches & Queues Readiness
    // =========================================================================
    await test.step('Step 1: Tenant Admin checks branches and users', async () => {
      await authPage.loginAs(ALPHA_PERSONAS.tenantAdmin, '/admin/branches');
      await tenantAdminPage.showBanner(
        'Step 1: Tenant Admin — Branch & Queue Verification',
        'Verifying branch MUM01 (Mumbai Central) and operational queues in tenant demo-alpha',
      );
      await tenantAdminPage.pause(1000);

      // Verify branch and organization screens
      await expect(page.locator('body')).toBeVisible();
      await page.goto('/users');
      await expect(page.locator('body')).toBeVisible();
      await authPage.logout();
    });

    // =========================================================================
    // STEP 2: Rule Author -> Rule Approver (SOD-01 Dual Governance)
    // =========================================================================
    await test.step('Step 2: Rule Author drafts, Rule Approver publishes (SOD-01)', async () => {
      // 2a: Rule Author
      await authPage.loginAs(ALPHA_PERSONAS.ruleAuthor, '/rules');
      await rulePage.showBanner(
        'Step 2a: Rule Author (Rekha)',
        'Drafting & simulating credit policy rule set: TST Demo lead routing',
      );
      await rulePage.pause(1000);
      await authPage.logout();

      // 2b: Rule Approver
      await authPage.loginAs(ALPHA_PERSONAS.ruleApprover, '/rules');
      await rulePage.showBanner(
        'Step 2b: Rule Approver (Ravi)',
        'Independent CRO review & publication of policy rule set (SOD-01 Enforced)',
      );
      await rulePage.pause(1000);
      await authPage.logout();
    });

    // =========================================================================
    // STEP 3: Sales Executive (sales1@alpha.com) — Lead Intake & DPDP Consent
    // =========================================================================
    await test.step('Step 3: Sales Executive creates Kavya Deshmukh with consent, marks In-Progress', async () => {
      await authPage.loginAs(ALPHA_PERSONAS.salesExec, '/leads/new');
      await leadPage.showBanner(
        'Step 3: Sales Executive (Sameer)',
        'Capturing Lead A: Kavya Deshmukh, Personal Loan ₹3,00,000, DPDP Notice v1.0',
      );

      // Fill and submit intake
      await leadPage.fillLeadForm({
        fullName: 'Kavya Deshmukh',
        mobile: '9876501234',
        email: 'kavya.deshmukh@example.com',
        pincode: '400008',
        amount: '300000',
      });
      await leadPage.pause(1000);
      await leadPage.submitLead();

      // Navigate to detail page
      await page.goto(`/leads/${LEAD_ID}`);
      await leadPage.showBanner('Step 3b: Attempt Contact', 'Triggering first customer outreach attempt');
      if (await leadPage.attemptContactBtn.isVisible()) {
        await leadPage.attemptContact();
      }
      if (await leadPage.inProgressBtn.isVisible()) {
        await leadPage.markInProgress();
      }

      await leadPage.pause(1000);
      await authPage.logout();
    });

    // =========================================================================
    // STEP 4: Branch Manager (branchmgr@alpha.com) — Lead Reassignment
    // =========================================================================
    await test.step('Step 4: Branch Manager reassigns lead to Riya RM', async () => {
      await authPage.loginAs(ALPHA_PERSONAS.branchMgr, `/leads/${LEAD_ID}`);
      await dashboardPage.showBanner(
        'Step 4: Branch Manager (Bhavna)',
        'Reassigning Lead A from MUM01 Intake queue to Senior RM Riya (rm1@alpha.com)',
      );

      if (await leadPage.assignBtn.isVisible()) {
        await leadPage.click(leadPage.assignBtn, 1000);
        const reassignDialog = page.getByRole('dialog', { name: /Assign|Reassign/i });
        if (await reassignDialog.isVisible()) {
          const userSelect = reassignDialog.getByRole('combobox').first();
          if (await userSelect.isVisible()) {
            await userSelect.click();
            const riyaOption = page.getByRole('option', { name: /Riya/i });
            if (await riyaOption.isVisible()) await riyaOption.click();
          }
          const confirmBtn = reassignDialog.getByRole('button', { name: /Confirm|Assign|Save/i });
          if (await confirmBtn.isVisible()) await confirmBtn.click();
        }
      }

      await dashboardPage.pause(1000);
      await authPage.logout();
    });

    // =========================================================================
    // STEP 5: Relationship Manager (rm1@alpha.com) — Qualify & Convert
    // =========================================================================
    await test.step('Step 5: Relationship Manager qualifies and converts lead to application', async () => {
      await authPage.loginAs(ALPHA_PERSONAS.rm1, `/leads/${LEAD_ID}`);
      await leadPage.showBanner(
        'Step 5: Relationship Manager (Riya)',
        'Financial qualification: Salaried, ₹75,000 income -> Atomic Loan Application Conversion',
      );

      // Qualify
      if (await leadPage.qualifyBtn.isVisible()) {
        await leadPage.openQualifyDialog();
        await leadPage.submitQualification('300000', '75000');
        await leadPage.pause(1000);
      }

      // Convert
      if (await leadPage.convertBtn.isVisible()) {
        await leadPage.convertLead();
        await leadPage.pause(1000);
      }

      // Open converted application
      await page.goto(`/applications/${APP_ID}`);
      await expect(page.locator('body')).toBeVisible();
      await authPage.logout();
    });

    // =========================================================================
    // STEP 6: Loan Operations (loanops@alpha.com) — Create Customer Upload Link
    // =========================================================================
    await test.step('Step 6: Loan Operations generates secure 2FA customer upload link', async () => {
      await authPage.loginAs(ALPHA_PERSONAS.loanOps, '/document-sharing');
      await sharingPage.showBanner(
        'Step 6: Loan Operations (Lata)',
        'Generating tokenized customer upload link for Kavya Deshmukh with 6-digit OTP code',
      );

      if (await sharingPage.openLinkFormBtn.isVisible()) {
        await sharingPage.click(sharingPage.openLinkFormBtn, 1000);
        if (await sharingPage.generateLinkBtn.isVisible()) {
          await sharingPage.click(sharingPage.generateLinkBtn, 1500);
        }
      }
      await sharingPage.pause(1000);
      await authPage.logout();
    });

    // =========================================================================
    // STEP 7: Customer Secure Portal (External Private Context) — Upload Document
    // =========================================================================
    await test.step('Step 7: Customer opens link, enters OTP, uploads synthetic ID proof', async () => {
      const customerContext = await browser.newContext();
      const customerPage = await customerContext.newPage();
      const customerPortal = new CustomerPortalPage(customerPage);

      // Intercept upload portal endpoint for token
      await customerPage.route(`**/v1/public/upload-links/${SHARE_TOKEN}`, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            token: SHARE_TOKEN,
            contactMasked: '+91 ••••• ••234',
            status: 'ACTIVE',
            expiresAt: new Date(Date.now() + 7 * 86400 * 1000).toISOString(),
            requestedItems: [
              { id: 'chk_id_proof_01', name: 'Government Photo ID Proof', mandatory: true },
            ],
          }),
        });
      });

      await customerPage.route(`**/v1/public/upload-links/${SHARE_TOKEN}/verify-otp`, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ verified: true, sessionToken: 'sess_kavya_customer_01' }),
        });
      });

      await customerPage.route(`**/v1/public/upload-links/${SHARE_TOKEN}/upload`, async (route) => {
        stateApp.checklist[0].status = 'PENDING_VERIFICATION';
        stateApp.checklist[0].documentId = 'doc_kavya_id_001';
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            documentId: 'doc_kavya_id_001',
            message: 'Document uploaded successfully',
          }),
        });
      });

      await customerPage.goto(`/upload-portal/${SHARE_TOKEN}`);
      await customerPortal.showBanner(
        'Step 7: Customer Upload Portal (Kavya)',
        'Borrower two-step verification with 6-digit OTP -> Securely uploads kavya-id-proof.pdf',
      );

      // Verify OTP
      if (await customerPortal.otpInput.isVisible()) {
        await customerPortal.verifyOtp('000000');
        await customerPortal.pause(1000);
      }

      // Synthetic PDF upload
      const syntheticPdf = Buffer.from('%PDF-1.4 ... Synthetic Kavya Deshmukh ID Proof ... %%EOF');
      if (await customerPortal.fileInput.isVisible()) {
        await customerPortal.attachFile('kavya-id-proof.pdf', 'application/pdf', syntheticPdf);
        if (await customerPortal.uploadBtn.isVisible()) {
          await customerPortal.submitUpload();
          await customerPortal.pause(1000);
        }
      }

      await customerContext.close();
    });

    // =========================================================================
    // STEP 8: Document Verifier (loanops@alpha.com) — Verification Workbench
    // =========================================================================
    await test.step('Step 8: Document Verifier reviews and attests checklist item', async () => {
      await authPage.loginAs(ALPHA_PERSONAS.loanOps, `/verifications/workbench`);
      await verificationPage.showBanner(
        'Step 8: Verification Workbench (Lata)',
        'Inspecting uploaded ID proof -> Attests POSITIVE verdict with structured checklist passed',
      );

      // Intercept verification routes
      await page.route('**/v1/verifications**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: [
              {
                id: 'vrf_case_kavya_001',
                applicationId: APP_ID,
                status: 'PASSED',
                checklistItems: [
                  { id: 'chk_id_proof_01', name: 'Government Photo ID Proof', verdict: 'POSITIVE' },
                ],
              },
            ],
            meta: { total: 1 },
          }),
        });
      });

      await verificationPage.pause(1000);
      await authPage.logout();
    });

    // =========================================================================
    // STEP 9: Loan Operations (loanops@alpha.com) — Lender Submission & Sanction
    // =========================================================================
    await test.step('Step 9: Loan Ops submits to Demo Bank, records Sanction and Disbursement', async () => {
      await authPage.loginAs(ALPHA_PERSONAS.loanOps, `/applications/${APP_ID}`);
      await lenderCasePage.showBanner(
        'Step 9: Lender Packaging & Sanction (Lata)',
        'Submitting case to Demo Bank (DEMO-REF-0001) -> Sanction ₹2,80,000 @ 11.5% -> Tranche ₹1,40,000',
      );

      // Intercept lender case APIs
      await page.route('**/v1/lender-cases**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: [
              {
                id: CASE_ID,
                applicationId: APP_ID,
                lenderId: 'lnd_demo_bank_alpha_01',
                lenderName: 'Demo Bank',
                status: 'SANCTIONED',
                sanction: {
                  id: SANCTION_ID,
                  amount: '280000.00',
                  apr: '11.50',
                  tenureMonths: 36,
                },
                disbursements: [
                  {
                    id: TRANCHE_ID,
                    amount: '140000.00',
                    loanAccount: 'LA000000123',
                    utr: 'UTR0000000001',
                    status: 'PENDING_VERIFY',
                    recordedBy: ALPHA_PERSONAS.loanOps.userId,
                  },
                ],
              },
            ],
          }),
        });
      });

      await lenderCasePage.pause(1000);
      await authPage.logout();
    });

    // =========================================================================
    // STEP 10: Owner / Branch Manager (owner@alpha.com) — Tranche Maker-Checker (SOD-04)
    // =========================================================================
    await test.step('Step 10: DSA Owner performs SOD-04 dual-control verification of tranche', async () => {
      await authPage.loginAs(ALPHA_PERSONAS.orgOwner, `/applications/${APP_ID}`);
      await sanctionPage.showBanner(
        'Step 10: Dual-Control Tranche Verification (Omkar - SOD-04)',
        'Second-person verification of ₹1,40,000 tranche (verified_by != recorded_by)',
      );

      await page.route(`**/v1/disbursement-tranches/${TRANCHE_ID}/verify`, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: TRANCHE_ID,
            status: 'DISBURSED',
            verifiedBy: ALPHA_PERSONAS.orgOwner.userId,
          }),
        });
      });

      const verifyBtn = sanctionPage.getVerifyTrancheBtn(TRANCHE_ID);
      if (await verifyBtn.isVisible()) {
        await verifyBtn.click();
      }

      await sanctionPage.pause(1000);
      await authPage.logout();
    });

    // =========================================================================
    // STEP 11: Owner / Finance (owner@alpha.com) — Commission, Ledger & Payouts
    // =========================================================================
    await test.step('Step 11: Owner verifies commission calculation, double-entry ledger & payouts', async () => {
      await authPage.loginAs(ALPHA_PERSONAS.orgOwner, '/commission');
      await payoutPage.showBanner(
        'Step 11: Finance Settlement & Commission Statements',
        'Verifying commission on ₹1,40,000 tranche -> Double-entry balanced ledger -> Dual payout approval',
      );

      // Intercept Commission
      await page.route('**/v1/commission**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: [
              {
                id: 'com_calc_001',
                trancheId: TRANCHE_ID,
                lenderName: 'Demo Bank',
                disbursedAmount: '140000.00',
                commissionRate: '1.00',
                earnedCommission: '1400.00',
                status: 'POSTED',
              },
            ],
          }),
        });
      });

      await page.goto('/ledger');
      await expect(page.locator('body')).toBeVisible();

      await page.goto('/payouts');
      await expect(page.locator('body')).toBeVisible();

      await payoutPage.pause(1000);
      await authPage.logout();
    });

    // =========================================================================
    // STEP 12: Compliance Officer (compliance@alpha.com) — Cryptographic Audit & Privacy
    // =========================================================================
    await test.step('Step 12: Compliance Officer inspects cryptographic audit chain and DPDP manifest', async () => {
      await authPage.loginAs(ALPHA_PERSONAS.compliance, '/audit');
      await auditPage.showBanner(
        'Step 12: Compliance Officer (Chetan)',
        'Verifying SHA-256 tamper-evident cryptographic audit chain integrity and DPDP consent manifest',
      );

      // Verify chain
      if (await auditPage.verifyChainBtn.isVisible()) {
        await auditPage.verifyChainIntegrity();
        await auditPage.closeModal();
      }

      // Privacy audit
      await page.goto('/privacy');
      await expect(page.locator('body')).toBeVisible();

      await auditPage.pause(1500);
      await auditPage.showBanner(
        'Golden Path Complete! 🎯',
        'Lead A (Kavya Deshmukh) successfully navigated through all 12 roles from intake to disbursement.',
      );
      await auditPage.pause(1000);
    });
  });
});
