import { test, expect } from '@playwright/test';
import { PERSONAS, apiErrorBody } from './helpers/mock-session';
import { AuthPage, CustomerPortalPage, DocumentSharingPage } from './pages';

test.describe('Persona 14: Customer (Secure Link Portal)', () => {
  const token = 'tok_secure_cust_9988';

  test('TC-CUST-01: Public Document Upload Flow with OTP Gate & Valid File Upload', async ({ page }) => {
    const portalPage = new CustomerPortalPage(page);

    await portalPage.showBanner('Customer Document Upload Portal', 'To authenticate applicant via OTP and upload required KYC documents');

    // Mock Public Upload status
    await page.route(`**/public/v1/upload/${token}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          token,
          status: 'ACTIVE',
          otpRequired: true,
          maskedContact: '+91 ******3210',
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
          requestedItems: [
            { checklistItemId: 'chk_pan', documentTypeCode: 'PAN_CARD', ordinal: 1, mandatory: true },
            {
              checklistItemId: 'chk_bank_stmt',
              documentTypeCode: 'BANK_STATEMENT',
              ordinal: 2,
              mandatory: true,
            },
          ],
        }),
      });
    });

    // Mock OTP verification endpoint
    await page.route(`**/public/v1/upload/${token}/otp-verification`, async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      if (body.otp === '123456') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            uploadSessionToken: 'mock-upload-session-token-abc',
          }),
        });
      } else {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              code: 'INVALID_OTP',
              message: 'Invalid or expired OTP verification code.',
            },
          }),
        });
      }
    });

    // Mock document upload endpoint
    await page.route(`**/public/v1/upload/${token}/files`, async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          documentId: 'doc_cust_uploaded_01',
          checklistItemId: body.checklistItemId,
          filename: body.filename,
          fileSizeBytes: 102400,
          uploadedAt: new Date().toISOString(),
        }),
      });
    });

    // 1. Visit Public Upload URL
    await portalPage.goto(`/upload/${token}`);
    await portalPage.pause(1500);

    // 2. Verify Security Portal Header & Masked Phone
    await portalPage.showBanner('Portal Security Header', 'Verifying Two-Step Identity Verification gate & masked mobile');
    await expect(portalPage.portalHeader).toBeVisible();
    await expect(portalPage.identityVerificationHeader).toBeVisible();
    await expect(page.getByText('+91 ******3210')).toBeVisible();
    await portalPage.pause(1500);

    // 3. Test Invalid OTP
    await portalPage.showBanner('Invalid OTP Check', 'Entering incorrect 6-digit code "999999"');
    await portalPage.type(portalPage.otpInput, '999999');
    await portalPage.pause(1000);

    await portalPage.click(portalPage.verifyOtpBtn, 1500);
    await expect(page.getByText('Invalid or expired OTP verification code.').first()).toBeVisible();
    await portalPage.pause(1500);

    // 4. Test Valid OTP
    await portalPage.showBanner('Valid OTP Verification', 'Entering valid code "123456"');
    await portalPage.verifyOtp('123456', 2000);

    // 5. Verify Document Upload Portal is displayed
    await portalPage.showBanner('Upload Portal Unlocked', 'Checklist items: PAN CARD & BANK STATEMENT');
    await expect(portalPage.uploadPortalHeading).toBeVisible();
    await expect(portalPage.checklistHeading).toBeVisible();
    await expect(page.getByText('PAN CARD').first()).toBeVisible();
    await expect(page.getByText('BANK STATEMENT').first()).toBeVisible();
    await portalPage.pause(1500);

    // 6. Test File Upload
    await portalPage.showBanner('Select Valid PDF', 'Attaching pan_card_copy.pdf');
    await portalPage.attachFile('pan_card_copy.pdf', 'application/pdf', '%PDF-1.4 test pan content');
    await portalPage.pause(1500);

    // Click Upload Document
    await portalPage.showBanner('Upload Document', 'Encrypting and uploading file to application');
    await portalPage.submitUpload(2000);

    // 7. Verify Upload Success
    await portalPage.showBanner('Upload Successful', 'pan_card_copy.pdf attached to verification checklist');
    await expect(page.getByText(/Successfully uploaded pan_card_copy.pdf/i)).toBeVisible();
    await portalPage.pause(2500);
  });

  test('TC-CUST-02: File Type & Size Validation Gate on Public Upload', async ({ page }) => {
    const portalPage = new CustomerPortalPage(page);

    await portalPage.showBanner('Validating File Format Security', 'To reject unsupported file extensions and enforce approved document formats');

    // Mock Public Upload status
    await page.route(`**/public/v1/upload/${token}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          token,
          status: 'ACTIVE',
          otpRequired: false, // OTP already completed
          maskedContact: '+91 ******3210',
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
          requestedItems: [
            { checklistItemId: 'chk_pan', documentTypeCode: 'PAN_CARD', ordinal: 1, mandatory: true },
          ],
        }),
      });
    });

    // Mock document upload with rejected file type
    await page.route(`**/public/v1/upload/${token}/files`, async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'UNSUPPORTED_MEDIA_TYPE',
            message: 'Only PDF, JPG, and PNG files are accepted for compliance verification.',
          },
        }),
      });
    });

    await portalPage.goto(`/upload/${token}`);
    await portalPage.pause(1500);

    // Verify upload portal loaded directly (otpRequired: false)
    await expect(portalPage.uploadPortalHeading).toBeVisible();

    // Select unsupported executable file
    await portalPage.showBanner('Select Unsupported File', 'Attempting upload of unauthorized_script.exe');
    await portalPage.attachFile('unauthorized_script.exe', 'application/x-msdownload', 'MZ binary executable content');
    await portalPage.pause(1200);

    await portalPage.showBanner('Submit Invalid File', 'Triggering file format compliance filter');
    await portalPage.submitUpload(1500);

    // Verify rejection alert
    await portalPage.showBanner('Format Filter Enforced', 'Only PDF, JPG, and PNG files are accepted');
    await expect(page.getByText(/Only PDF, JPG, and PNG files are accepted/i).first()).toBeVisible();
    await portalPage.pause(2500);
  });

  // =========================================================================
  // TC-CUST-03 QA-CUST-001: expired link access is denied (QA plan Module 14 step 7)
  // The API answers an expired token with 410 LINK_EXPIRED (document-sharing-service resolvePublicLink), not a 200 status.
  // =========================================================================
  test('TC-CUST-03 QA-CUST-001: expired public link answers 410 LINK_EXPIRED and shows nothing', async ({ page }) => {
    const portalPage = new CustomerPortalPage(page);

    await portalPage.showBanner('Rejecting Expired Upload Links', 'To prevent unauthorized uploads after secure link expiration deadline');

    const expiredToken = 'tok_expired_9999';

    await page.route(`**/public/v1/upload/${expiredToken}`, async (route) => {
      await route.fulfill({
        status: 410,
        contentType: 'application/json',
        body: apiErrorBody('LINK_EXPIRED', 410, 'This upload link has expired.'),
      });
    });

    await portalPage.goto(`/upload/${expiredToken}`);
    await portalPage.pause(1500);

    await portalPage.showBanner('Upload Link Expired', 'Access blocked: Customer advised to request fresh upload link');
    await expect(portalPage.inaccessibleHeading).toBeVisible();
    await expect(page.getByText('This upload link has expired.')).toBeVisible();
    await expect(portalPage.uploadPortalHeading).toHaveCount(0);
    await expect(portalPage.fileInput).toHaveCount(0);
    await portalPage.pause(2500);
  });

  // =========================================================================
  // TC-CUST-04: RM generates a secure upload link, revokes it, and the link cannot be reused
  // (QA plan Module 14 steps 1-3, 8 and 10; ROLE-RM holds document.upload, Notion Roles §6.3)
  // =========================================================================
  test('TC-CUST-04: revoked upload link cannot be reused by the customer', async ({ page, browser }) => {
    const authPage = new AuthPage(page);
    const sharingPage = new DocumentSharingPage(page);
    const APP_ID = 'app_qa_001';
    const LINK_ID = 'upl_qa_001';
    const LINK_TOKEN = 'tok_qa_share_001';

    let link: Record<string, unknown> | null = null;
    let revocations = 0;

    await page.route(/\/v1\/applications(\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: APP_ID,
              customerId: 'cus_qa_gamma_001',
              branchId: 'MUM01',
              productCategory: 'PERSONAL_LOAN',
              productVersionId: null,
              requestedAmount: '300000.00',
              currency: 'INR',
              tenureMonths: 36,
              purposeCode: null,
              applicantType: 'SALARIED',
              status: 'DOCUMENTS_PENDING',
              onHold: false,
              holdReason: null,
              holdUntil: null,
              salesOwnerId: 'usr_rm_01',
              opsOwnerId: null,
              opsQueueId: null,
              version: 1,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
          meta: { nextCursor: null, limit: 200 },
        }),
      });
    });
    await page.route(`**/v1/applications/${APP_ID}/checklist**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: 'chk_qa_gamma_income_001',
              applicationId: APP_ID,
              partyId: 'cus_qa_gamma_001',
              documentTypeCode: 'INCOME_PROOF',
              ordinal: 1,
              mandatory: true,
              requiredCount: 1,
              periodMonths: null,
              status: 'PENDING',
              rejectReason: null,
              attestationNote: null,
              reviewedBy: null,
              reviewedAt: null,
              documentId: null,
              sourceDecisionId: 'dec_qa_001',
              version: 1,
            },
          ],
          summary: { total: 1, mandatory: 1, outstandingMandatory: 1, accepted: 0, rejected: 0, expired: 0, complete: false },
        }),
      });
    });
    await page.route('**/v1/shares**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
    });
    await page.route('**/v1/upload-links**', async (route) => {
      const req = route.request();
      const path = new URL(req.url()).pathname;
      if (req.method() === 'POST' && path.endsWith(`/${LINK_ID}/revocation`)) {
        revocations += 1;
        link = { ...link!, revokedAt: new Date().toISOString(), lockVersion: 2 };
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(link) });
      } else if (req.method() === 'POST') {
        const body = JSON.parse(req.postData() || '{}');
        link = {
          id: LINK_ID,
          tenantId: 'ten_01M595WCNH6H3ZMCVS70XH9GAN',
          applicationId: body.applicationId,
          items: body.checklistItemIds,
          recipientContactId: 'cus_qa_gamma_001',
          expiresAt: new Date(Date.now() + body.expiresInHours * 3600_000).toISOString(),
          otpRequired: body.otpRequired,
          maxUses: body.maxUses,
          uses: 0,
          revokedAt: null,
          lockedAt: null,
          lockVersion: 1,
          createdAt: new Date().toISOString(),
          createdBy: 'usr_rm_01',
          updatedAt: new Date().toISOString(),
          updatedBy: 'usr_rm_01',
        };
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ ...link, uploadUrl: `/upload/${LINK_TOKEN}` }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: link ? [link] : [], meta: { nextCursor: null, limit: 50 } }),
        });
      }
    });

    // 1-2. RM generates a secure upload link for the open income-proof item
    await authPage.loginAs(PERSONAS.rm, `/document-sharing?applicationId=${APP_ID}&action=upload-link`);
    await sharingPage.showBanner('Generate Secure Link', 'RM requests the outstanding income proof from the customer');
    await expect(sharingPage.linkItemChips).toHaveCount(1);
    await sharingPage.click(sharingPage.linkItemChips.first(), 800);
    await sharingPage.click(sharingPage.generateLinkBtn, 1500);
    await expect(page.getByText(`/upload/${LINK_TOKEN}`)).toBeVisible();
    await sharingPage.click(sharingPage.closeDialogBtn, 800);

    // 10. The share history lists the link as ACTIVE with its use count
    const row = sharingPage.linkRow(LINK_ID);
    await expect(row).toContainText('ACTIVE');
    await expect(row).toContainText('0 / 5');

    // 8. Revoke the link: the history shows REVOKED and offers no second revocation
    await sharingPage.showBanner('Revoke Link', 'RM revokes the secure upload link');
    await sharingPage.click(row.getByTestId('sharing.link.revoke'), 1500);
    await expect(row).toContainText('REVOKED');
    await expect(row.getByTestId('sharing.link.revoke')).toHaveCount(0);
    expect(revocations).toBe(1);

    // 3 + 8. The customer opens the link in a separate session without staff credentials: access is refused
    const customerContext = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    const customerPage = await customerContext.newPage();
    const portalPage = new CustomerPortalPage(customerPage);
    await customerPage.route(`**/public/v1/upload/${LINK_TOKEN}**`, async (route) => {
      await route.fulfill({
        status: 410,
        contentType: 'application/json',
        body: apiErrorBody('LINK_EXPIRED', 410, 'This upload link has been revoked.'),
      });
    });
    await portalPage.goto(`/upload/${LINK_TOKEN}`);
    await expect(portalPage.inaccessibleHeading).toBeVisible();
    await expect(customerPage.getByText('This upload link has been revoked.')).toBeVisible();
    await expect(portalPage.fileInput).toHaveCount(0);
    await customerContext.close();

    await sharingPage.pause(2000);
    await authPage.logout();
  });

  // =========================================================================
  // TC-CUST-05: a modified token cannot reach another customer's upload workflow (QA plan Module 14 step 9)
  // The API answers an unknown token with 404 NOT_FOUND and reveals nothing about the link or the customer.
  // =========================================================================
  test("TC-CUST-05: tampered token cannot open another customer's upload link", async ({ page }) => {
    const portalPage = new CustomerPortalPage(page);
    const tamperedToken = `${token}x`;

    await page.route(`**/public/v1/upload/${tamperedToken}**`, async (route) => {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: apiErrorBody('NOT_FOUND', 404, 'Invalid or unrecognised upload link.'),
      });
    });

    await portalPage.goto(`/upload/${tamperedToken}`);
    await portalPage.showBanner('Token Tampering', 'A modified token reveals nothing');
    await expect(portalPage.inaccessibleHeading).toBeVisible();
    await expect(page.getByText('Invalid or unrecognised upload link.')).toBeVisible();
    await expect(portalPage.identityVerificationHeader).toHaveCount(0);
    await expect(page.getByText(/\+91/)).toHaveCount(0);
    await portalPage.pause(2000);
  });
});
