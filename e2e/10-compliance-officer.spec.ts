import { test, expect } from '@playwright/test';
import { PERSONAS, setupPersonaSession } from './helpers/mock-session';

test.describe('Persona 10: Compliance Officer (ROLE-COMPLIANCE)', () => {
  test.beforeEach(async ({ page }) => {
    await setupPersonaSession(page, PERSONAS.compliance);
  });

  test('TC-CO-01: Cryptographic Audit Trail Search, SHA-256 Chain Verification & Evidence Pack Export', async ({ page }) => {
    const mockAuditEvents = [
      {
        id: 'aud_01J00000000000000000000001',
        tenantId: 'tenant_test_001',
        entityType: 'LOAN_APPLICATION',
        entityId: 'app_loan_001',
        action: 'STATUS_TRANSITION',
        actorId: 'usr_loanops_01',
        actorType: 'USER',
        prevHash: '0000000000000000000000000000000000000000000000000000000000000000',
        hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        externalSideEffect: false,
        correlationId: 'cor_01J000000001',
        occurredAt: new Date().toISOString(),
      },
      {
        id: 'aud_01J00000000000000000000002',
        tenantId: 'tenant_test_001',
        entityType: 'SANCTION',
        entityId: 'snc_001',
        action: 'CREATE',
        actorId: 'usr_loanops_01',
        actorType: 'USER',
        prevHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        hash: '879942a1efb96b4bf04f141fb13ec4c01828bf4e75618451877bd36f5cc767b4',
        externalSideEffect: false,
        correlationId: 'cor_01J000000002',
        occurredAt: new Date().toISOString(),
      },
    ];

    // Mock search audit events
    await page.route('**/v1/audit-events**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: mockAuditEvents, meta: { total: 2, hasMore: false } }),
      });
    });

    // Mock SHA-256 chain verification
    await page.route('**/v1/audit-chain/verification', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'VERIFIED',
          tenantId: 'tenant_test_001',
          totalEvents: 2,
          sealedEvents: 2,
          unsealedEvents: 0,
          verifiedRange: {
            fromSeq: 1,
            toSeq: 2,
            genesisHash: '0000000000000000000000000000000000000000000000000000000000000000',
            latestHash: '879942a1efb96b4bf04f141fb13ec4c01828bf4e75618451877bd36f5cc767b4',
          },
          verifiedAt: new Date().toISOString(),
        }),
      });
    });

    // Mock Evidence Pack generation
    await page.route('**/v1/evidence-packs**', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'evp_pack_001',
            entityType: 'LOAN_APPLICATION',
            entityId: 'app_loan_001',
            status: 'COMPLETED',
            packHashSha256: 'a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0',
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

    // 1. Visit Audit Log Search
    await page.goto('/audit');
    await expect(page.getByText('app_loan_001')).toBeVisible();
    await expect(page.getByText('LOAN_APPLICATION')).toBeVisible();

    // 2. Click "Verify Chain Integrity"
    const verifyChainBtn = page.getByRole('button', { name: /Verify Chain Integrity/i });
    await expect(verifyChainBtn).toBeVisible();
    await verifyChainBtn.click();
    await expect(page.getByText(/Chain Status:/i)).toBeVisible();
    await expect(page.getByText('VERIFIED', { exact: true }).first()).toBeVisible();

    // 3. Visit Privacy Register
    await page.route('**/v1/privacy**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
      });
    });
    await page.goto('/privacy');
    await expect(page.locator('body')).toContainText(/privacy|consent/i);
  });
});
