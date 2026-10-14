// Fake ProductVersionPort (Contracts §4.5) for route tests: versions are seeded in memory.
import type { Tx } from '../kernel';
import type { ProductVersionPort, ProductVersionSummary } from '../ports/product-version-port';

export class FakeProductVersionPort implements ProductVersionPort {
  readonly versions = new Map<string, ProductVersionSummary>();

  async getVersion(_tx: Tx, id: string): Promise<ProductVersionSummary | null> {
    return this.versions.get(id) ?? null;
  }
}
