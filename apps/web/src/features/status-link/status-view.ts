// What the customer's status page shows (task P3-05, checklist 6.4). Pure functions, so the progress rules and the messages are tested
// without rendering. The API decides every stage and every document; this module only arranges and words what the API returns.
import { ApiError } from '../../api/client';

/** The progress the API computes from the application state. Steps are the customer's labels, in order. */
export interface PublicStatusProgress {
  steps: string[];
  /** The index of the step the application is on, or null when it is off the path (closed, or a state with no label). */
  currentIndex: number | null;
  closed: boolean;
}

/** The view the public status endpoint returns. It carries nothing that names the customer or the application. */
export interface PublicStatusView {
  stage: string;
  progress: PublicStatusProgress;
  pendingDocuments: string[];
  /** The date of the last change to the application, YYYY-MM-DD. */
  lastUpdated: string;
  expiresAt: string;
}

export type ProgressState = 'completed' | 'current' | 'upcoming';

export interface ProgressStep {
  label: string;
  state: ProgressState;
}

/**
 * The steps to draw. Completed steps come before the current one, and upcoming steps after it. Nothing is drawn as completed unless the
 * API has reached it. A closed application, or one off the path, draws no steps: the page shows the stage alone.
 */
export function progressSteps(progress: PublicStatusProgress): ProgressStep[] {
  if (progress.closed || progress.currentIndex === null) return [];
  return progress.steps.map((label, index) => ({
    label,
    state: index < progress.currentIndex! ? 'completed' : index === progress.currentIndex ? 'current' : 'upcoming',
  }));
}

/** "Last updated 26 Nov 2026". An unreadable date shows no line rather than a wrong one. */
export function updatedLine(lastUpdated: string): string | null {
  const date = new Date(`${lastUpdated}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return `Last updated ${date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

export type StatusErrorKind = 'expired' | 'rate-limited' | 'network';

/**
 * Which failure the page is showing. An expired link, an invalid link and an unknown one all answer 410 LINK_EXPIRED, so they are one
 * kind. A rate limit is 429. Anything else, including a dropped connection, is a failure to load.
 */
export function statusErrorKind(error: unknown): StatusErrorKind {
  if (error instanceof ApiError && error.code === 'LINK_EXPIRED') return 'expired';
  if (error instanceof ApiError && error.httpStatus === 429) return 'rate-limited';
  return 'network';
}

/** The customer-facing words for each failure. Technical detail is never shown. */
export const STATUS_ERROR_COPY: Record<StatusErrorKind, { title: string; body: string | null }> = {
  expired: {
    title: 'This status link has expired or is no longer valid.',
    body: 'Ask your relationship manager for a new status link.',
  },
  'rate-limited': {
    title: 'Too many attempts. Please try again in a minute.',
    body: null,
  },
  network: {
    title: "We couldn't load your application status. Please try again.",
    body: null,
  },
};
