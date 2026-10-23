import { BasePage } from './BasePage';

/**
 * ApplicationPage encapsulates loan origination lifecycle, checklist items,
 * and Segregation of Duties (SoD) boundaries on loan review and sanction actions.
 */
export class ApplicationPage extends BasePage {
  readonly sendToReviewBtn = this.page.getByRole('button', { name: /Send to review/i });
  readonly recordSanctionBtn = this.page.getByRole('button', { name: /Record Sanction/i });
}
