import { BasePage } from './BasePage';
import { showDemoBanner, pauseForDemo } from '../helpers/mock-session';

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

  readonly viewDocProceedToAttestBtn = this.page.locator('[data-testid="verification.view.proceed-to-attest"]');
  readonly closeDocViewerBtn = this.page.getByRole('button', { name: /Close Viewer/i });

  getViewDocBtn(chkId: string) {
    return this.page.locator(`[data-testid="verification.view.${chkId}"]`).or(this.page.getByRole('button', { name: /View Document/i }));
  }

  getAttestBtn(chkId: string) {
    return this.page.locator(`[data-testid="verification.attest.${chkId}"]`);
  }

  async viewDocument(
    chkId = 'chk_pan_01',
    fileName = 'Adhar card.pdf',
    borrowerName = 'Rahul Sharma',
    fileBuffer?: Buffer,
  ): Promise<void> {
    // 1. If in-page View Document button exists, click it and preview the modal
    const viewBtn = this.getViewDocBtn(chkId);
    if (await viewBtn.isVisible({ timeout: 1200 }).catch(() => false)) {
      await this.click(viewBtn, 1200);
      await this.pause(2500);
      const closeBtn = this.closeDocViewerBtn.or(this.page.getByRole('button', { name: /Close Viewer|Close/i }));
      if (await closeBtn.isVisible()) {
        await this.click(closeBtn, 1000);
      }
    }

    // 2. Open dedicated Document Viewer tab with the actual PDF preview
    const base64Content = fileBuffer ? fileBuffer.toString('base64') : '';
    const docViewerTab = await this.page.context().newPage();
    await docViewerTab.setContent(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Document Viewer — ${fileName} (${borrowerName})</title>
          <style>
            * { box-sizing: border-box; }
            body, html { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; display: flex; flex-direction: column; }
            .header-bar { height: 60px; background: #1e293b; color: white; display: flex; align-items: center; justify-content: space-between; padding: 0 24px; border-bottom: 2px solid #3b82f6; flex-shrink: 0; }
            .title { font-weight: 700; font-size: 16px; display: flex; align-items: center; gap: 10px; }
            .meta { font-size: 13px; color: #94a3b8; display: flex; align-items: center; gap: 16px; }
            .badge { background: #10b981; color: white; padding: 4px 10px; border-radius: 4px; font-size: 11px; font-weight: 700; letter-spacing: 0.5px; }
            .substrip { background: #ffffff; padding: 12px 24px; border-bottom: 1px solid #cbd5e1; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
            .viewer-container { flex: 1; width: 100%; height: calc(100% - 110px); background: #334155; }
            embed { width: 100%; height: 100%; border: none; }
          </style>
        </head>
        <body>
          <div class="header-bar">
            <div class="title">
              <span style="font-size: 22px;">📄</span>
              <span>Document Verifier Workbench: ${fileName}</span>
            </div>
            <div class="meta">
              <span>Borrower: <strong style="color: white;">${borrowerName}</strong></span>
              <span>Item ID: <strong style="color: white;">${chkId}</strong></span>
              <span class="badge">CLEAN • SHA-256 VERIFIED</span>
            </div>
          </div>
          <div class="substrip">
            <div>
              <div style="font-weight: 700; font-size: 14px; color: #0f172a;">Government of India — Unique Identification Authority of India (UIDAI)</div>
              <div style="font-size: 12px; color: #475569; margin-top: 2px;">Identity Proof Document: Aadhaar Card for ${borrowerName} • UID: XXXX XXXX 3210</div>
            </div>
            <div style="background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 6px; padding: 4px 10px; color: #065f46; font-size: 11px; font-weight: 700;">
              ✓ UIDAI Digital Signature Validated
            </div>
          </div>
          <div class="viewer-container">
            ${base64Content ? `<embed src="data:application/pdf;base64,${base64Content}" type="application/pdf" />` : ''}
          </div>
        </body>
      </html>
    `);

    await showDemoBanner(
      docViewerTab,
      'Forensic Document Inspection',
      `Previewing uploaded ${fileName} for ${borrowerName}`,
    );
    await pauseForDemo(docViewerTab, 3500);

    await docViewerTab.close();
    await this.page.bringToFront();
    await this.pause(800);
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
