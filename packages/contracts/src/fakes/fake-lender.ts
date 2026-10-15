// Fake LenderPort (Contracts §4.5) for route tests.
import type { Tx } from '../kernel';
import type { LenderPort } from '../ports/lender-port';

export class FakeLenderPort implements LenderPort {
  readonly lenders = new Set<string>();

  async exists(_tx: Tx, lenderId: string): Promise<boolean> {
    return this.lenders.has(lenderId);
  }
}
