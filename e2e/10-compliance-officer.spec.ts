import { test, expect } from '@playwright/test';
import { PERSONAS, setupPersonaSession, pauseForDemo, humanType, humanClick, showDemoBanner } from './helpers/mock-session';

test.describe('Persona 10: Compliance Officer (ROLE-COMPLIANCE)', () => {
  test.beforeEach(async ({ page }) => {
    await setupPersonaSession(page, PERSONAS.compliance);
  });

  // =========================================================================
  // TC-CO-01: Cryptographic Audit Trail Search & SHA-256 Chain Verification
  // (Notion QA Plan Module 10 Steps 1-3, MOD-AUD, CMP-AUD.01)
  // =========================================================================
  test('TC-CO-01: Cryptographic Audit Trail Search & SHA-256 Chain Verification', async ({ page }) => {
    const mockAuditEvents = [
      {
        id: 'aud_01J00000000000000000000001',
        tenantId: 'ten_alpha',
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
        tenantId: 'ten_alpha',
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

    await page.route('**/v1/audit-events**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: mockAuditEvents, meta: { total: 2, hasMore: false } }),
      });
    });

    await page.route('**/v1/audit-chain/verification', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'VERIFIED',
          tenantId: 'ten_alpha',
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

    // 1. Visit Audit Log Search
    await page.goto('/audit');
    await showDemoBanner(page, 'Searching Cryptographic Audit Ledger', 'To inspect tamper-evident SHA-256 hash chains for regulatory compliance');
    await pauseForDemo(page, 1500);

    await showDemoBanner(page, 'Audit Ledger', 'Inspecting audit events for entity app_loan_001');
    await expect(page.getByText('app_loan_001')).toBeVisible();
    await expect(page.getByText('LOAN_APPLICATION')).toBeVisible();

    // 2. Click "Verify Chain Integrity"
    await showDemoBanner(page, 'Verify Chain Integrity', 'Initiating SHA-256 Merkle root verification');
    const verifyChainBtn = page.getByRole('button', { name: /Verify Chain Integrity/i });
    await expect(verifyChainBtn).toBeVisible();
    await humanClick(verifyChainBtn, 1500);

    // Verify modal rendered with cryptographic status
    await showDemoBanner(page, 'Chain Status: VERIFIED', 'Cryptographic audit sequence #1-#2 sealed and valid');
    await expect(page.getByText(/Chain Status:/i)).toBeVisible();
    await expect(page.getByText('VERIFIED', { exact: true }).first()).toBeVisible();
    await pauseForDemo(page, 2500);
  });

  // =========================================================================
  // TC-CO-02: Tamper-Evident Evidence Pack Export & DPDP Privacy Register Audit
  // (Notion QA Plan Module 10 Steps 4-5, MOD-AUD, MOD-PRV)
  // =========================================================================
  test('TC-CO-02: Tamper-Evident Evidence Pack Export & DPDP Privacy Register Audit', async ({ page }) => {
    await page.route('**/v1/audit-events**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [], meta: { total: 0 } }),
      });
    });

    // Mock evidence pack creation
    await page.route('**/v1/evidence-packs**', async (route) => {
      if (route.request().method() === 'POST') {
        const body = JSON.parse(route.request().postData() || '{}');
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'evp_qa_001',
            entityType: 'LOAN_APPLICATION',
            entityId: body.entityId || 'APP-QA-001',
            purpose: body.purpose || 'REGULATORY_AUDIT',
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

    await page.goto('/audit');
    await showDemoBanner(page, 'Exporting Regulatory Evidence Pack', 'To generate an immutable sealed archive with SHA-256 manifest for RBI auditors');
    await pauseForDemo(page, 1500);

    // 1. Open Export Evidence Pack Modal
    await showDemoBanner(page, 'Request Evidence Pack', 'Opening evidence archive export dialog');
    const exportPackBtn = page.getByRole('button', { name: /Export Evidence Pack/i });
    await expect(exportPackBtn).toBeVisible();
    await humanClick(exportPackBtn, 1500);

    // 2. Fill evidence export purpose
    await showDemoBanner(page, 'Audit Purpose Entry', 'Purpose: Regulatory RBI Annual Compliance Audit');
    const purposeField = page.getByLabel(/Export Purpose|Purpose/i);
    if (await purposeField.isVisible()) {
      await humanType(purposeField, 'Regulatory RBI Annual Compliance Audit');
      await pauseForDemo(page, 1200);
    }

    // Submit export
    await showDemoBanner(page, 'Generate Evidence Pack', 'Sealing evidence bundle with SHA-256 manifest');
    const generateBtn = page.getByRole('button', { name: /Generate Evidence Pack/i });
    await humanClick(generateBtn, 2000);

    // Verify confirmation message
    await showDemoBanner(page, 'Export Requested', 'Evidence pack generated with cryptographic signature');
    await expect(page.getByText(/export requested/i)).toBeVisible();
    await pauseForDemo(page, 1500);

    // 3. Visit Privacy and Consent Register (/privacy)
    await page.route('**/v1/privacy**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
      });
    });

    await showDemoBanner(page, 'DPDP Privacy Register', 'Auditing consent records & privacy notice versions');
    await page.goto('/privacy');
    await pauseForDemo(page, 1500);
    await expect(page.locator('body')).toContainText(/privacy|consent/i);
    await pauseForDemo(page, 2000);
  });

  // =========================================================================
  // TC-CO-03: Segregation of Duties (SoD) & Read-Only Operational Boundary Enforcement
  // (Notion QA Plan Module 10 Step 6: Compliance Officer has zero operational write access)
  // =========================================================================
  test('TC-CO-03: Segregation of Duties (SoD) & Read-Only Operational Boundary Enforcement', async ({ page }) => {
    await showDemoBanner(page, 'Enforcing Read-Only Compliance Oversight', 'To verify Compliance Officers cannot alter operational loan records, rules, or commissions');
    await pauseForDemo(page, 1200);

    // 1. Verify Compliance Officer cannot author or publish BRE rules
    await showDemoBanner(page, 'Route Guard: Rules', 'Navigating to /rules (Expect 403 Forbidden)');
    await page.goto('/rules');
    await expect(page.getByText('You do not have permission to access this page.')).toBeVisible();
    await pauseForDemo(page, 1500);

    // 2. Verify Compliance Officer cannot access Commission Payouts
    await showDemoBanner(page, 'Route Guard: Commission', 'Navigating to /commission (Expect 403 Forbidden)');
    await page.goto('/commission');
    await expect(page.getByText('You do not have permission to access this page.')).toBeVisible();
    await pauseForDemo(page, 1500);

    // 3. Verify Compliance Officer cannot record Sanctions
    await showDemoBanner(page, 'Route Guard: Sanctions', 'Navigating to /sanctions (Expect 403 Forbidden)');
    await page.goto('/sanctions');
    await expect(page.getByText('You do not have permission to access this page.')).toBeVisible();
    await showDemoBanner(page, 'Read-Only Boundaries Enforced', 'Compliance Officer restricted strictly to oversight');
    await pauseForDemo(page, 2000);
  });
});
