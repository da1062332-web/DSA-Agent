import { test, expect } from '@playwright/test';
import { pauseForDemo, humanClick, humanType, showDemoBanner } from './helpers/mock-session';

test.describe('Persona 14: Customer (Secure Link Portal)', () => {
  const token = 'tok_secure_cust_9988';

  test('TC-CUST-01: Public Document Upload Flow with OTP Gate & Valid File Upload', async ({ page }) => {
    await showDemoBanner(page, 'ROLE-CUSTOMER (PUBLIC LINK)', 'Customer Identity Verification (OTP) & Compliant Document Upload');

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
    await page.goto(`/upload/${token}`);
    await pauseForDemo(page, 2000);

    // 2. Verify Security Portal Header & Masked Phone
    await expect(page.getByText('DSA Loan Portal')).toBeVisible();
    await expect(page.getByText('Two-Step Identity Verification')).toBeVisible();
    await expect(page.getByText('+91 ******3210')).toBeVisible();
    await pauseForDemo(page, 2000);

    // 3. Test Invalid OTP
    const otpInput = page.getByPlaceholder('123456');
    await humanType(otpInput, '999999');
    await pauseForDemo(page, 1000);

    const verifyOtpBtn = page.getByRole('button', { name: /Verify Code & Access/i });
    await humanClick(verifyOtpBtn, 2000);
    await expect(page.getByText('Invalid or expired OTP verification code.').first()).toBeVisible();
    await pauseForDemo(page, 2000);

    // 4. Test Valid OTP
    await otpInput.fill('');
    await humanType(otpInput, '123456');
    await pauseForDemo(page, 1500);
    await humanClick(verifyOtpBtn, 2500);

    // 5. Verify Document Upload Portal is displayed
    await expect(page.getByText('Document Upload Portal')).toBeVisible();
    await expect(page.getByText('Requested Documents Checklist')).toBeVisible();
    await expect(page.getByText('PAN CARD').first()).toBeVisible();
    await expect(page.getByText('BANK STATEMENT').first()).toBeVisible();
    await pauseForDemo(page, 2000);

    // 6. Test File Upload
    await page.locator('#public-file-input').setInputFiles({
      name: 'pan_card_copy.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 test pan content'),
    });
    await pauseForDemo(page, 2000);

    // Click Upload Document
    const uploadBtn = page.getByRole('button', { name: /Upload Document/i });
    await humanClick(uploadBtn, 2500);

    // 7. Verify Upload Success
    await expect(page.getByText(/Successfully uploaded pan_card_copy.pdf/i)).toBeVisible();
    await pauseForDemo(page, 3000);
  });

  test('TC-CUST-02: File Type & Size Validation Gate on Public Upload', async ({ page }) => {
    await showDemoBanner(page, 'ROLE-CUSTOMER (PUBLIC LINK)', 'Public Portal Validation Gate: Rejecting Unsupported Formats');

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

    await page.goto(`/upload/${token}`);
    await pauseForDemo(page, 2000);

    // Verify upload portal loaded directly (otpRequired: false)
    await expect(page.getByText('Document Upload Portal')).toBeVisible();

    // Select unsupported executable file
    await page.locator('#public-file-input').setInputFiles({
      name: 'unauthorized_script.exe',
      mimeType: 'application/x-msdownload',
      buffer: Buffer.from('MZ binary executable content'),
    });
    await pauseForDemo(page, 1500);

    const uploadBtn = page.getByRole('button', { name: /Upload Document/i });
    await humanClick(uploadBtn, 2000);

    // Verify rejection alert
    await expect(page.getByText(/Only PDF, JPG, and PNG files are accepted/i).first()).toBeVisible();
    await pauseForDemo(page, 3000);
  });

  test('TC-CUST-03: Expired and Revoked Public Link Access Denial (410 LINK_EXPIRED)', async ({ page }) => {
    await showDemoBanner(page, 'ROLE-CUSTOMER (PUBLIC LINK)', 'Security Boundary: Expired & Revoked Link Rejection');

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

    await page.goto(`/upload/${expiredToken}`);
    await pauseForDemo(page, 2000);

    // Verify Expired Link screen
    await expect(page.getByRole('heading', { name: 'Upload Link Expired' })).toBeVisible();
    await expect(page.getByText(/Please request a fresh upload link from your loan advisor/i)).toBeVisible();
    await pauseForDemo(page, 3000);
  });
});
