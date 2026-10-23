import { test, expect } from '@playwright/test';
import { CustomerPortalPage } from './pages';

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

  test('TC-CUST-03: Expired and Revoked Public Link Access Denial (410 LINK_EXPIRED)', async ({ page }) => {
    const portalPage = new CustomerPortalPage(page);

    await portalPage.showBanner('Rejecting Expired Upload Links', 'To prevent unauthorized uploads after secure link expiration deadline');

    const expiredToken = 'tok_expired_9999';

    // Mock Expired Upload link
    await page.route(`**/public/v1/upload/${expiredToken}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          token: expiredToken,
          status: 'EXPIRED',
          otpRequired: true,
          maskedContact: '+91 ******3210',
          expiresAt: '2026-10-01T00:00:00.000Z',
          requestedItems: [],
        }),
      });
    });

    await portalPage.goto(`/upload/${expiredToken}`);
    await portalPage.pause(1500);

    // Verify Expired Link screen
    await portalPage.showBanner('Upload Link Expired', 'Access blocked: Customer advised to request fresh upload link');
    await expect(page.getByRole('heading', { name: 'Upload Link Expired' })).toBeVisible();
    await expect(page.getByText(/Please request a fresh upload link from your loan advisor/i)).toBeVisible();
    await portalPage.pause(2500);
  });
});
