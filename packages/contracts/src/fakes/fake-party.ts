// Fake PartyPort (Contracts §4.5): in-memory map seeded by the test.
import type { Tx } from '../kernel';
import type { Party, PartyPort } from '../ports/crm-ports';

export class FakePartyPort implements PartyPort {
  /** Keyed by customerId. */
  readonly parties = new Map<string, Party>();

  async getParty(_tx: Tx, customerId: string): Promise<Party | null> {
    return this.parties.get(customerId) ?? null;
  }
}
