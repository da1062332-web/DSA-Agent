// What the Lender cases screen says when building a submission package is refused (owner: Dev 4; MOD-LCS, API-LCS package).
// The API answers 422 for two business rules, and its message says which one failed; this adds what to do about it, and names the
// documents that are still open, which the API sends in the error details but the screen used to drop.
import { STATUS_LABELS, readable } from '../documents/model';
import type { ChecklistStatus } from '../documents/model';

interface PackageError {
  code?: string;
  message?: string;
  details?: unknown[];
}

const openDocument = (detail: unknown): string | null => {
  const meta = (detail as { meta?: { documentTypeCode?: unknown; status?: unknown } } | null)?.meta;
  if (typeof meta?.documentTypeCode !== 'string') return null;
  const status = typeof meta.status === 'string' ? (STATUS_LABELS[meta.status as ChecklistStatus] ?? meta.status) : null;
  return status ? `${readable(meta.documentTypeCode)} (${status.toLowerCase()})` : readable(meta.documentTypeCode);
};

export function packageErrorText(err: PackageError): string {
  const base = err.message || 'Failed to build package.';

  if (err.code === 'CONSENT_REQUIRED') {
    return `${base} Record it on the customer's Consents tab: choose "Share with lender" and name this lender.`;
  }

  if (err.code === 'COMPLETENESS_FAILED') {
    const open = [...new Set((err.details ?? []).map(openDocument).filter((d): d is string => d !== null))];
    return open.length > 0
      ? `${base} Still open: ${open.join(', ')}.`
      : 'This application has no document checklist yet. Open the application, generate the checklist and have every mandatory document verified first.';
  }

  return base;
}
