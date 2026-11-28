// packages/contracts/src/ports/lender-policy-port.ts — owner: Dipanshu (MOD-LND provides, MOD-APP consumes; task P1-04).
// Lets the applications module load the lender policies a match run evaluates without reading the catalogue tables.
// Runs inside the caller's transaction, so row-level security limits it to the caller's tenant. Money is integer paise,
// the unit @dsa/bre-core matchLenders works in.
import type { Tx } from '../kernel';

/** One ACTIVE policy joined with its lender and product version: the input shape of bre-core LenderPolicyTerms, plus names. */
export interface MatchablePolicy {
  policyId: string;
  lenderId: string;
  lenderName: string;
  productVersionId: string;
  productName: string;
  amountMinPaise: number;
  amountMaxPaise: number;
  tenureMinMonths: number;
  tenureMaxMonths: number;
  minBureauScore: number | null;
  minAge: number | null;
  maxAgeAtMaturity: number | null;
  minIncomePaise: number | null;
  foirCapBps: number | null;
  ltvCapBps: number | null;
  rateMinBps: number;
  rateMaxBps: number;
  processingFeeBps: number | null;
  serviceablePincodes: string[];
  allowedConstitutions: string[];
  allowedEmployment: string[];
  minVintageMonths: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface LenderPolicyPort {
  /**
   * The ACTIVE policies of ACTIVE lenders with an ACTIVE empanelment valid on `now` that permits `category`, for ACTIVE
   * products of that category whose version is ACTIVE. Ordered by policy id, so a run is reproducible.
   */
  matchablePolicies(tx: Tx, category: string, now: Date): Promise<MatchablePolicy[]>;
  /** Names and rate bands for stored results, whatever the policy's status now. Ids not visible to the tenant are left out. */
  describePolicies(tx: Tx, policyIds: readonly string[]): Promise<Map<string, PolicyLabel>>;
}

export interface PolicyLabel {
  lenderName: string;
  productName: string;
  rateMinBps: number;
  rateMaxBps: number;
}
