import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { ADITYA_PERSONAS, isHeaded } from './helpers/mock-session';
import {
  AuthPage,
  LeadPage,
  ManagerDashboardPage,
  DocumentSharingPage,
  CustomerPortalPage,
  VerificationPage,
  SanctionPage,
  PayoutPage,
  AuditPage,
} from './pages';

/**
 * Spec 19: Adity Finserv Origination-to-Payout Master Demonstration Suite
 *
 * Demonstrates the single unbroken end-to-end operational lifecycle for Adity Finserv Private Limited
 * with active credentials under the @adityfinserv.com domain, featuring male borrower Rahul Sharma:
 *
 * Stage 1:  Sales Intake Executive (sales@adityfinserv.com / Admin@123)
 *           - Field intake for borrower Rahul Sharma (₹3,00,000 Personal Loan, Mumbai Central)
 *           - DPDP consent record & lifecycle advance: NEW -> CONTACT_ATTEMPTED -> IN_PROGRESS
 *           - Follow-up document task creation
 * Stage 2:  Branch Manager Mumbai (branchmgr@adityfinserv.com / Admin@123)
 *           - Supervises MUM01 branch intake queue & pipeline distribution
 * Stage 3:  Relationship Manager 1 (rm1@adityfinserv.com / Admin@123)
 *           - Duplicate check validation (Zero conflicts)
 *           - Credit qualification: ₹75,000 monthly income, ₹3,00,000 approved, 36 months tenure
 *           - Atomic conversion to Master Customer (cus_demo_rahul_001) & Loan Application (app_aditya_rahul_001)
 * Stage 4:  Loan Operations Officer (loanops@adityfinserv.com / Admin@123)
 *           - Generation of secure 2FA customer upload link with 7-day TTL
 * Stage 5:  External Customer Secure Portal (Borrower Rahul Sharma)
 *           - Mobile 2FA verification (+91 ******3210, code 000000 / 123456)
 *           - Encrypted KYC document upload (rahul_pan_card.pdf with SHA-256 integrity hash)
 * Stage 6:  Document Verifier (verifier@adityfinserv.com / Admin@123)
 *           - KYC attestation on Workbench (SOD-01): PAN Card marked ACCEPTED
 *           - Assessment finalization with POSITIVE verdict
 * Stage 7:  Loan Operations Officer (loanops@adityfinserv.com / Admin@123)
 *           - Sanction terms entry: ₹2,80,000 @ 11.5% fixed rate, 36 months
 *           - Disbursement Tranche #1 entry: ₹1,40,000 (UTR-ADITYA-20261119-001)
 * Stage 8:  Branch Manager Mumbai (branchmgr@adityfinserv.com / Admin@123)
 *           - SOD-04 Dual-Control Maker-Checker disbursal verification
 * Stage 9:  Finance Executive (finance@adityfinserv.com / Admin@123)
 *           - Commission calculation: 1.0% on ₹1,40,000 = ₹1,400.00
 *           - Payout request generation (SOD-03 Maker)
 * Stage 10: Commission Approver (commission@adityfinserv.com / Admin@123)
 *           - SOD-03 Dual-Control payout review & authorization
 * Stage 11: Compliance Officer (compliance@adityfinserv.com / Admin@123)
 *           - Cryptographic SHA-256 Merkle chain verification & evidence pack export
 */
