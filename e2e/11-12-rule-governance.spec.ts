import { test, expect } from '@playwright/test';
import { PERSONAS, setupPersonaSession } from './helpers/mock-session';

test.describe('Personas 11 & 12: Rule Governance (ROLE-RULE-AUTHOR & ROLE-RULE-APPROVER)', () => {
  const versionId = 'rsv_01J00000000000000000000001';

  const mockRuleSetVersion = {
    id: versionId,
    tenantId: 'tenant_test_001',
    ruleSetId: 'rset_credit_policy_01',
    versionNo: 1,
    status: 'DRAFT',
    hitPolicy: 'FIRST',
    authoringForm: 'RULES',
    definition: {
      inputs: [{ name: 'applicant_type', type: 'string' }],
      outputs: [{ name: 'eligibility', type: 'string' }],
      rules: [
        {
          id: 'rule_1',
          description: 'Salaried minimum income eligibility',
          condition: 'monthly_income >= 25000',
          action: 'ELIGIBLE',
        },
      ],
    },
    contentHash: 'a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0',
    editors: ['usr_ruleauthor_01'],
    createdBy: 'usr_ruleauthor_01',
    createdAt: new Date().toISOString(),
    lockVersion: 1,
  };

  test('TC-BRE-01: Rule Author drafts decision table & runs simulation', async ({ page }) => {
    await setupPersonaSession(page, PERSONAS.ruleAuthor);

    // Mock rule set version fetch
    await page.route(`**/v1/rule-set-versions/${versionId}**`, async (route) => {
      const url = route.request().url();
      if (url.includes('/simulations')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              id: 'sim_01J00000000000000000000001',
              tenantId: 'tenant_test_001',
              versionId,
              kind: 'MANUAL',
              contentHash: mockRuleSetVersion.contentHash,
              status: 'COMPLETED',
              summary: {
                status: 'OK',
                outputs: { eligibility: 'ELIGIBLE' },
                matchedRuleUids: ['rule_1'],
                fallbackApplied: false,
                durationUs: 1200,
              },
              requestedBy: 'usr_ruleauthor_01',
              createdAt: new Date().toISOString(),
            },
          }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: mockRuleSetVersion }),
        });
      }
    });

    await page.goto(`/rules/versions/${versionId}`);

    // 1. Verify Rule Version page loaded
    await expect(page.getByText(versionId).first()).toBeVisible();
    await expect(page.getByText('DRAFT').first()).toBeVisible();

    // 2. Open Rule Simulation Modal
    const simBtn = page.getByRole('button', { name: /Simulate \/ Test/i });
    await expect(simBtn).toBeVisible();
    await simBtn.click();

    // 3. Check Simulation dialog is open
    await expect(page.getByText(/Safe Rule Simulation Environment/i)).toBeVisible();
    const runBtn = page.getByRole('button', { name: /Run Simulation/i });
    await expect(runBtn).toBeVisible();
    await runBtn.click();

    // 4. Verify simulation output renders
    await expect(page.getByText(/Simulation Outcome: COMPLETED/i)).toBeVisible();
  });

  test('TC-BRE-02: Rule Approver reviews & approves with SOD-01 check', async ({ page }) => {
    await setupPersonaSession(page, PERSONAS.ruleApprover);

    const inReviewVersion = {
      ...mockRuleSetVersion,
      status: 'IN_REVIEW',
      submittedBy: 'usr_ruleauthor_01',
    };

    let currentVersion = { ...inReviewVersion };

    await page.route(`**/v1/rule-set-versions/${versionId}**`, async (route) => {
      const url = route.request().url();
      if (url.includes('/review')) {
        currentVersion.status = 'APPROVED';
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: currentVersion }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: currentVersion }),
        });
      }
    });

    await page.goto(`/rules/versions/${versionId}`);

    // 1. Approver sees review action
    const reviewBtn = page.getByRole('button', { name: /Review \/ Approve \(SOD-01\)/i });
    await expect(reviewBtn).toBeVisible();
    await reviewBtn.click();

    // 2. Maker-checker modal opened
    await expect(page.getByText(/Independent Maker-Checker Review \(SOD-01\)/i)).toBeVisible();

    // 3. Confirm Approval
    const confirmBtn = page.getByRole('button', { name: /Confirm APPROVE/i });
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();

    // 4. Verify review success notification and status change
    await expect(page.getByText(/Version review completed: APPROVE/i)).toBeVisible();
  });
});
