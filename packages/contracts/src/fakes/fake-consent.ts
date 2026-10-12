// Fake ConsentPort (Contracts §4.5): in-memory map seeded by the test; direct map access for overrides.
import type { Tx } from '../kernel';
import type { ConsentPort, ConsentPurpose } from '../ports/crm-ports';

export interface FakeConsent {
  consentId: string;
  customerId: string;
  purpose: ConsentPurpose;
  purposeTarget?: string;
  status: 'ACTIVE' | 'WITHDRAWN';
}

export class FakeConsentPort implements ConsentPort {
  /** Keyed by consentId. */
  readonly consents = new Map<string, FakeConsent>();

  async findActive(
    _tx: Tx,
    q: { customerId: string; purpose: ConsentPurpose; purposeTarget?: string },
  ): Promise<{ consentId: string } | null> {
    for (const c of this.consents.values()) {
      if (
        c.status === 'ACTIVE' &&
        c.customerId === q.customerId &&
        c.purpose === q.purpose &&
        (q.purposeTarget === undefined || c.purposeTarget === q.purposeTarget)
      ) {
        return { consentId: c.consentId };
      }
    }
    return null;
  }
}
