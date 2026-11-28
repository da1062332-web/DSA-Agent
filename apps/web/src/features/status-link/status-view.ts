// What the customer's status page says (task P3-05, checklist 6.4). Pure functions, so the wording and the error rules are tested without
// rendering. The API decides what is shown; this only words it.
import { ApiError } from '../../api/client';

/** The view the public status endpoint returns. It carries nothing that names the customer. */
export interface PublicStatusView {
  stage: string;
  pendingDocuments: string[];
  /** The date of the last change to the application, YYYY-MM-DD. */
  lastUpdated: string;
  expiresAt: string;
}

/** The line under the stage: the documents still needed, or nothing when none are pending. */
export function pendingLine(pendingDocuments: string[]): string | null {
  return pendingDocuments.length > 0 ? `Pending: ${pendingDocuments.join(', ')}` : null;
}

/** "Last updated 26 Nov 2026". An unreadable date shows no line rather than a wrong one. */
export function updatedLine(lastUpdated: string): string | null {
  const date = new Date(`${lastUpdated}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return `Last updated ${date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

/** What the page says when the link cannot be opened. An expired or unknown link and a rate limit are told apart. */
export function linkErrorMessage(error: unknown): { title: string; body: string } {
  if (error instanceof ApiError && error.code === 'LINK_EXPIRED') {
    return {
      title: 'This link has expired',
      body: 'Ask your relationship manager for a new status link.',
    };
  }
  if (error instanceof ApiError && error.httpStatus === 429) {
    return {
      title: 'Too many tries',
      body: 'Wait a minute, then open the link again.',
    };
  }
  return {
    title: 'This link could not be opened',
    body: 'Check the link you were sent, or ask your relationship manager for a new one.',
  };
}
