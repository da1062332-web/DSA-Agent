// packages/contracts/src/ports/lender-case-status-port.ts — owner: Devyani (lender cases, finance lane). P1-07 / TASK-140.
// Lets the import module move a lender case and record a disbursement without reading or writing either module's tables.
//
// Two interfaces rather than one, because they are owned by two modules: a lender case belongs to MOD-LCS and a sanction
// to MOD-SND. One combined port would have put a query over `sanction` inside the lender-cases implementation.
//
// Every method RUNS INSIDE THE CALLER'S TRANSACTION. A status change, its audit event and its outbox event must commit
// or roll back with the import batch that caused them, and a nested withTenantTx would take a second pooled connection:
// not atomic, and able to deadlock against the locks the caller already holds.
import type { RequestContext, Tx } from '../kernel';
import type { LenderCaseStatus, StatusSource } from '../lender-case';

/** The case a bank's reference number points at, with what the importer needs to decide whether to move it. */
export interface LenderCaseByReference {
  id: string;
  lenderId: string;
  status: LenderCaseStatus;
  lockVersion: number;
}

export interface LenderCaseStatusPort {
  /**
   * The case carrying this lender reference, or null when the sheet names one this tenant does not have.
   * Scoped to the lender: two banks can and do issue the same reference number.
   */
  findByReference(tx: Tx, lenderId: string, lenderReference: string): Promise<LenderCaseByReference | null>;

  /**
   * Moves the case down the same path a person's click takes, so the audit event, the outbox event and the
   * legal-transition rules are identical. Throws AppError for a refused move; the caller turns that into an
   * exception row rather than failing the batch.
   */
  applyStatus(
    tx: Tx,
    ctx: RequestContext,
    caseId: string,
    input: {
      toStatus: LenderCaseStatus;
      statusSource: StatusSource;
      reasonText?: string;
      lenderReference?: string;
    },
    ifMatch: number,
  ): Promise<{ status: LenderCaseStatus; lockVersion: number }>;

  /**
   * Books the daily sweep for cases that stop moving, once per tenant. Called when a status import commits: a tenant
   * that loads bank sheets is the one whose cases can go quiet, and tying the first run to that keeps the background
   * worker out of enumerating tenants. Returns false when a sweep was already booked.
   */
  ensureStalenessSweepScheduled(tx: Tx, tenantId: string): Promise<boolean>;
}

export interface RecordTrancheFromImport {
  amount: number;
  currency: string;
  /** YYYY-MM-DD, after the lender's stated date format has been applied to the sheet's text. */
  disbursedOn: string;
}

export interface SanctionTranchePort {
  /** The live sanction to disburse against, or null — a disbursed row cannot create a tranche without one. */
  findActiveSanctionForCase(tx: Tx, lenderCaseId: string): Promise<{ sanctionId: string } | null>;

  /**
   * Records a tranche at RECORDED against that sanction. Finance verifies it afterwards under SOD-04, and that
   * verification — not this call — is what prices the commission.
   */
  recordTranche(
    tx: Tx,
    ctx: RequestContext,
    sanctionId: string,
    input: RecordTrancheFromImport,
  ): Promise<{ trancheId: string }>;
}
