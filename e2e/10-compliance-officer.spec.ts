import { test, expect } from '@playwright/test';
import { PERSONAS } from './helpers/mock-session';
import { AuthPage, AuditPage } from './pages';

test.describe('Persona 10: Compliance Officer (ROLE-COMPLIANCE)', () => {

  // =========================================================================
  // TC-CO-01: Cryptographic Audit Trail Search & SHA-256 Chain Verification
  // (Notion QA Plan Module 10 Steps 1-3, MOD-AUD, CMP-AUD.01)
  // =========================================================================
  test('TC-CO-01: Cryptographic Audit Trail Search & SHA-256 Chain Verification', async ({ page }) => {
    const authPage = new AuthPage(page);
    const auditPage = new AuditPage(page);

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

    // 1. Visit Audit Log Search via Page Object
    await authPage.loginAs(PERSONAS.compliance, '/audit');
    await auditPage.showBanner('Searching Cryptographic Audit Ledger', 'To inspect tamper-evident SHA-256 hash chains for regulatory compliance');
    await auditPage.pause(1500);

    await auditPage.showBanner('Audit Ledger', 'Inspecting audit events for entity app_loan_001');
    await expect(page.getByText('app_loan_001')).toBeVisible();
    await expect(page.getByText('LOAN_APPLICATION')).toBeVisible();

    // 2. Click "Verify Chain Integrity"
    await auditPage.showBanner('Verify Chain Integrity', 'Initiating SHA-256 Merkle root verification');
    await expect(auditPage.verifyChainBtn).toBeVisible();
    await auditPage.verifyChainIntegrity(1500);

    // Verify modal rendered with cryptographic status
    await auditPage.showBanner('Chain Status: VERIFIED', 'Cryptographic audit sequence #1-#2 sealed and valid');
    await expect(page.getByText(/Chain Status:/i)).toBeVisible();
    await expect(page.getByText('VERIFIED', { exact: true }).first()).toBeVisible();
    await auditPage.pause(2500);

    // Close the verification modal before signing out
    await auditPage.closeModal();
    await auditPage.pause(500);

    await authPage.logout();
  });

  // =========================================================================
  // TC-CO-02: Tamper-Evident Evidence Pack Export & DPDP Privacy Register Audit
  // (Notion QA Plan Module 10 Steps 4-5, MOD-AUD, MOD-PRV)
  // =========================================================================
  test('TC-CO-02: Tamper-Evident Evidence Pack Export & DPDP Privacy Register Audit', async ({ page }) => {
    const authPage = new AuthPage(page);
    const auditPage = new AuditPage(page);

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

    await authPage.loginAs(PERSONAS.compliance, '/audit');
    await auditPage.showBanner('Exporting Regulatory Evidence Pack', 'To generate an immutable sealed archive with SHA-256 manifest for RBI auditors');
    await auditPage.pause(1500);

    // 1. Export Evidence Pack
    await auditPage.showBanner('Request Evidence Pack', 'Opening evidence archive export dialog');
    await auditPage.showBanner('Audit Purpose Entry', 'Purpose: Regulatory RBI Annual Compliance Audit');
    await auditPage.showBanner('Generate Evidence Pack', 'Sealing evidence bundle with SHA-256 manifest');
    await expect(auditPage.exportEvidencePackBtn).toBeVisible();
    await auditPage.exportEvidencePack('Regulatory RBI Annual Compliance Audit');

    // Verify confirmation message
    await auditPage.showBanner('Export Requested', 'Evidence pack generated with cryptographic signature');
    await expect(page.getByText(/export requested/i)).toBeVisible();
    await auditPage.pause(1500);

    // 2. Visit Privacy and Consent Register (/privacy)
    await page.route('**/v1/privacy**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
      });
    });

    await auditPage.showBanner('DPDP Privacy Register', 'Auditing consent records & privacy notice versions');
    await auditPage.goto('/privacy');
    await auditPage.pause(1500);
    await expect(page.locator('body')).toContainText(/privacy|consent/i);
    await auditPage.pause(2000);
    await authPage.logout();
  });

  // =========================================================================
  // TC-CO-03: Segregation of Duties (SoD) & Read-Only Operational Boundary Enforcement
  // (Notion QA Plan Module 10 Step 6: Compliance Officer has zero operational write access)
  // =========================================================================
  test('TC-CO-03: Segregation of Duties (SoD) & Read-Only Operational Boundary Enforcement', async ({ page }) => {
    const authPage = new AuthPage(page);
    const auditPage = new AuditPage(page);

    await authPage.loginAs(PERSONAS.compliance, '/rules');
    await auditPage.showBanner('Enforcing Read-Only Compliance Oversight', 'To verify Compliance Officers cannot alter operational loan records, rules, or commissions');
    await auditPage.pause(1200);

    // 1. Verify Compliance Officer cannot author or publish BRE rules
    await auditPage.showBanner('Route Guard: Rules', 'Navigating to /rules (Expect 403 Forbidden)');
    await expect(page.getByText('You do not have permission to access this page.')).toBeVisible();
    await auditPage.pause(1500);

    // 2. Verify Compliance Officer cannot access Commission Payouts
    await auditPage.showBanner('Route Guard: Commission', 'Navigating to /commission (Expect 403 Forbidden)');
    await auditPage.goto('/commission');
    await expect(page.getByText('You do not have permission to access this page.')).toBeVisible();
    await auditPage.pause(1500);

    // 3. Verify Compliance Officer cannot record Sanctions
    await auditPage.showBanner('Route Guard: Sanctions', 'Navigating to /sanctions (Expect 403 Forbidden)');
    await auditPage.goto('/sanctions');
    await expect(page.getByText('You do not have permission to access this page.')).toBeVisible();
    await auditPage.showBanner('Read-Only Boundaries Enforced', 'Compliance Officer restricted strictly to oversight');
    await auditPage.pause(2000);
    await authPage.logout();
  });
});
