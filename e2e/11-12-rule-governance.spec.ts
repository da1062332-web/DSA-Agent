import { test, expect } from '@playwright/test';
import { PERSONAS, setupPersonaSession, pauseForDemo, humanClick, humanType, showDemoBanner } from './helpers/mock-session';

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

  test('TC-BRE-01: Rule Author drafts decision table, encounters syntax validation, and runs simulation', async ({
    page,
  }) => {
    await setupPersonaSession(page, PERSONAS.ruleAuthor);
    await showDemoBanner(page, 'ROLE-RULE-AUTHOR', 'Drafting Decision Table, Syntax Validation & Safe Sandbox Simulation');

    let currentVersion = { ...mockRuleSetVersion };

    // Mock rule set version fetch, update, submit and simulations
    await page.route('**/v1/rule-set-versions/**', async (route) => {
      const url = route.request().url();
      const method = route.request().method();

      if (url.includes('/validate')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            versionId,
            result: 'PASS',
            contentHash: currentVersion.contentHash,
            issues: [],
          }),
        });
      } else if (url.includes('/simulations')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'sim_01J00000000000000000000001',
            tenantId: 'tenant_test_001',
            versionId,
            kind: 'MANUAL',
            contentHash: currentVersion.contentHash,
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
          }),
        });
      } else if (url.includes('/submit') && method === 'POST') {
        currentVersion.status = 'IN_REVIEW';
        currentVersion.submittedBy = 'usr_ruleauthor_01';
        currentVersion.submittedAt = new Date().toISOString();
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(currentVersion),
        });
      } else if (method === 'PATCH' || method === 'PUT') {
        const body = JSON.parse(route.request().postData() || '{}');
        currentVersion = {
          ...currentVersion,
          ...body,
          lockVersion: currentVersion.lockVersion + 1,
        };
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(currentVersion),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(currentVersion),
        });
      }
    });

    await page.goto(`/rules/versions/${versionId}`);
    await pauseForDemo(page, 2000);

    // 1. Verify Rule Version page loaded in DRAFT state
    await expect(page.getByText(versionId).first()).toBeVisible();
    await expect(page.getByText('DRAFT').first()).toBeVisible();
    await pauseForDemo(page, 1500);

    // 2. Test Syntax Validation Error: Enter malformed JSON and click Save Draft
    const definitionEditor = page.locator('textarea').first();
    await definitionEditor.fill('{ "invalid_json": ');
    await pauseForDemo(page, 1500);

    const saveDraftBtn = page.getByRole('button', { name: /Save Draft/i });
    await humanClick(saveDraftBtn, 1500);

    // Verify error banner
    await expect(page.getByText(/Definition is not valid JSON/i)).toBeVisible();
    await pauseForDemo(page, 2000);

    // 3. Restore valid JSON schema and save
    await definitionEditor.fill(JSON.stringify(mockRuleSetVersion.definition, null, 2));
    await pauseForDemo(page, 1500);
    await humanClick(saveDraftBtn, 2000);
    await expect(page.getByText(/Draft definition updated successfully/i)).toBeVisible();
    await pauseForDemo(page, 2000);

    // 4. Open Rule Simulation Modal (Safe Sandbox)
    const simBtn = page.getByRole('button', { name: /Simulate \/ Test/i });
    await expect(simBtn).toBeVisible();
    await humanClick(simBtn, 2000);

    // 5. Check Simulation dialog is open
    await expect(page.getByText(/Safe Rule Simulation Environment/i)).toBeVisible();
    const runBtn = page.getByRole('button', { name: /Run Simulation/i });
    await expect(runBtn).toBeVisible();
    await humanClick(runBtn, 2000);

    // 6. Verify simulation output renders
    await expect(page.getByText(/Simulation Outcome: COMPLETED/i)).toBeVisible();
    await expect(page.getByText('ELIGIBLE').first()).toBeVisible();
    await pauseForDemo(page, 2500);

    // Close simulation dialog
    const closeDialogBtn = page.getByRole('button', { name: /Close/i });
    await humanClick(closeDialogBtn, 1500);

    // 7. Run AST / schema validation to satisfy prerequisite for review submission
    const validateBtn = page.getByRole('button', { name: /^Validate$/i });
    await expect(validateBtn).toBeVisible();
    await humanClick(validateBtn, 2000);
    await expect(page.getByText(/Validation Status: PASS/i)).toBeVisible();
    await pauseForDemo(page, 1500);

    // 8. Submit draft for independent review
    const submitBtn = page.getByRole('button', { name: /Submit for Review/i });
    await expect(submitBtn).toBeVisible();
    await humanClick(submitBtn, 1500);

    await expect(page.getByText(/Submit Version for Review/i)).toBeVisible();
    const submitReasonInput = page.getByLabel(/Submission Notes/i);
    await humanType(submitReasonInput, 'Policy v1 draft validated with positive simulation outcome.');
    await pauseForDemo(page, 1500);

    const confirmSubmitBtn = page.getByRole('button', { name: /Submit Version/i });
    await humanClick(confirmSubmitBtn, 2000);

    await expect(page.getByText(/Version successfully submitted for review/i)).toBeVisible();
    await pauseForDemo(page, 3000);
  });

  test('TC-BRE-02: Rule Approver reviews & approves with SOD-01 dual-control check', async ({ page }) => {
    await setupPersonaSession(page, PERSONAS.ruleApprover);
    await showDemoBanner(page, 'ROLE-RULE-APPROVER', 'Independent Maker-Checker Review & Approval (SOD-01 Compliance)');

    const inReviewVersion = {
      ...mockRuleSetVersion,
      status: 'IN_REVIEW',
      submittedBy: 'usr_ruleauthor_01',
      editors: ['usr_ruleauthor_01'], // Maker is ruleauthor
    };

    let currentVersion = { ...inReviewVersion };

    await page.route(`**/v1/rule-set-versions/${versionId}**`, async (route) => {
      const url = route.request().url();
      if (url.includes('/review')) {
        currentVersion = {
          ...currentVersion,
          status: 'APPROVED',
          lockVersion: currentVersion.lockVersion + 1,
        };
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
    await pauseForDemo(page, 2000);

    // 1. Approver sees review action
    const reviewBtn = page.getByRole('button', { name: /Review \/ Approve \(SOD-01\)/i });
    await expect(reviewBtn).toBeVisible();
    await humanClick(reviewBtn, 2000);

    // 2. Maker-checker modal opened
    await expect(page.getByText(/Independent Maker-Checker Review \(SOD-01\)/i)).toBeVisible();
    await expect(page.getByText(/Per SOD-01 separation of duties/i)).toBeVisible();

    // 3. Fill reviewer comments
    const commentField = page.getByLabel(/Reviewer Comments/i);
    await humanType(commentField, 'Independent risk validation verified; approved for deployment.');
    await pauseForDemo(page, 1500);

    // 4. Confirm Approval
    const confirmBtn = page.getByRole('button', { name: /Confirm APPROVE/i });
    await expect(confirmBtn).toBeVisible();
    await humanClick(confirmBtn, 2500);

    // 5. Verify review success notification and status change
    await expect(page.getByText(/Version review completed: APPROVE/i)).toBeVisible();
    await pauseForDemo(page, 3000);
  });

  test('TC-BRE-03: Segregation of Duties (SOD-01) Enforces Maker Cannot Self-Approve Rule', async ({ page }) => {
    // Session as Rule Author (who has rule.author permission, but tries to invoke review directly)
    await setupPersonaSession(page, PERSONAS.ruleAuthor);
    await showDemoBanner(page, 'ROLE-RULE-AUTHOR', 'SOD-01 Maker Lock Verification: Self-Approval Prohibited');

    // Rule version in IN_REVIEW authored by usr_ruleauthor_01
    const inReviewVersion = {
      ...mockRuleSetVersion,
      status: 'IN_REVIEW',
      submittedBy: 'usr_ruleauthor_01',
      editors: ['usr_ruleauthor_01'],
    };

    await page.route(`**/v1/rule-set-versions/${versionId}**`, async (route) => {
      const url = route.request().url();
      if (url.includes('/review')) {
        // Backend rejects self-approval
        await route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              code: 'SOD_VIOLATION',
              message: 'SOD-01 Maker-checker violation: Authors and editors are prohibited from approving their own rule version.',
            },
          }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: inReviewVersion }),
        });
      }
    });

    await page.goto(`/rules/versions/${versionId}`);
    await pauseForDemo(page, 2000);

    // 1. In UI, rule.approve action button is NOT shown to rule author because they lack rule.approve permission
    await expect(page.getByRole('button', { name: /Review \/ Approve \(SOD-01\)/i })).toHaveCount(0);
    await pauseForDemo(page, 2000);

    // 2. Author also cannot publish directly
    await expect(page.getByRole('button', { name: /Publish Version/i })).toHaveCount(0);
    await pauseForDemo(page, 2000);

    // 3. Verify locked status
    await expect(page.getByText('IN_REVIEW').first()).toBeVisible();
    await expect(page.getByText(/Locked Rule Definition/i)).toBeVisible();
    await pauseForDemo(page, 2500);
  });
});
