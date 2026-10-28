import { describe, expect, it } from 'vitest';
import { packageErrorText } from './package-error';

describe('packageErrorText', () => {
  it('TEST-LCS-PKG-001 tells the person where to record a missing lender-sharing consent', () => {
    const text = packageErrorText({
      code: 'CONSENT_REQUIRED',
      message: 'Active SHARE_WITH_LENDER consent for this lender is required.',
    });
    expect(text).toContain('Active SHARE_WITH_LENDER consent for this lender is required.');
    expect(text).toContain("customer's Consents tab");
    expect(text).toContain('Share with lender');
  });

  it('TEST-LCS-PKG-002 names the documents that are still open, once each, in plain words', () => {
    const text = packageErrorText({
      code: 'COMPLETENESS_FAILED',
      message: 'Mandatory documents are still outstanding.',
      details: [
        { field: 'checklist', issue: 'DOCUMENT_OUTSTANDING', meta: { checklistItemId: 'chk_1', documentTypeCode: 'PAN_CARD', status: 'PENDING' } },
        { field: 'checklist', issue: 'DOCUMENT_OUTSTANDING', meta: { checklistItemId: 'chk_2', documentTypeCode: 'BANK_STATEMENT', status: 'SUBMITTED' } },
        { field: 'checklist', issue: 'DOCUMENT_OUTSTANDING', meta: { checklistItemId: 'chk_3', documentTypeCode: 'PAN_CARD', status: 'PENDING' } },
      ],
    });
    expect(text.startsWith('Mandatory documents are still outstanding. Still open: ')).toBe(true);
    expect(text).toContain('waiting for the customer');
    expect(text).toContain('received, waiting for review');
    expect(text.match(/waiting for the customer/g)).toHaveLength(1); // PAN twice in the details, listed once
    expect(text).not.toContain('chk_'); // ids are never shown
  });

  it('TEST-LCS-PKG-003 explains an empty checklist, which the API reports with no document details', () => {
    const text = packageErrorText({ code: 'COMPLETENESS_FAILED', message: 'Mandatory documents are still outstanding.', details: [] });
    expect(text).toContain('no document checklist yet');
  });

  it('TEST-LCS-PKG-004 leaves every other error as the API worded it, with a fallback when there is no message', () => {
    expect(packageErrorText({ code: 'INVALID_STATE', message: "Cannot build package in state 'SUBMITTED'." })).toBe(
      "Cannot build package in state 'SUBMITTED'.",
    );
    expect(packageErrorText({})).toBe('Failed to build package.');
  });
});
