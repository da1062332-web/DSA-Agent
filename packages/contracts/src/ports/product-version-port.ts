// packages/contracts/src/ports/product-version-port.ts — owner: Dev 3 (MOD-PRD provides, MOD-APP consumes).
// Lets the applications module check a product version (T-APP-01) without reading the catalogue tables.
// Runs inside the caller's transaction, so row-level security limits it to the caller's tenant.
import type { Tx } from '../kernel';

export interface ProductVersionSummary {
  id: string;
  productId: string;
  /** Product category, for example PL. It must match the application's product category. */
  category: string;
  versionStatus: 'ACTIVE' | 'RETIRED';
  productStatus: 'ACTIVE' | 'INACTIVE';
  /** True when this is the active version in force today (its effective date has been reached). */
  inForce: boolean;
}

export interface ProductVersionPort {
  /** null when the version does not exist in the caller's tenant. */
  getVersion(tx: Tx, id: string, now: Date): Promise<ProductVersionSummary | null>;
}
