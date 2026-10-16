// The scripts a data correction may name (owner: Dev 1; Module 40, SUB-ADM.07). A correction's `scriptRef` (for example SCR-2026-001) selects one
// of these. Only code that has been reviewed and merged can run, so a free-text request can never change data by itself: the executor refuses
// any scriptRef that is not in this list and marks the correction FAILED.
//
// It is empty on purpose: no correction script has been reviewed yet. To add one, write it as a CorrectionScript (a dry run that only reads and
// describes the change, and an apply that makes it), add a test that runs it against a throwaway database, and register it below under its
// reference. A script must be idempotent, must touch only what its reference says, and must throw a short message that holds no personal data.
import type { CorrectionScript } from './data-correction-executor';

export const registeredCorrectionScripts: ReadonlyMap<string, CorrectionScript> = new Map<
  string,
  CorrectionScript
>([
  // ['SCR-2026-001', branchRenameScript],
]);
