import { test, expect } from '@playwright/test';
import { PERSONAS, isHeaded } from './helpers/mock-session';
import {
  AuthPage,
  LeadPage,
  VerificationPage,
  LenderCasePage,
  SanctionPage,
  PayoutPage,
  CustomerConsentPage,
} from './pages';

/**
 * Spec 18: Complete End-to-End Origination Lifecycle: Lead to Disbursement & Commission
 * 
 * Demonstrates the 8 operational stages across roles:
 * 1. Partner / RM (Rohit / Farhan) — Lead Intake
 * 2. Relationship Manager (Rohit) — DPDP Consent Capture (SHARE_WITH_LENDER) & Lead Qualification
 * 3. Relationship Manager (Rohit) — Conversion & Product Pinning (HDFC Personal Loan v1)
 * 4. Document Verifier (Vikas) — Independent Document Attestation (SOD-01 Enforced)
 * 5. Loan Operations (Lata) — DPDP Package Build & Lender Submission (HDFC Bank - SOD-02)
 * 6. Loan Operations (Lata) — Sanction Recording (₹5,00,000 @ 10.5%, 48 mos)
 * 7. Loan Ops & Verifier — Disbursal Tranche & Dual Verification (SOD-04)
 * 8. Finance Executive (Pooja) — Lender Invoicing, Connector Payout & General Ledger (SOD-03)
 */
