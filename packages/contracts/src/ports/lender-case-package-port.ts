// packages/contracts/src/ports/lender-case-package-port.ts — owner: Dipanshu (MOD-LCS provides, MOD-APP consumes; task P2-04).
// Lets the pack download (origination/applications) read a lender case's current submission package without reading the lender
// case tables. Runs inside the caller's transaction, so row-level security limits it to the caller's tenant. Read-only.
import type { Tx } from '../kernel';

/** One document the frozen manifest lists. sha256 is null when the package builder had no stored hash for it. */
export interface FrozenPackageDocument {
  checklistItemId: string;
  documentTypeCode: string;
  documentId: string;
  sha256: string | null;
}

export interface LenderCasePackageView {
  lenderCaseId: string;
  lenderId: string;
  applicationId: string;
  /** null when no package has been built for the case yet. */
  packageId: string | null;
  frozenAt: Date | null;
  manifestSha256: string | null;
  /** true when the stored manifest still hashes to manifest_sha256 (it was not altered after it was built). */
  manifestIntact: boolean;
  documents: FrozenPackageDocument[];
}

export interface LenderCasePackagePort {
  /** The case and its current submission package, or null when the case is not in the caller's tenant. */
  currentPackage(tx: Tx, lenderCaseId: string): Promise<LenderCasePackageView | null>;
}
