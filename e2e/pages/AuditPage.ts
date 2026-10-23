import { BasePage } from './BasePage';

/**
 * AuditPage encapsulates the cryptographic audit ledger, SHA-256 Merkle root verification,
 * tamper-evident evidence pack generation, and regulatory compliance registers.
 */
export class AuditPage extends BasePage {
  readonly verifyChainBtn = this.page.getByRole('button', { name: /Verify Chain Integrity/i });
  readonly closeModalBtn = this.page.getByRole('button', { name: /Close/i });
  readonly exportEvidencePackBtn = this.page.getByRole('button', { name: /Export Evidence Pack/i });
  readonly exportPurposeInput = this.page.getByLabel(/Export Purpose|Purpose/i);
  readonly generateEvidenceBtn = this.page.getByRole('button', { name: /Generate Evidence Pack/i });

  async verifyChainIntegrity(delayMs = 1500): Promise<void> {
    await this.click(this.verifyChainBtn, delayMs);
  }

  async closeModal(): Promise<void> {
    if (await this.closeModalBtn.isVisible()) {
      await this.click(this.closeModalBtn, 800);
    }
  }

  async exportEvidencePack(purpose: string, delayMs = 2000): Promise<void> {
    await this.click(this.exportEvidencePackBtn, 1200);
    if (await this.exportPurposeInput.isVisible()) {
      await this.type(this.exportPurposeInput, purpose);
      await this.pause(800);
    }
    await this.click(this.generateEvidenceBtn, delayMs);
  }
}
