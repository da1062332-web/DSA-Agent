import { BasePage } from './BasePage';

/**
 * DocumentSharingPage encapsulates the staff side of customer secure links (MOD-DSH SUB-DSH.01): generate an upload
 * link for an application's open checklist items, read the share history and revoke a link (QA plan Module 14).
 */
export class DocumentSharingPage extends BasePage {
  readonly openLinkFormBtn = this.page.getByTestId('sharing.link.open');
  readonly linkItemChips = this.page.getByTestId('sharing.link.item');
  readonly generateLinkBtn = this.page.getByTestId('sharing.link.submit');
  readonly revokeBtn = this.page.getByTestId('sharing.link.revoke');
  readonly closeDialogBtn = this.page.getByRole('dialog').getByRole('button', { name: 'Close' });

  /** The upload-link history row for a link ID. */
  linkRow(linkId: string) {
    return this.page.getByRole('row').filter({ hasText: linkId });
  }
}
