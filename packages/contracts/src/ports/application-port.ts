// packages/contracts/src/ports/application-port.ts — owner: Dev 3 — frozen at Gate 1 (Contracts §4.3)
// Consumers: Dev 5 (lead conversion), Dev 4 (lender cases), sanctions (status roll-up).
// Fake: fakes/fake-application.ts — TODO(Dev 3, Gate 1) per Contracts §4.5.
import type { Money } from '../money';
import type { RequestContext, Tx } from '../kernel';
import type { ApplicantType, ProductCategory } from './decision-keys';

export type PurposeCode =
  | 'PERSONAL_NEEDS'
  | 'MEDICAL'
  | 'EDUCATION'
  | 'HOME_PURCHASE'
  | 'HOME_IMPROVEMENT'
  | 'VEHICLE'
  | 'WORKING_CAPITAL'
  | 'BUSINESS_EXPANSION'
  | 'DEBT_CONSOLIDATION'
  | 'OTHER';

export interface CreateDraftFromConversionCommand {
  leadId: string;
  customerId: string;
  branchId: string;
  partyType: 'INDIVIDUAL' | 'ENTITY';
  productCategory: ProductCategory;
  requestedAmount: Money;
  tenureMonths?: number;
  purposeCode?: PurposeCode;
  applicantType: ApplicantType;
  salesOwnerUserId: string;
}

export type ChecklistItemStatus =
  | 'PENDING'
  | 'SUBMITTED'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'WAIVED'
  | 'NOT_APPLICABLE'
  | 'EXPIRED';

/** One checklist row as a lender submission package sees it (MOD-DOC SUB-DOC.02, ENT-048). */
export interface SubmissionDocument {
  checklistItemId: string;
  partyId: string;
  documentTypeCode: string;
  mandatory: boolean;
  status: ChecklistItemStatus;
  documentId: string | null;
  /** sha256 of the stored document file; null when nothing is uploaded for the item. */
  sha256: string | null;
}

export interface SubmissionDocuments {
  /** Every mandatory item is ACCEPTED, WAIVED or NOT_APPLICABLE, and the checklist is not empty. */
  complete: boolean;
  documents: SubmissionDocument[];
}

/** loan_application.status (ENT-045, Doc 02 names). */
export type ApplicationStatusCode =
  | 'DRAFT'
  | 'DOCUMENTS_PENDING'
  | 'UNDER_REVIEW'
  | 'READY_FOR_SUBMISSION'
  | 'SUBMITTED'
  | 'SANCTIONED'
  | 'PARTIALLY_DISBURSED'
  | 'DISBURSED'
  | 'CLOSED'
  | 'REJECTED'
  | 'WITHDRAWN'
  | 'CANCELLED';

/** What another module may know about an application (MOD-LCS, MOD-SND). */
export interface ApplicationSummary {
  id: string;
  branchId: string;
  customerId: string;
  productCategory: ProductCategory;
  status: ApplicationStatusCode;
  subStatus: 'QUERY_PENDING' | null;
  version: number;
}

/**
 * The lender roll-ups (Doc 02): ROLLUP-1 submitted, ROLLUP-2 query pending, ROLLUP-3 query answered, ROLLUP-4 sanctioned,
 * ROLLUP-5 partly or fully disbursed, ROLLUP-6 every lender case rejected or withdrawn.
 */
export type ApplicationRollUpCode = 'ROLLUP-1' | 'ROLLUP-2' | 'ROLLUP-3' | 'ROLLUP-4' | 'ROLLUP-5' | 'ROLLUP-6';

export interface ApplicationRollUpCommand {
  applicationId: string;
  transitionCode: ApplicationRollUpCode;
  /** The status after the roll-up; the current status for ROLLUP-2 and ROLLUP-3, which change only the sub-status. */
  toStatus: ApplicationStatusCode;
  toSubStatus: 'QUERY_PENDING' | null;
  causedByLenderCaseId: string;
  /** The lender case's product version; recorded on the application only when it has none yet (ROLLUP-1 from a draft). */
  productVersionId?: string | null;
}

export interface ApplicationRollUpResult {
  applicationId: string;
  fromStatus: ApplicationStatusCode;
  toStatus: ApplicationStatusCode;
  /** false when the application was already in the target status and sub-status, so nothing was written. */
  changed: boolean;
}

export interface ApplicationPort {
  /** Inside caller tx (FR-LEAD-015 atomic conversion). Creates loan_application DRAFT + PRIMARY application_party
   *  + status history + application.created event + audit. Throws VALIDATION_ERROR on invalid input. */
  createDraftFromConversion(
    tx: Tx,
    ctx: RequestContext,
    cmd: CreateDraftFromConversionCommand,
  ): Promise<{ applicationId: string; status: 'DRAFT' }>;

  /** Inside caller tx. The application's checklist and stored document hashes, for lender packages (MOD-LCS).
   *  Added 2026-10-19 (additive, Contracts §15). NOT_FOUND when the application is not visible in the tenant. */
  getSubmissionDocuments(tx: Tx, ctx: RequestContext, applicationId: string): Promise<SubmissionDocuments>;

  /** Inside caller tx. The application in the caller's tenant, or null. `forUpdate` locks the row until the caller's
   *  transaction ends. The caller applies its own permission and scope rules. Added 2026-10-28 (additive, Contracts §15). */
  getApplicationSummary(
    tx: Tx,
    ctx: RequestContext,
    applicationId: string,
    opts?: { forUpdate?: boolean },
  ): Promise<ApplicationSummary | null>;

  /** Inside caller tx. Applies a lender roll-up: status, sub-status, history, application.state_changed event (when the
   *  status changes) and audit, all in the caller's transaction. null when the application is not in the tenant.
   *  Added 2026-10-28 (additive, Contracts §15); lender cases and sanctions no longer write loan_application. */
  rollUpStatus(
    tx: Tx,
    ctx: RequestContext,
    cmd: ApplicationRollUpCommand,
  ): Promise<ApplicationRollUpResult | null>;

  /** Inside caller tx. Call after a checklist item's status changed (a document accepted, a waiver, an attestation). When that leaves
   *  every mandatory item ACCEPTED, WAIVED or NOT_APPLICABLE on an application that is DOCUMENTS_PENDING and not on hold, the
   *  application moves to UNDER_REVIEW as T-APP-02, with status history, outbox event and audit event; otherwise nothing happens.
   *  Added 2026-10-28 (additive, Contracts §15). */
  onChecklistItemChanged(tx: Tx, ctx: RequestContext, checklistItemId: string): Promise<{ advanced: boolean }>;
}
