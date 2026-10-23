import { test, expect } from '@playwright/test';
import { PERSONAS, apiErrorBody } from './helpers/mock-session';
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

  // =========================================================================
  // TC-BRE-02 QA-RAP: independent approver approves with fresh step-up
  // (QA plan Module 12 step 4; rule.approve is elevated, Notion Roles §5)
  // =========================================================================
  test('TC-BRE-02: Rule Approver reviews & approves with SOD-01 dual-control check and step-up', async ({ page }) => {
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
    let reviewCalls = 0;

    await page.route(`**/v1/rule-set-versions/${versionId}**`, async (route) => {
      const url = route.request().url();
      if (url.includes('/review')) {
        reviewCalls += 1;
        // The first attempt answers 401 STEP_UP_REQUIRED; the client retries once after the TOTP step-up
        if (reviewCalls === 1) {
          await route.fulfill({
            status: 401,
            contentType: 'application/json',
            body: apiErrorBody('STEP_UP_REQUIRED', 401, 'This action needs a fresh step-up authentication.'),
          });
          return;
        }
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

    // 2. Maker-checker modal opened and approved; the API demands a fresh step-up first
    await rulePage.approveRuleVersion('Independent risk validation verified; approved for deployment.');
    await rulePage.showBanner('Step-Up Required', 'rule.approve needs a fresh AAL2 TOTP code');
    await expect(authPage.stepUpDialog).toBeVisible();
    await authPage.completeStepUp();

    // 3. Verify review success notification and status change
    await rulePage.showBanner('Rule Version Approved', 'Review completed successfully by independent checker');
    await expect(page.getByText(/Version review completed: APPROVE/i)).toBeVisible();
    expect(reviewCalls).toBe(2);
    // The approver holds rule.publish, so the approved version offers publication
    await expect(rulePage.publishBtn).toBeVisible();
    await rulePage.pause(2500);
    await authPage.logout();
  });

  // =========================================================================
  // TC-BRE-03 QA-RAP-001: SOD-01 — an editor of a rule version cannot approve it, even holding rule.approve
  // (Notion Roles §4 SOD-01: approved_by <> ANY(editors); QA plan Module 12 step 5)
  // ROLE-TENANT-ADMIN holds rule.author and rule.approve (Notion Roles §7), so the approve action is offered to it and only
  // the maker-checker rule can stop it.
  // =========================================================================
  test('TC-BRE-03 QA-RAP-001: SOD-01 editor holding rule.approve cannot approve own rule version', async ({ page }) => {
    const authPage = new AuthPage(page);
    const rulePage = new RuleEditorPage(page);

    await rulePage.showBanner('Enforcing Rule Maker Lockout', 'The Tenant Admin edited this version and also holds rule.approve');

    const inReviewVersion = {
      ...mockRuleSetVersion,
      status: 'IN_REVIEW',
      createdBy: PERSONAS.tenantAdmin.userId,
      submittedBy: PERSONAS.tenantAdmin.userId,
      editors: [PERSONAS.tenantAdmin.userId],
    };
    let reviewCalls = 0;

    await page.route(`**/v1/rule-set-versions/${versionId}**`, async (route) => {
      const url = route.request().url();
      if (url.includes('/review')) {
        reviewCalls += 1;
        // The API refuses: the reviewer is one of the version's editors
        await route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: apiErrorBody(
            'SOD_VIOLATION',
            403,
            'SOD-01 Maker-checker violation: Authors and editors are prohibited from approving their own rule version.',
          ),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: inReviewVersion }),
        });
      }
    });

    await authPage.loginAs(PERSONAS.tenantAdmin, `/rules/versions/${versionId}`);
    await rulePage.pause(1500);

    // 1. The approve action is offered: the Tenant Admin holds rule.approve
    await expect(rulePage.reviewApproveBtn).toBeVisible();

    // 2. Self-approval is refused under SOD-01 and nothing changes
    await rulePage.showBanner('Self-Approval Attempt', 'Editor tries to approve its own version');
    await rulePage.approveRuleVersion('Attempting to approve my own rule version.');
    await expect(page.getByText(/SOD-01 Maker-checker violation/)).toBeVisible();
    await expect(page.getByText(/Version review completed/i)).toHaveCount(0);
    expect(reviewCalls).toBe(1);
    await rulePage.click(page.getByRole('dialog').getByRole('button', { name: 'Cancel' }), 800);
    await expect(page.getByText('IN_REVIEW').first()).toBeVisible();
    await expect(rulePage.publishBtn).toHaveCount(0);
    await rulePage.pause(2000);
    await authPage.logout();
  });

  // =========================================================================
  // TC-BRE-04: Rule Author has no approve or publish action (QA plan Module 11 step 7; ROLE-RULE-AUTHOR holds only
  // rule.author and rule.simulate, Notion Roles §6.4)
  // =========================================================================
  test('TC-BRE-04: Rule Author cannot approve or publish a rule version', async ({ page }) => {
    const authPage = new AuthPage(page);
    const rulePage = new RuleEditorPage(page);

    let shownVersion: Record<string, unknown> = {
      ...mockRuleSetVersion,
      status: 'IN_REVIEW',
      submittedBy: 'usr_ruleauthor_01',
      editors: ['usr_ruleauthor_01'],
    };

    await page.route(`**/v1/rule-set-versions/${versionId}**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: shownVersion }),
      });
    });

    await authPage.loginAs(PERSONAS.ruleAuthor, `/rules/versions/${versionId}`);
    await rulePage.pause(1500);

    // 1. In review: no approve action (no rule.approve)
    await rulePage.showBanner('Author Permission Boundary', 'Review action is not offered to the author');
    await expect(page.getByText('IN_REVIEW').first()).toBeVisible();
    await expect(rulePage.reviewApproveBtn).toHaveCount(0);
    await expect(page.getByText(/Locked Rule Definition/i)).toBeVisible();

    // 2. Approved: no publish action (no rule.publish)
    shownVersion = { ...shownVersion, status: 'APPROVED' };
    await page.reload();
    await rulePage.showBanner('Author Permission Boundary', 'Publish action is not offered to the author');
    await expect(page.getByText('APPROVED').first()).toBeVisible();
    await expect(rulePage.publishBtn).toHaveCount(0);
    await rulePage.pause(2000);
    await authPage.logout();
  });
});