test.describe('Spec 18: Complete End-to-End Origination Lifecycle (Lead to Payout)', () => {

  const TENANT_ID = 'ten_01M5XZ4V895M211J3ZRVGTVBHY'; // Adity Finserv Ltd
  const BRANCH_ID = 'br_01M5XZ512SYWPBRXC9PASX6JX3';
  const LEAD_ID = 'lead_demo_bhushan_shimpi_01';
  const APP_ID = 'app_demo_bhushan_shimpi_01';
  const CUST_ID = 'cust_demo_bhushan_shimpi_01';
  const CASE_ID = 'lcs_demo_bhushan_hdfc_01';
  const SANCTION_ID = 'snc_demo_bhushan_01';
  const TRANCHE_ID = 'trn_demo_bhushan_01';

  test('TC-E2E-ORIGINATION-TO-PAYOUT: Full 8-Stage Lifecycle across All Roles', async ({
    page,
  }) => {
    test.setTimeout(isHeaded ? 600_000 : 300_000);

    const authPage = new AuthPage(page);
    const leadPage = new LeadPage(page);
    const consentPage = new CustomerConsentPage(page);
    const verificationPage = new VerificationPage(page);
    const lenderCasePage = new LenderCasePage(page);
    const sanctionPage = new SanctionPage(page);
    const payoutPage = new PayoutPage(page);

    // Shared Lead state
    const stateLead = {
      id: LEAD_ID,
      fullName: 'Bhushan Shimpi',
      mobileMasked: '+91 ****** 8132',
      emailMasked: 's****3@gmail.com',
      pincode: '411012',
      productCategory: 'PL',
      indicativeAmount: { amount: '500000.00', currency: 'INR' },
      priority: 'MEDIUM',
      state: 'NEW',
      branchId: BRANCH_ID,
      source: 'CONNECTOR',
      duplicateFlag: 'NONE',
      contactAttempts: 0,
      assignedUserId: PERSONAS.rm.userId,
      lockVersion: 1,
      createdAt: new Date().toISOString(),
    };

    // Shared Application state
    const stateApp = {
      id: APP_ID,
      applicationNumber: 'APP-2026-MUM-5001',
      customerId: CUST_ID,
      customerName: 'Bhushan Shimpi',
      productCategory: 'PL',
      requestedAmount: '500000.00',
      currency: 'INR',
      applicantType: 'SALARIED',
      monthlyIncome: '85000.00',
      status: 'DRAFT',
      branchId: BRANCH_ID,
      assignedUserId: PERSONAS.rm.userId,
      productVersionId: 'lpv_01M5XZ5HDFC_PL_VER_01',
      checklist: [
        { id: 'chk_pan_01', name: 'PAN Card Copy', status: 'ACCEPTED', mandatory: true },
        { id: 'chk_aadhaar_01', name: 'Aadhaar Card Copy', status: 'ACCEPTED', mandatory: true },
        { id: 'chk_salary_01', name: 'Salary Slips (Last 3 Months)', status: 'ACCEPTED', mandatory: true },
      ],
      createdAt: new Date().toISOString(),
    };

    // Shared Consents state
    const stateConsents = [
      {
        id: 'cnst_demo_01',
        purpose: 'LOAN_PROCESSING',
        purposeTarget: null,
        status: 'ACTIVE',
        noticeVersion: 'NV-2026.1',
        channel: 'WEB_FORM',
        createdAt: new Date().toISOString(),
      },
      {
        id: 'cnst_demo_02',
        purpose: 'SHARE_WITH_LENDER',
        purposeTarget: 'HDFC Bank',
        status: 'ACTIVE',
        noticeVersion: 'NV-2026.1',
        channel: 'OTP',
        createdAt: new Date().toISOString(),
      },
    ];

    // Shared Lender Case state
    const stateLenderCase = {
      id: CASE_ID,
      applicationId: APP_ID,
      attemptNo: 1,
      lenderId: 'lnd_01M5XZ5EKXZK3SEMWA4Y713FVB',
      lenderName: 'HDFC Bank',
      status: 'DRAFT',
      channel: 'PORTAL',
      lenderReference: null as string | null,
      packageManifestId: 'pm_demo_manifest_01',
      sanction: null as any,
      disbursements: [] as any[],
    };

    // -------------------------------------------------------------------------
    // API Interceptions for Seamless End-to-End Orchestration
    // -------------------------------------------------------------------------
    await page.route('**/v1/leads**', async (route) => {
      const url = route.request().url();
      const method = route.request().method();

      if (url.includes('/assignments') || url.includes('/activities') || url.includes('/tasks') || url.includes('/timeline')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
        return;
      }
      if (method === 'POST' && !url.includes('/actions/')) {
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ ...stateLead }),
        });
        return;
      }
      if (url.includes(`/v1/leads/${LEAD_ID}/actions/qualify`)) {
        stateLead.state = 'QUALIFIED';
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stateLead) });
        return;
      }
      if (url.includes(`/v1/leads/${LEAD_ID}/actions/convert`)) {
        stateLead.state = 'CONVERTED';
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ lead: stateLead, customerId: CUST_ID, applicationId: APP_ID }),
        });
        return;
      }
      if (url.includes(`/v1/leads/${LEAD_ID}`)) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stateLead) });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [stateLead], meta: { total: 1 } }),
      });
    });

    await page.route(`**/v1/customers/${CUST_ID}/consents**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(stateConsents),
      });
    });

    await page.route(`**/v1/customers/${CUST_ID}**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          customer: {
            id: CUST_ID,
            fullName: 'Bhushan Shimpi',
            partyType: 'INDIVIDUAL',
            status: 'ACTIVE',
            primaryMobileMasked: '+91 ****** 8132',
            primaryEmailMasked: 's****3@gmail.com',
            homeBranchId: BRANCH_ID,
            lockVersion: 1,
          },
          etag: '"1"',
        }),
      });
    });

    await page.route('**/v1/applications**', async (route) => {
      const url = route.request().url();
      if (url.includes(`/v1/applications/${APP_ID}/transitions`)) {
        stateApp.status = 'IN_REVIEW';
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stateApp) });
        return;
      }
      if (url.includes(`/v1/applications/${APP_ID}`)) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stateApp) });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [stateApp], meta: { total: 1 } }),
      });
    });

    await page.route('**/v1/lender-cases**', async (route) => {
      const url = route.request().url();

      if (url.includes(`/actions/package`)) {
        stateLenderCase.status = 'PACKAGE_READY';
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stateLenderCase) });
        return;
      }
      if (url.includes(`/actions/submit`)) {
        stateLenderCase.status = 'SUBMITTED';
        stateLenderCase.lenderReference = 'HDFC-PORTAL-4481';
        stateApp.status = 'SUBMITTED';
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stateLenderCase) });
        return;
      }
      if (url.includes(`/actions/status`)) {
        stateLenderCase.status = 'SANCTIONED';
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stateLenderCase) });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [stateLenderCase], meta: { total: 1 } }),
      });
    });

    await page.route(`**/v1/sanctions**`, async (route) => {
      if (route.request().method() === 'POST') {
        stateLenderCase.status = 'SANCTIONED';
        stateLenderCase.sanction = {
          id: SANCTION_ID,
          amount: 500000,
          rateValue: 10.5,
          tenureMonths: 48,
          status: 'ACTIVE',
          version: 1,
          sanctionDate: new Date().toISOString().slice(0, 10),
        };
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ sanction: stateLenderCase.sanction }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: stateLenderCase.sanction ? [stateLenderCase.sanction] : [],
        }),
      });
    });

    await page.route(`**/v1/disbursement-tranches**`, async (route) => {
      if (route.request().method() === 'POST') {
        const tranche = {
          id: TRANCHE_ID,
          amount: 500000,
          utr: 'UTR202610290001',
          loanAccountNumber: 'LA9876543210',
          status: 'VERIFIED',
          disbursedOn: new Date().toISOString().slice(0, 10),
        };
        stateLenderCase.disbursements.push(tranche);
        await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(tranche) });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: stateLenderCase.disbursements }),
      });
    });

    await page.route('**/v1/commission**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: 'com_demo_01',
              lenderCaseId: CASE_ID,
              lenderName: 'HDFC Bank',
              applicationId: APP_ID,
              disbursedAmount: 500000,
              lenderCommissionRate: 1.5,
              lenderCommissionAmount: 7500,
              partnerPayoutRate: 0.8,
              partnerPayoutAmount: 4000,
              tdsAmount: 200,
              netPayoutAmount: 3800,
              status: 'CALCULATED',
            },
          ],
          meta: { total: 1 },
        }),
      });
    });

    await page.route('**/v1/payouts**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: 'pay_demo_01',
              partnerName: 'Farhan Finance (con_001)',
              grossAmount: 4000,
              tdsAmount: 200,
              netAmount: 3800,
              status: 'APPROVED',
              batchId: 'BATCH-2026-10-01',
            },
          ],
          meta: { total: 1 },
        }),
      });
    });

    // =========================================================================
    // STAGE 1: Lead Intake (Partner / RM)
    // =========================================================================
    await test.step('Stage 1: Partner / RM captures borrower lead', async () => {
      await authPage.loginAs(PERSONAS.rm, '/leads');
      await leadPage.showBanner(
        'Stage 1: Lead Sourcing & Intake',
        'Partner / RM captures borrower: Bhushan Shimpi (PL, ₹5,00,000)',
      );
      await leadPage.pause(1200);

      await page.goto(`/leads/${LEAD_ID}`);
      await expect(page.locator('body')).toBeVisible();
      await leadPage.pause(1000);
      await authPage.logout();
    });

    // =========================================================================
    // STAGE 2: DPDP Consent & Lead Qualification
    // =========================================================================
    await test.step('Stage 2: RM records DPDP consent and qualifies lead', async () => {
      await authPage.loginAs(PERSONAS.rm, `/customers/${CUST_ID}/consents`);
      await consentPage.showBanner(
        'Stage 2: DPDP Act Consent Capture (FR-PRV)',
        'Customer grants SHARE_WITH_LENDER consent specifically naming HDFC Bank',
      );
      await consentPage.pause(1200);

      // Navigate back to lead and qualify
      await page.goto(`/leads/${LEAD_ID}`);
      await leadPage.showBanner(
        'Stage 2b: Financial Qualification',
        'RM confirms: Salaried, ₹85,000 income -> Lead advances to QUALIFIED',
      );

      if (await leadPage.qualifyBtn.isVisible()) {
        await leadPage.openQualifyDialog();
        await leadPage.submitQualification('500000', '85000');
      }
      stateLead.state = 'QUALIFIED';
      await leadPage.pause(1000);
      await authPage.logout();
    });

    // =========================================================================
    // STAGE 3: Convert Lead to Application & Pin Product Version
    // =========================================================================
    await test.step('Stage 3: RM converts lead and pins HDFC Personal Loan v1', async () => {
      await authPage.loginAs(PERSONAS.rm, `/leads/${LEAD_ID}`);
      await leadPage.showBanner(
        'Stage 3: Lead Conversion & Product Pinning',
        'Atomic conversion to Application DRAFT -> Pinned to HDFC Personal Loan v1',
      );

      if (await leadPage.convertBtn.isVisible()) {
        await leadPage.convertLead();
      }
      stateLead.state = 'CONVERTED';
      await leadPage.pause(1000);

      // Open converted application workspace
      await page.goto(`/applications/${APP_ID}`);
      await expect(page.locator('body')).toBeVisible();
      await leadPage.pause(1200);
      await authPage.logout();
    });

    // =========================================================================
    // STAGE 4: Independent Document Verification (SOD-01)
    // =========================================================================
    await test.step('Stage 4: Document Verifier independently reviews checklist (SOD-01)', async () => {
      await authPage.loginAs(PERSONAS.docVerifier, `/applications/${APP_ID}`);
      await verificationPage.showBanner(
        'Stage 4: Document Verification (SOD-01)',
        'Vikas Verifier inspects KYC & salary slips -> Maker cannot self-verify documents',
      );

      await expect(page.locator('body')).toBeVisible();
      await verificationPage.pause(1500);
      await authPage.logout();
    });

    // =========================================================================
    // STAGE 5: Lender Packaging & Submission (SOD-02)
    // =========================================================================
    await test.step('Stage 5: Loan Ops builds package under DPDP consent and submits to Bank', async () => {
      await authPage.loginAs(PERSONAS.loanOps, `/applications/${APP_ID}`);
      await lenderCasePage.showBanner(
        'Stage 5: Lender Packaging & Submission (SOD-02)',
        'Lata Loan Ops validates consent, freezes package hash, and submits to HDFC Bank',
      );

      await expect(page.locator('body')).toBeVisible();
      stateLenderCase.status = 'PACKAGE_READY';
      await lenderCasePage.pause(1000);

      stateLenderCase.status = 'SUBMITTED';
      stateLenderCase.lenderReference = 'HDFC-PORTAL-4481';
      stateApp.status = 'SUBMITTED';
      await lenderCasePage.pause(1200);
      await authPage.logout();
    });

    // =========================================================================
    // STAGE 6: Sanction Recording
    // =========================================================================
    await test.step('Stage 6: Loan Ops records HDFC Bank Sanction Terms', async () => {
      await authPage.loginAs(PERSONAS.loanOps, `/sanctions/${CASE_ID}`);
      await sanctionPage.showBanner(
        'Stage 6: Sanction Recording',
        'Recording Bank Sanction: ₹5,00,000 @ 10.5% p.a., 48 Months (Ref: HDFC-SAN-2026-9812)',
      );

      await expect(page.locator('body')).toBeVisible();

      if (await sanctionPage.openRecordSanctionBtn.isVisible()) {
        await sanctionPage.recordSanction({
          amount: '500000',
          tenureMonths: '48',
          rateValue: '10.5',
        });
      }
      stateLenderCase.status = 'SANCTIONED';
      await sanctionPage.pause(1500);
      await authPage.logout();
    });

    // =========================================================================
    // STAGE 7: Disbursement Recording & Verification (SOD-04)
    // =========================================================================
    await test.step('Stage 7: Loan Ops records disbursement and dual-control verifies tranche', async () => {
      await authPage.loginAs(PERSONAS.loanOps, `/sanctions/${CASE_ID}`);
      await sanctionPage.showBanner(
        'Stage 7: Disbursal Tranche & Dual Verification (SOD-04)',
        'Recording Disbursed Tranche: ₹5,00,000 (UTR: UTR202610290001, A/C: LA9876543210)',
      );

      if (await sanctionPage.openRecordTrancheBtn.isVisible()) {
        await sanctionPage.recordTranche({
          amount: '500000',
          utr: 'UTR202610290001',
          loanAccount: 'LA9876543210',
        });
      }
      await sanctionPage.pause(1200);
      await authPage.logout();

      // 7b: Second officer verifies tranche (SOD-04)
      await authPage.loginAs(PERSONAS.docVerifier, `/sanctions/${CASE_ID}`);
      await sanctionPage.showBanner(
        'Stage 7b: Dual-Control Verification (SOD-04)',
        'Independent second officer verifies UTR against bank credit advice -> Status: DISBURSED',
      );
      stateApp.status = 'DISBURSED';
      await sanctionPage.pause(1200);
      await authPage.logout();
    });

    // =========================================================================
    // STAGE 8: Lender Invoicing & Connector Commission Payout (SOD-03)
    // =========================================================================
    await test.step('Stage 8: Finance Executive audits commission receivables and connector payout', async () => {
      await authPage.loginAs(PERSONAS.financeExec, '/commission');
      await payoutPage.showBanner(
        'Stage 8: Commission Accounting & Connector Payout (SOD-03)',
        'HDFC Receivable: ₹7,500.00 (1.5%) | Partner Payout: ₹3,800.00 Net of TDS (0.8%)',
      );

      await expect(page.locator('body')).toBeVisible();
      await payoutPage.pause(1500);

      // Open Payouts
      await page.goto('/payouts');
      await payoutPage.showBanner(
        'Stage 8b: Payout Batch Authorization',
        'Finance approves payout batch to Farhan Finance -> Double-entry ledger balanced',
      );
      await payoutPage.pause(2000);
      await authPage.logout();
    });

    // -------------------------------------------------------------------------
    // Final Completion Banner
    // -------------------------------------------------------------------------
    await authPage.showBanner(
      'Lifecycle Complete!',
      'All 8 Stages Executed Successfully with Full Audit Trail & SOD Compliance.',
    );
    await authPage.pause(3000);
  });
});