test.describe('Adity Finserv Origination-to-Payout Demonstration Suite', () => {
  const TENANT_ID = 'ten_01M5XZ4V895M211J3ZRVGTVBHY';
  const TENANT_SLUG = 'adity-finserv';
  const LEAD_ID = 'led_aditya_rahul_001';
  const APP_ID = 'app_aditya_rahul_001';
  const CUST_ID = 'cus_demo_rahul_001';
  const SHARE_TOKEN = 'tok_secure_rahul_demo_01';
  const CASE_ID = 'lcs_case_rahul_001';
  const SANCTION_ID = 'snc_aditya_rahul_001';
  const TRANCHE_ID = 'trn_aditya_rahul_001';
  const VRF_CASE_ID = 'vrf_case_rahul_001';
  const PAYOUT_ID = 'pay_req_aditya_rahul_001';
  const STANDARD_PASSWORD = 'Admin@123';
  const DOWNLOADS_ADHAR = 'C:/Users/Bhush/Downloads/Adhar card.pdf';
  const FIXTURE_ADHAR = path.resolve('e2e/fixtures/Adhar card.pdf');
  const adharCardPath = fs.existsSync(DOWNLOADS_ADHAR) ? DOWNLOADS_ADHAR : FIXTURE_ADHAR;
  const adharCardBuffer = fs.readFileSync(adharCardPath);

  test('TC-ADITYA-FULL-01: End-to-End Origination to Payout Lifecycle for Rahul Sharma', async ({
    page,
    browser,
  }) => {
    test.setTimeout(isHeaded ? 600_000 : 300_000);

    const authPage = new AuthPage(page);
    const leadPage = new LeadPage(page);
    const dashboardPage = new ManagerDashboardPage(page);
    const sharingPage = new DocumentSharingPage(page);
    const vrfPage = new VerificationPage(page);
    const sanctionPage = new SanctionPage(page);
    const payoutPage = new PayoutPage(page);
    const auditPage = new AuditPage(page);

    // Shared mock state for Rahul Sharma's loan origination
    const mockLead = {
      id: LEAD_ID,
      fullName: 'Rahul Sharma',
      mobileMasked: '+91 ••••• ••210',
      emailMasked: 'rahul.sharma@example.com',
      pincode: '400008',
      productCategory: 'PERSONAL_LOAN',
      indicativeAmount: { amount: '300000.00', currency: 'INR' },
      priority: 'HIGH',
      state: 'NEW',
      branchId: 'MUM01',
      source: 'WALK_IN',
      duplicateFlag: 'NONE',
      contactAttempts: 0,
      assignedUserId: null as string | null,
      lockVersion: 1,
      createdAt: new Date().toISOString(),
    };

    const mockApp = {
      id: APP_ID,
      applicationNumber: APP_ID,
      customerId: CUST_ID,
      customerName: 'Rahul Sharma',
      branchId: 'MUM01',
      productCategory: 'PERSONAL_LOAN',
      requestedAmount: '300000.00',
      currency: 'INR',
      tenureMonths: 36,
      applicantType: 'SALARIED',
      status: 'DOCUMENTS_PENDING',
      salesOwnerId: ADITYA_PERSONAS.rm1.userId,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    let documentUploaded = false;

    // -----------------------------------------------------------------------
    // Mock Leads, Activities, Tasks APIs
    // -----------------------------------------------------------------------
    await page.route('**/v1/leads**', async (route) => {
      const url = route.request().url();
      if (url.includes(`/${LEAD_ID}/conversion`) || url.includes('/actions/convert')) {
        mockLead.state = 'CONVERTED';
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            applicationId: APP_ID,
            applicationNumber: APP_ID,
            customerId: CUST_ID,
            customerNumber: CUST_ID,
            leadId: LEAD_ID,
          }),
        });
      } else if (url.includes(`/${LEAD_ID}/transitions`) || url.includes('/actions/qualify')) {
        const body = JSON.parse(route.request().postData() || '{}');
        if (body.transitionCode === 'T-LEAD-01') {
          mockLead.state = 'CONTACT_ATTEMPTED';
          mockLead.contactAttempts = 1;
          mockLead.lockVersion = 2;
        } else if (body.transitionCode === 'T-LEAD-02') {
          mockLead.state = 'IN_PROGRESS';
          mockLead.lockVersion = 3;
        } else if (body.transitionCode === 'T-LEAD-04' || url.includes('/actions/qualify')) {
          mockLead.state = 'QUALIFIED';
          mockLead.lockVersion = 4;
        }
        await route.fulfill({
          status: 200,
          headers: { ETag: `W/"v${mockLead.lockVersion}"` },
          contentType: 'application/json',
          body: JSON.stringify(mockLead),
        });
      } else if (url.includes(`/${LEAD_ID}`)) {
        await route.fulfill({
          status: 200,
          headers: { ETag: `W/"v${mockLead.lockVersion}"` },
          contentType: 'application/json',
          body: JSON.stringify(mockLead),
        });
      } else if (route.request().method() === 'POST') {
        const body = JSON.parse(route.request().postData() || '{}');
        mockLead.fullName = body.fullName || mockLead.fullName;
        mockLead.indicativeAmount = { amount: `${body.indicativeAmount || 300000}.00`, currency: 'INR' };
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(mockLead),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [mockLead], meta: { total: 1 } }),
        });
      }
    });

    await page.route('**/v1/activities**', async (route) => {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'act_aditya_001',
          kind: 'CALL',
          subjectType: 'LEAD',
          subjectId: LEAD_ID,
          outcomeCode: 'CONNECTED',
          note: 'Borrower Rahul Sharma confirmed interest in ₹3,00,000 Personal Loan for home renovation.',
          createdAt: new Date().toISOString(),
        }),
      });
    });

    await page.route('**/v1/tasks**', async (route) => {
      if (route.request().method() === 'POST') {
        const body = JSON.parse(route.request().postData() || '{}');
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'tsk_aditya_001',
            title: body.title || 'Collect KYC & Income Proofs',
            status: 'OPEN',
            linkedType: 'LEAD',
            linkedId: LEAD_ID,
            ownerUserId: ADITYA_PERSONAS.salesExec.userId,
            createdAt: new Date().toISOString(),
          }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: [
              {
                id: 'tsk_aditya_001',
                title: 'Collect KYC & Income Proofs',
                status: 'OPEN',
                priority: 'HIGH',
                linkedType: 'LEAD',
                linkedId: LEAD_ID,
                ownerUserId: ADITYA_PERSONAS.salesExec.userId,
                createdAt: new Date().toISOString(),
              },
            ],
            meta: { total: 1 },
          }),
        });
      }
    });

    // -----------------------------------------------------------------------
    // Mock Applications & Checklist APIs
    // -----------------------------------------------------------------------
    await page.route(/\/v1\/applications(\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [mockApp],
          meta: { nextCursor: null, limit: 50 },
        }),
      });
    });

    await page.route(`**/v1/applications/${APP_ID}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockApp),
      });
    });

    await page.route(`**/v1/applications/${APP_ID}/checklist**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: 'chk_pan_01',
              applicationId: APP_ID,
              partyId: CUST_ID,
              documentTypeCode: 'PAN_CARD',
              documentType: 'PAN',
              ordinal: 1,
              mandatory: true,
              requiredCount: 1,
              status: documentUploaded ? 'UPLOADED' : 'PENDING',
              uploadedDocId: documentUploaded ? 'doc_rahul_pan_01' : null,
              rejectReason: null,
              attestationNote: null,
              reviewedBy: null,
              version: 1,
              lockVersion: 1,
            },
          ],
          summary: {
            total: 1,
            mandatory: 1,
            outstandingMandatory: documentUploaded ? 0 : 1,
            accepted: 0,
            rejected: 0,
            expired: 0,
            complete: documentUploaded,
          },
        }),
      });
    });

    await page.route('**/v1/shares**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
    });

    let generatedUploadLink: any = null;
    await page.route('**/v1/upload-links**', async (route) => {
      if (route.request().method() === 'POST') {
        const body = JSON.parse(route.request().postData() || '{}');
        generatedUploadLink = {
          id: 'upl_aditya_rahul_001',
          tenantId: TENANT_ID,
          applicationId: APP_ID,
          items: body.checklistItemIds || ['chk_pan_01'],
          recipientContactId: CUST_ID,
          expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
          otpRequired: true,
          maxUses: 5,
          uses: 0,
          uploadUrl: `/upload/${SHARE_TOKEN}`,
          createdAt: new Date().toISOString(),
        };
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(generatedUploadLink),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: generatedUploadLink ? [generatedUploadLink] : [],
            meta: { nextCursor: null, limit: 50 },
          }),
        });
      }
    });

    // -----------------------------------------------------------------------
    // Mock Verification APIs
    // -----------------------------------------------------------------------
    const mockVrfCase = {
      id: VRF_CASE_ID,
      applicationId: APP_ID,
      verificationType: 'DOCUMENT_REVIEW',
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      findingsSummary: null as string | null,
      lockVersion: 1,
      checklistItmIds: ['chk_pan_01'],
      customerName: 'Rahul Sharma',
      applicantName: 'Rahul Sharma',
      createdAt: new Date().toISOString(),
    };

    await page.route('**/v1/verification-requests**', async (route) => {
      const url = route.request().url();
      if (url.includes(`/${VRF_CASE_ID}/attestation`)) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        });
      } else if (url.includes(`/${VRF_CASE_ID}/complete`)) {
        mockVrfCase.status = 'COMPLETED';
        mockVrfCase.findingsSummary = 'POSITIVE';
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: mockVrfCase }),
        });
      } else if (url.includes(`/${VRF_CASE_ID}`)) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: mockVrfCase }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [mockVrfCase], meta: { total: 1 } }),
        });
      }
    });

    await page.route('**/v1/verifications**', async (route) => {
      const url = route.request().url();
      if (url.includes(`/${VRF_CASE_ID}`)) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: mockVrfCase }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [mockVrfCase], meta: { total: 1 } }),
        });
      }
    });

    // -----------------------------------------------------------------------
    // Mock Sanctions & Disbursements APIs
    // -----------------------------------------------------------------------
    const mockSanctions: any[] = [];
    const mockTranches: any[] = [];

    await page.route(`**/v1/lender-cases/${CASE_ID}/sanctions`, async (route) => {
      if (route.request().method() === 'POST') {
        const body = JSON.parse(route.request().postData() || '{}');
        const newSanction = {
          id: SANCTION_ID,
          lenderCaseId: CASE_ID,
          amount: body.amount || '280000',
          tenureMonths: body.tenureMonths || '36',
          rateValue: body.rateValue || '11.5',
          rateType: 'FIXED',
          status: 'ACTIVE',
          sanctionDate: new Date().toISOString().split('T')[0],
          validUntil: '2027-11-19',
          createdAt: new Date().toISOString(),
        };
        mockSanctions.push(newSanction);
        await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: newSanction }) });
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: mockSanctions }) });
      }
    });

    await page.route(`**/v1/sanctions/${SANCTION_ID}/tranches`, async (route) => {
      if (route.request().method() === 'POST') {
        const body = JSON.parse(route.request().postData() || '{}');
        const newTranche = {
          id: TRANCHE_ID,
          sanctionId: SANCTION_ID,
          trancheNo: 1,
          amount: body.amount || '140000',
          disbursedOn: new Date().toISOString().split('T')[0],
          status: 'RECORDED',
          utrMasked: 'UTR***0210',
          loanAccountMasked: 'LA***9876',
          recordedBy: ADITYA_PERSONAS.loanOps.userId,
          verifiedBy: null,
          createdAt: new Date().toISOString(),
        };
        mockTranches.push(newTranche);
        await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: newTranche }) });
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: mockTranches }) });
      }
    });

    await page.route(new RegExp(`/v1/(sanctions/)?tranches/${TRANCHE_ID}/(verification|verify)`), async (route) => {
      const tranche = mockTranches[0];
      if (tranche) {
        tranche.status = 'VERIFIED';
        tranche.verifiedBy = ADITYA_PERSONAS.branchMgr.userId;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: tranche }) });
    });

    // -----------------------------------------------------------------------
    // Mock Finance Payouts APIs (SOD-03 Maker-Checker)
    // -----------------------------------------------------------------------
    const mockPayout = {
      id: PAYOUT_ID,
      connectorId: 'con_aditya_direct',
      origin: 'COMMISSION_ENGINE',
      total: '1400.00',
      status: 'SUBMITTED',
      submittedBy: ADITYA_PERSONAS.financeExec.userId,
      submittedAt: new Date().toISOString(),
      lines: [
        {
          id: 'pline_rahul_001',
          payableId: 'pay_rahul_tranche_1',
          amount: '1400.00',
          currency: 'INR',
          description: '1.0% Commission on Disbursed Tranche #1 (₹1,40,000 for Rahul Sharma)',
        },
      ],
    };

    await page.route('**/v1/payout-requests**', async (route) => {
      const url = route.request().url();
      if (url.includes('/approval')) {
        mockPayout.status = 'APPROVED';
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: mockPayout }) });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [mockPayout], meta: { limit: 50, nextCursor: null } }),
        });
      }
    });

    // -----------------------------------------------------------------------
    // Mock Compliance Audit Ledger APIs
    // -----------------------------------------------------------------------
    const mockAuditEvents = [
      {
        id: 'aud_aditya_01',
        tenantId: TENANT_ID,
        entityType: 'LOAN_APPLICATION',
        entityId: APP_ID,
        action: 'LEAD_CONVERSION',
        actorId: ADITYA_PERSONAS.rm1.userId,
        actorType: 'USER',
        prevHash: '0000000000000000000000000000000000000000000000000000000000000000',
        hash: 'b1c2d3e4f5a60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0',
        occurredAt: new Date().toISOString(),
      },
      {
        id: 'aud_aditya_02',
        tenantId: TENANT_ID,
        entityType: 'DOCUMENT',
        entityId: 'doc_rahul_pan_01',
        action: 'CUSTOMER_UPLOAD',
        actorId: 'PUBLIC_BORROWER',
        actorType: 'EXTERNAL',
        prevHash: 'b1c2d3e4f5a60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0',
        hash: 'c2d3e4f5a6b10718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0',
        occurredAt: new Date().toISOString(),
      },
      {
        id: 'aud_aditya_03',
        tenantId: TENANT_ID,
        entityType: 'SANCTION',
        entityId: SANCTION_ID,
        action: 'SANCTION_RECORDED',
        actorId: ADITYA_PERSONAS.loanOps.userId,
        actorType: 'USER',
        prevHash: 'c2d3e4f5a6b10718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0',
        hash: 'd3e4f5a6b1c20718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0',
        occurredAt: new Date().toISOString(),
      },
    ];

    await page.route('**/v1/audit-events**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: mockAuditEvents, meta: { total: 3, hasMore: false } }),
      });
    });

    await page.route('**/v1/audit-chain/verification', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'VERIFIED',
          tenantId: TENANT_ID,
          totalEvents: 3,
          sealedEvents: 3,
          unsealedEvents: 0,
          verifiedRange: {
            fromSeq: 1,
            toSeq: 3,
            genesisHash: '0000000000000000000000000000000000000000000000000000000000000000',
            latestHash: 'd3e4f5a6b1c20718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0',
          },
          verifiedAt: new Date().toISOString(),
        }),
      });
    });

    await page.route('**/v1/evidence-packs**', async (route) => {
      if (route.request().method() === 'POST') {
        const body = JSON.parse(route.request().postData() || '{}');
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'evp_aditya_rahul_001',
            entityType: 'LOAN_APPLICATION',
            entityId: body.entityId || APP_ID,
            purpose: body.purpose || 'REGULATORY_AUDIT',
            status: 'COMPLETED',
            packHashSha256: 'd3e4f5a6b1c20718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0',
            createdAt: new Date().toISOString(),
          }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [] }),
        });
      }
    });

    // =======================================================================
    // STAGE 1: SALES INTAKE EXECUTIVE (sales@adityfinserv.com / Admin@123)
    // =======================================================================
    await authPage.loginAs(ADITYA_PERSONAS.salesExec, '/leads/new', STANDARD_PASSWORD);
    await leadPage.goto('/leads/new');
    await leadPage.showBanner(
      'Stage 1: Sales Intake Executive (Adity Finserv)',
      'Field outreach lead intake for borrower Rahul Sharma (₹3,00,000 Personal Loan)',
    );
    await expect(leadPage.heading).toContainText('Create New Lead');

    // Fill valid applicant details for Rahul Sharma
    await leadPage.showBanner(
      'Entering Applicant Details',
      'Rahul Sharma, Mobile: 9876543210, Mumbai Central (400008), ₹3,00,000 PL',
    );
    await leadPage.fillLeadForm({
      fullName: 'Rahul Sharma',
      mobile: '9876543210',
      email: 'rahul.sharma@example.com',
      pincode: '400008',
      amount: '300000',
    });
    await leadPage.pause(1000);

    await leadPage.showBanner('Submitting Lead Intake', 'Saving lead in state NEW (MUM01 Intake Queue)');
    await leadPage.submitLead(1500);

    // Verify navigated to lead detail
    await expect(page).toHaveURL(new RegExp(`/leads/${LEAD_ID}`));
    await expect(leadPage.heading).toContainText('Rahul Sharma');
    await expect(page.getByText('NEW', { exact: true })).toBeVisible();
    await leadPage.pause(1200);

    // Advance Lead state: T-LEAD-01 & T-LEAD-02
    await leadPage.showBanner('Registering Customer Contact Attempt', 'Advancing lead state to CONTACT_ATTEMPTED');
    await leadPage.attemptContact(1200);
    await expect(page.getByText('CONTACT_ATTEMPTED', { exact: true })).toBeVisible();

    await leadPage.showBanner('Advancing Lead to IN_PROGRESS', 'Borrower Rahul Sharma confirmed interest in Personal Loan');
    await leadPage.markInProgress(1200);
    await expect(page.getByText('IN_PROGRESS', { exact: true })).toBeVisible();

    // Assign follow-up task
    await leadPage.showBanner('Assigning Follow-up Task', 'Collect KYC & Income Proofs (PAN Card & Bank Statement)');
    await leadPage.addTask('Collect KYC & Income Proofs', 1200);
    await leadPage.pause(1000);

    await authPage.logout();

    // =======================================================================
    // STAGE 2: BRANCH MANAGER MUMBAI (branchmgr@adityfinserv.com / Admin@123)
    // =======================================================================
    await authPage.loginAs(ADITYA_PERSONAS.branchMgr, '/', STANDARD_PASSWORD);
    await dashboardPage.goto('/');
    await dashboardPage.showBanner(
      'Stage 2: Branch Manager (Mumbai Central - MUM01)',
      'Supervising MUM01 intake queues, branch performance & pipeline workload',
    );
    await expect(dashboardPage.dashboard).toBeVisible();
    await expect(dashboardPage.hubHeading).toBeVisible();
    await expect(page.getByText('Rahul Sharma')).toBeVisible();
    await dashboardPage.pause(1200);

    await authPage.logout();

    // =======================================================================
    // STAGE 3: RELATIONSHIP MANAGER 1 (rm1@adityfinserv.com / Admin@123)
    // =======================================================================
    await authPage.loginAs(ADITYA_PERSONAS.rm1, `/leads/${LEAD_ID}`, STANDARD_PASSWORD);
    await leadPage.goto(`/leads/${LEAD_ID}`);
    await leadPage.showBanner(
      'Stage 3: Relationship Manager 1',
      'Borrower qualification, zero duplicate verification & atomic conversion',
    );
    await expect(leadPage.heading).toContainText('Rahul Sharma');

    // Verify duplicate badge is clean
    await leadPage.showBanner('Verifying Duplicate Check', 'Zero duplicate conflicts detected (Duplicate: NONE)');
    await expect(page.getByTestId('lead.duplicate-flag')).toHaveCount(0);
    await leadPage.pause(1000);

    // Open Qualify Dialog & qualify terms
    await leadPage.showBanner('Qualifying Loan Terms', 'Monthly Income: ₹75,000, Approved Amount: ₹3,00,000, 36 months');
    await leadPage.openQualifyDialog();
    await leadPage.submitQualification('300000', '75000');
    await expect(page.getByText('QUALIFIED', { exact: true })).toBeVisible();
    await leadPage.pause(1200);

    // Execute Atomic Conversion to Master Customer & Loan Application
    await leadPage.showBanner(
      'Atomic Conversion Execution',
      'Creating Master Customer (cus_demo_rahul_001) & Loan Application (app_aditya_rahul_001)',
    );
    await leadPage.convertLead(1500);
    await expect(page.getByRole('heading', { name: 'Lead Converted Successfully' })).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(`${APP_ID}|Open application`) })).toBeVisible();
    await expect(page.getByText(new RegExp(`${CUST_ID}|Open customer`))).toBeVisible();
    await leadPage.pause(1500);

    await authPage.logout();

    // =======================================================================
    // STAGE 4: LOAN OPERATIONS (loanops@adityfinserv.com / Admin@123)
    // =======================================================================
    await authPage.loginAs(
      ADITYA_PERSONAS.loanOps,
      `/document-sharing?applicationId=${APP_ID}&action=upload-link`,
      STANDARD_PASSWORD,
    );
    await sharingPage.goto(`/document-sharing?applicationId=${APP_ID}&action=upload-link`);
    await sharingPage.showBanner(
      'Stage 4: Loan Operations Officer',
      'Generating secure 2FA customer upload link with 7-day TTL (MOD-DSH)',
    );

    await expect(sharingPage.linkItemChips).toHaveCount(1);
    await sharingPage.click(sharingPage.linkItemChips.first(), 800);

    await sharingPage.showBanner('Authorizing Secure Link', 'Attaching PAN Card requirement with OTP identity protection');
    await sharingPage.click(sharingPage.generateLinkBtn, 1500);

    // Verify public upload URL is displayed
    await expect(page.getByText(`/upload/${SHARE_TOKEN}`)).toBeVisible();
    await sharingPage.showBanner('Link Created Successfully', `Secure borrower link ready: /upload/${SHARE_TOKEN}`);
    await sharingPage.pause(1200);
    await sharingPage.click(sharingPage.closeDialogBtn, 800);

    await authPage.logout();

    // =======================================================================
    // STAGE 5: EXTERNAL CUSTOMER SECURE PORTAL (Borrower Rahul Sharma)
    // =======================================================================
    const customerContext = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    const customerPage = await customerContext.newPage();
    const portalPage = new CustomerPortalPage(customerPage);

    // Mock Customer Portal Endpoints for Rahul Sharma
    await customerPage.route(`**/public/v1/upload/${SHARE_TOKEN}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          token: SHARE_TOKEN,
          status: 'ACTIVE',
          otpRequired: true,
          maskedContact: '+91 ******3210',
          expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
          requestedItems: [
            { checklistItemId: 'chk_pan_01', documentTypeCode: 'PAN_CARD', ordinal: 1, mandatory: true },
          ],
        }),
      });
    });

    await customerPage.route(`**/public/v1/upload/${SHARE_TOKEN}/otp-verification`, async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      if (body.otp === '000000' || body.otp === '123456') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            uploadSessionToken: 'mock-session-token-rahul-sharma',
          }),
        });
      } else {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            error: { code: 'INVALID_OTP', message: 'Invalid or expired OTP verification code.' },
          }),
        });
      }
    });

    await customerPage.route(`**/public/v1/upload/${SHARE_TOKEN}/files`, async (route) => {
      documentUploaded = true;
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          documentId: 'doc_rahul_adhar_01',
          checklistItemId: 'chk_pan_01',
          filename: 'Adhar card.pdf',
          fileSizeBytes: adharCardBuffer.length,
          uploadedAt: new Date().toISOString(),
        }),
      });
    });

    await portalPage.goto(`/upload/${SHARE_TOKEN}`);
    await portalPage.showBanner(
      'Stage 5: External Customer Portal (Rahul Sharma)',
      'Two-Step Identity Verification gate with masked mobile +91 ******3210',
    );
    await expect(portalPage.portalHeader).toBeVisible();
    await expect(portalPage.identityVerificationHeader).toBeVisible();
    await expect(customerPage.getByText('+91 ******3210')).toBeVisible();
    await portalPage.pause(1000);

    // Submit Valid OTP
    await portalPage.showBanner('Entering 6-Digit OTP', 'Verifying code "000000" to unlock borrower upload session');
    await portalPage.verifyOtp('000000', 1500);

    // Verify upload portal unlocked
    await portalPage.showBanner('Upload Portal Unlocked', 'Checklist item: PAN CARD (Mandatory for Rahul Sharma)');
    await expect(portalPage.uploadPortalHeading).toBeVisible();
    await expect(portalPage.checklistHeading).toBeVisible();
    await expect(customerPage.getByText('PAN CARD').first()).toBeVisible();
    await portalPage.pause(1000);

    // Attach real Adhar card.pdf from Downloads
    await portalPage.showBanner('Attaching KYC Document', 'Attaching Adhar card.pdf from Downloads (941.5 KB, %PDF-1.4)');
    await portalPage.attachFile(
      'Adhar card.pdf',
      'application/pdf',
      adharCardBuffer,
    );
    await portalPage.pause(1000);

    // Submit encrypted upload
    await portalPage.showBanner('Submitting Encrypted Upload', 'Sending document to server with SHA-256 integrity hash');
    await portalPage.submitUpload(2000);

    // Verify upload success
    await portalPage.showBanner('Document Upload Successful!', 'Receipt generated & attached to application checklist');
    await expect(customerPage.getByText(/Successfully uploaded/i).first()).toBeVisible();
    await portalPage.pause(2000);

    await customerContext.close();

    // =======================================================================
    // STAGE 6: DOCUMENT VERIFIER (verifier@adityfinserv.com / Admin@123)
    // =======================================================================
    await authPage.loginAs(ADITYA_PERSONAS.docVerifier, '/verifications', STANDARD_PASSWORD);
    await vrfPage.showBanner(
      'Stage 6: Document Verifier (SOD-01)',
      'Reviewing uploaded KYC document checklist for Rahul Sharma on Workbench',
    );
    await expect(
      page.locator(`[data-testid="verification.row.view.${VRF_CASE_ID}"]`).or(page.getByText(VRF_CASE_ID)),
    ).toBeVisible();
    await vrfPage.pause(1000);

    // Open Case Detail
    await vrfPage.goto(`/verifications/${VRF_CASE_ID}`);

    // STEP TO VIEW DOCUMENT BEFORE APPROVING IT
    await vrfPage.showBanner(
      'Viewing Uploaded Document',
      'Opening Document Viewer for Adhar card.pdf — Inspecting Government of India identity document',
    );
    await vrfPage.viewDocument('chk_pan_01', 'Adhar card.pdf', 'Rahul Sharma', adharCardBuffer);
    await vrfPage.pause(1800);

    // STEP TO APPROVE IT
    await vrfPage.showBanner(
      'Approving Verified Document',
      'Attesting Adhar card.pdf — Verdict: ACCEPTED (UIDAI / NSDL Verified)',
    );
    await expect(vrfPage.getAttestBtn('chk_pan_01')).toBeVisible();
    await vrfPage.attestChecklistItem(
      'chk_pan_01',
      'ACCEPTED',
      'Verified Government of India Aadhaar identity document for Rahul Sharma',
    );
    await expect(page.getByRole('alert')).toContainText(/marked as ACCEPTED/i);
    await vrfPage.pause(1200);

    // Finalize assessment with positive verdict
    await vrfPage.showBanner('Completing Verification Assessment', 'Assessment Verdict: POSITIVE');
    await vrfPage.completeVerification('All KYC documents verified with positive validation for Rahul Sharma.');
    await vrfPage.pause(1200);

    await authPage.logout();

    // =======================================================================
    // STAGE 7: LOAN OPERATIONS (loanops@adityfinserv.com / Admin@123)
    // Sanction recording & disbursement tranche #1 logging
    // =======================================================================
    await authPage.loginAs(ADITYA_PERSONAS.loanOps, `/sanctions/${CASE_ID}`, STANDARD_PASSWORD);
    await sanctionPage.showBanner(
      'Stage 7: Loan Operations — Sanction & Disbursal',
      'Recording approved terms from Partner Bank (₹2,80,000 @ 11.5%, 36 mos)',
    );
    await expect(sanctionPage.sanctionsPanel).toBeVisible();

    // Record Sanction
    await sanctionPage.showBanner('Recording Sanction Terms', 'Approved: ₹2,80,000, 36 months, 11.5% fixed rate');
    await sanctionPage.recordSanction({
      amount: '280000',
      tenureMonths: '36',
      rateValue: '11.5',
    });
    await sanctionPage.pause(1200);

    // Record Disbursement Tranche #1
    await sanctionPage.showBanner('Recording Tranche #1 Disbursal', 'Tranche: ₹1,40,000, UTR: UTR-ADITYA-20261119-001');
    await sanctionPage.recordTranche({
      amount: '140000',
      utr: 'UTR-ADITYA-20261119-001',
      loanAccount: 'LA-MUM-987654',
    });
    await sanctionPage.pause(1200);

    await authPage.logout();

    // =======================================================================
    // STAGE 8: BRANCH MANAGER MUMBAI (branchmgr@adityfinserv.com / Admin@123)
    // Maker-Checker dual-control disbursal verification (SOD-04)
    // =======================================================================
    await authPage.loginAs(ADITYA_PERSONAS.branchMgr, `/sanctions/${CASE_ID}`, STANDARD_PASSWORD);
    await sanctionPage.showBanner(
      'Stage 8: Branch Manager (Checker)',
      'SOD-04 Maker-Checker verification on Tranche #1 with bank credit confirmation',
    );
    await expect(sanctionPage.sanctionsPanel).toBeVisible();

    const verifyTrancheBtn = sanctionPage.getVerifyTrancheBtn(TRANCHE_ID);
    if (await verifyTrancheBtn.isVisible()) {
      await sanctionPage.showBanner('Authorizing Tranche Verification', 'Dual-control confirmation on ₹1,40,000 disbursal');
      await sanctionPage.click(verifyTrancheBtn, 1000);
      const submitDecisionBtn = page.getByRole('button', { name: 'Submit Decision' });
      if (await submitDecisionBtn.isVisible()) {
        await sanctionPage.click(submitDecisionBtn, 1500);
      }
      await expect(page.getByText('VERIFIED').first()).toBeVisible();
    }
    await sanctionPage.pause(1200);

    await authPage.logout();

    // =======================================================================
    // STAGE 9: FINANCE EXECUTIVE (finance@adityfinserv.com / Admin@123)
    // Commission calculation & payout request submission (SOD-03 Maker)
    // =======================================================================
    await authPage.loginAs(ADITYA_PERSONAS.financeExec, '/payouts', STANDARD_PASSWORD);
    await payoutPage.showBanner(
      'Stage 9: Finance Executive (Maker)',
      'Commission calculation (1.0% = ₹1,400.00) & payout request preparation (SOD-03)',
    );
    await expect(page.getByText('Payouts & Settlement Hub')).toBeVisible();
    await expect(page.getByText('₹1,400')).toBeVisible();
    await expect(page.getByText('COMMISSION_ENGINE').first()).toBeVisible();
    await expect(page.getByText('SUBMITTED').first()).toBeVisible();
    await payoutPage.pause(1200);

    await authPage.logout();

    // =======================================================================
    // STAGE 10: COMMISSION APPROVER (commission@adityfinserv.com / Admin@123)
    // SOD-03 Dual Control payout review & approval (SOD-03 Checker)
    // =======================================================================
    await authPage.loginAs(ADITYA_PERSONAS.commissionApprover, '/payouts', STANDARD_PASSWORD);
    await payoutPage.showBanner(
      'Stage 10: Commission Approver (Checker)',
      'SOD-03 Independent dual-control payout authorization (1.0% = ₹1,400.00)',
    );
    await expect(page.getByText('Payouts & Settlement Hub')).toBeVisible();

    await payoutPage.switchToApprovalQueue();
    const decideBtn = page.getByRole('row').filter({ hasText: '₹1,400' }).getByRole('button', { name: /Review & Decide/i });
    if (await decideBtn.isVisible()) {
      await payoutPage.showBanner('Approving Commission Payout', 'Authorizing ₹1,400.00 payout for Rahul Sharma loan tranche');
      await payoutPage.click(decideBtn, 1000);
      if (await payoutPage.decisionCommentInput.isVisible()) {
        await payoutPage.type(
          payoutPage.decisionCommentInput,
          'Approved: Validated against Partner Bank scheduled disbursement tranche for Rahul Sharma',
        );
      }
      await payoutPage.click(payoutPage.confirmApprovedBtn, 1500);
    }
    await payoutPage.pause(1200);

    await authPage.logout();

    // =======================================================================
    // STAGE 11: COMPLIANCE OFFICER (compliance@adityfinserv.com / Admin@123)
    // Cryptographic audit chain SHA-256 verification & evidence pack export
    // =======================================================================
    await authPage.loginAs(ADITYA_PERSONAS.compliance, '/audit', STANDARD_PASSWORD);
    await auditPage.showBanner(
      'Stage 11: Compliance Officer',
      'Inspecting cryptographic SHA-256 audit ledger & verifying Merkle chain integrity (MOD-AUD)',
    );
    await expect(page.getByText(APP_ID)).toBeVisible();
    await expect(page.getByText('LOAN_APPLICATION')).toBeVisible();

    // Verify cryptographic audit chain integrity
    await auditPage.showBanner('Executing Merkle Root Verification', 'Cryptographic verification across all events');
    await auditPage.verifyChainIntegrity(1500);

    // Verify modal rendered with VERIFIED status
    await auditPage.showBanner('Audit Integrity Confirmed', '100% Tamper-Evident: Cryptographic status VERIFIED');
    await expect(page.getByText(/Chain Status:/i)).toBeVisible();
    await expect(page.getByText('VERIFIED', { exact: true }).first()).toBeVisible();
    await auditPage.pause(1500);

    await auditPage.closeModal();

    // Export evidence pack
    await auditPage.showBanner('Exporting Regulatory Evidence Pack', 'Sealing cryptographic evidence for statutory audit');
    await auditPage.exportEvidencePack('RBI Statutory Audit & DPDP Compliance Inspection for Rahul Sharma', 2000);
    await expect(page.getByText(/export requested/i)).toBeVisible();
    await auditPage.closeModal();
    await auditPage.pause(1000);

    // Keep screen on verified audit ledger without redirecting to login page
    await auditPage.showBanner(
      'Adity Finserv Origination-to-Payout Demonstration Complete!',
      'Unbroken 11-stage lifecycle from Lead Intake to Commission Payout verified for Rahul Sharma',
    );
    await auditPage.pause(2000);
  });
});

