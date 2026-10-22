import { test, expect } from '@playwright/test';

test.describe('Persona 14: Customer (Secure Link Portal)', () => {
  const token = 'tok_secure_cust_9988';

  test('TC-CUST-01: Public Document Upload Flow with OTP Gate & File Validation', async ({ page }) => {
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

    // 2. Verify Security Portal Header & Masked Phone
    await expect(page.getByText('DSA Loan Portal')).toBeVisible();
    await expect(page.getByText('Two-Step Identity Verification')).toBeVisible();
    await expect(page.getByText('+91 ******3210')).toBeVisible();

    // 3. Test Invalid OTP
    const otpInput = page.getByPlaceholder('123456');
    await otpInput.fill('999999');
    await page.getByRole('button', { name: /Verify Code & Access/i }).click();
    await expect(page.getByText('Invalid or expired OTP verification code.').first()).toBeVisible();

    // 4. Test Valid OTP
    await otpInput.fill('123456');
    await page.getByRole('button', { name: /Verify Code & Access/i }).click();

    // 5. Verify Document Upload Portal is displayed
    await expect(page.getByText('Document Upload Portal')).toBeVisible();
    await expect(page.getByText('Requested Documents Checklist')).toBeVisible();
    await expect(page.getByText('PAN CARD').first()).toBeVisible();
    await expect(page.getByText('BANK STATEMENT').first()).toBeVisible();

    // 6. Test File Upload
    await page.locator('#public-file-input').setInputFiles({
      name: 'pan_card_copy.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 test pan content'),
    });

    // Click Upload Document
    await page.getByRole('button', { name: /Upload Document/i }).click();

    // 7. Verify Upload Success
    await expect(page.getByText(/Successfully uploaded pan_card_copy.pdf/i)).toBeVisible();
  });
});
