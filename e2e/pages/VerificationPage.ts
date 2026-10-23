import { BasePage } from './BasePage';

/**
 * VerificationPage encapsulates document verification queue inspections,
 * checklist attestations (ACCEPTED / REJECTED), and mandatory assessment finalizations.
 */
export class VerificationPage extends BasePage {
  readonly newCaseBtn = this.page.getByRole('button', { name: /Initiate Verification/i });
  readonly submitInitiateBtn = this.page.getByRole('button', { name: /Initiate Case|Submit/i });
  readonly cancelInitiateBtn = this.page.getByRole('button', { name: /Cancel/i });

  readonly verdictSelect = this.page.getByLabel('Review Verdict');
  readonly attestationNoteInput = this.page.getByLabel('Attestation Note');
  readonly submitAttestationBtn = this.page.getByRole('button', { name: /Submit Attestation/i });

  readonly completeAssessmentBtn = this.page.locator('[data-testid="verification.btn.complete"]');
  readonly findingsField = this.page.locator('[data-testid="verification.complete.findings"] textarea').first();
  readonly submitVerdictBtn = this.page.locator('[data-testid="verification.complete.submit"]');

  getAttestBtn(chkId: string) {
    return this.page.locator(`[data-testid="verification.attest.${chkId}"]`);
  }

  /**
   * Attests one checklist item. The dialog keeps its last verdict between openings, so the verdict is always chosen.
   * `rejectReason` is the option label of the structured reason code (e.g. 'Illegible / Blurry' for ILLEGIBLE).
   */
  async attestChecklistItem(
    chkId: string,
    verdict: 'ACCEPTED' | 'REJECTED' = 'ACCEPTED',
    note?: string,
    rejectReason?: string,
  ): Promise<void> {
    await this.click(this.getAttestBtn(chkId), 1200);
    await this.click(this.verdictSelect, 800);
    await this.click(this.page.getByRole('option', { name: new RegExp(`^${verdict}`) }), 800);
    if (verdict === 'REJECTED' && rejectReason) {
      await this.click(this.page.getByLabel('Reject Reason'), 800);
      await this.click(this.page.getByRole('option', { name: rejectReason }), 800);
    }
    if (note) {
      await this.type(this.attestationNoteInput, note);
    }
    await this.click(this.submitAttestationBtn, 1800);
  }

  async completeVerification(findings: string): Promise<void> {
    await this.click(this.completeAssessmentBtn, 1200);
    await this.findingsField.fill('');
    await this.type(this.findingsField, findings);
    await this.pause(800);
    await this.click(this.submitVerdictBtn, 1800);
  }
}
