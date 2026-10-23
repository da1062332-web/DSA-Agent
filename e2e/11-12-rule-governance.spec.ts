import { test, expect } from '@playwright/test';
import { PERSONAS } from './helpers/mock-session';
import { AuthPage, RuleEditorPage } from './pages';

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
    const authPage = new AuthPage(page);
    const rulePage = new RuleEditorPage(page);

    await rulePage.showBanner('Drafting Business Decision Rule', 'To create policy rules, test syntax, and safely simulate test cases in sandbox');

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

    await authPage.loginAs(PERSONAS.ruleAuthor, `/rules/versions/${versionId}`);
    await rulePage.pause(1500);

    // 1. Verify Rule Version page loaded in DRAFT state
    await rulePage.showBanner('Rule Version Loaded', 'Version in DRAFT status with hit policy FIRST');
    await expect(page.getByText(versionId).first()).toBeVisible();
    await expect(page.getByText('DRAFT').first()).toBeVisible();
    await rulePage.pause(1200);

    // 2. Test Syntax Validation Error: Enter malformed JSON and click Save Draft
    await rulePage.showBanner('Syntax Error Check', 'Testing malformed JSON handling in rule definition');
    await rulePage.definitionEditor.fill('{ "invalid_json": ');
    await rulePage.pause(1200);
    await rulePage.click(rulePage.saveDraftBtn, 1500);

    // Verify error banner
    await rulePage.showBanner('Syntax Error Detected', 'Error banner: Definition is not valid JSON');
    await expect(page.getByText(/Definition is not valid JSON/i)).toBeVisible();
    await rulePage.pause(1500);

    // 3. Restore valid JSON schema and save
    await rulePage.showBanner('Valid AST Schema', 'Restoring valid JSON rules definition AST');
    await rulePage.saveDefinition(JSON.stringify(mockRuleSetVersion.definition, null, 2));
    await expect(page.getByText(/Draft definition updated successfully/i)).toBeVisible();
    await rulePage.pause(1500);

    // 4. Open Rule Simulation Modal (Safe Sandbox)
    await rulePage.showBanner('Safe Sandbox Simulation', 'Opening simulation modal with synthetic facts');
    await expect(rulePage.simulateBtn).toBeVisible();
    await rulePage.click(rulePage.simulateBtn, 1500);

    // 5. Check Simulation dialog is open
    await expect(page.getByText(/Safe Rule Simulation Environment/i)).toBeVisible();
    await rulePage.showBanner('Run Simulation', 'Evaluating rule set against test inputs');
    await expect(rulePage.runSimulationBtn).toBeVisible();
    await rulePage.click(rulePage.runSimulationBtn, 2000);

    // 6. Verify simulation output renders
    await rulePage.showBanner('Simulation: COMPLETED', 'Matched rule_1 with output: ELIGIBLE');
    await expect(page.getByText(/Simulation Outcome: COMPLETED/i)).toBeVisible();
    await expect(page.getByText('ELIGIBLE').first()).toBeVisible();
    await rulePage.pause(2000);

    // Close simulation dialog
    await rulePage.closeSimulation();

    // 7. Run AST / schema validation to satisfy prerequisite for review submission
    await rulePage.showBanner('Validate Rule Schema', 'Running AST validator to meet review prerequisite');
    await expect(rulePage.validateAstBtn).toBeVisible();
    await rulePage.validateAST();
    await expect(page.getByText(/Validation Status: PASS/i)).toBeVisible();
    await rulePage.pause(1200);

    // 8. Submit draft for independent review
    await rulePage.showBanner('Submit for Review', 'Freezing draft into IN_REVIEW state for maker-checker review');
    await expect(rulePage.submitForReviewBtn).toBeVisible();
    await expect(rulePage.submitForReviewBtn).toBeEnabled();
    await rulePage.submitForReview('Policy v1 draft validated with positive simulation outcome.');

    await rulePage.showBanner('Submitted for Review', 'Version successfully submitted for independent review');
    await expect(page.getByText(/Version successfully submitted for review/i)).toBeVisible();
    await rulePage.pause(2500);
    await authPage.logout();
  });

  test('TC-BRE-02: Rule Approver reviews & approves with SOD-01 dual-control check', async ({ page }) => {
    const authPage = new AuthPage(page);
    const rulePage = new RuleEditorPage(page);

    await rulePage.showBanner('Independent Rule Checker Review', 'To ensure an independent approver validates business rules prior to production release');

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

    await authPage.loginAs(PERSONAS.ruleApprover, `/rules/versions/${versionId}`);
    await rulePage.pause(1500);

    // 1. Approver sees review action
    await rulePage.showBanner('Opening Checker Review', 'Approver opening independent maker-checker review dialog');
    await expect(rulePage.reviewApproveBtn).toBeVisible();

    // 2. Maker-checker modal opened and approved
    await rulePage.approveRuleVersion('Independent risk validation verified; approved for deployment.');

    // 3. Verify review success notification and status change
    await rulePage.showBanner('Rule Version Approved', 'Review completed successfully by independent checker');
    await expect(page.getByText(/Version review completed: APPROVE/i)).toBeVisible();
    await rulePage.pause(2500);
    await authPage.logout();
  });

  test('TC-BRE-03: Segregation of Duties (SOD-01) Enforces Maker Cannot Self-Approve Rule', async ({ page }) => {
    const authPage = new AuthPage(page);
    const rulePage = new RuleEditorPage(page);

    // Session as Rule Author (who has rule.author permission, but tries to invoke review directly)
    await rulePage.showBanner('Enforcing Rule Maker Lockout', 'To ensure rule authors cannot approve or deploy their own decision logic');

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

    await authPage.loginAs(PERSONAS.ruleAuthor, `/rules/versions/${versionId}`);
    await rulePage.pause(1500);

    // 1. In UI, rule.approve action button is NOT shown to rule author because they lack rule.approve permission
    await rulePage.showBanner('Self-Approval Blocked', 'Review and approve actions are hidden for the original author');
    await expect(rulePage.reviewApproveBtn).toHaveCount(0);
    await rulePage.pause(1200);

    // 2. Author also cannot publish directly
    await rulePage.showBanner('Publish Action Guard', 'Publish to Production button is hidden for author');
    await expect(rulePage.publishBtn).toHaveCount(0);
    await rulePage.pause(1200);

    // 3. Verify locked status
    await rulePage.showBanner('Definition Locked', 'Rule definition is read-only in IN_REVIEW state');
    await expect(page.getByText('IN_REVIEW').first()).toBeVisible();
    await expect(page.getByText(/Locked Rule Definition/i)).toBeVisible();
    await rulePage.pause(2000);
    await authPage.logout();
  });
});
