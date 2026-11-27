// Fake KycCheckPort (Contracts §4.5) for route tests: records every request and answers from a script. Owner: Prathamesh.
import type { RequestContext, Tx } from '../kernel';
import type { KycCheckPort, KycCheckRequest, KycCheckResult } from '../ports/kyc-port';

/** A VERIFIED PAN result with masked data only. Override what a test needs. */
export function fakeKycResult(overrides: Partial<KycCheckResult> = {}): KycCheckResult {
  return {
    provider: 'FAKE',
    outcome: 'VERIFIED',
    verificationResult: 'VERIFIED',
    matchScore: null,
    identifierMasked: 'ABCDE****F',
    referenceId: 'fake_ref_1',
    reason: null,
    minimalResult: {
      statusDescription: 'PAN verified',
      maskedIdentifier: 'ABCDE****F',
      discrepancies: [],
      providerReference: 'fake_ref_1',
    },
    ...overrides,
  };
}

export class FakeKycCheckPort implements KycCheckPort {
  /** Every request the port was asked to run, in order. */
  readonly requests: KycCheckRequest[] = [];
  private readonly script: (KycCheckResult | Error)[] = [];

  /** Queue answers. They are used in order and the last one repeats. An Error is thrown instead of returned. */
  respondWith(...answers: (KycCheckResult | Error)[]): this {
    this.script.push(...answers);
    return this;
  }

  async run(_tx: Tx, _ctx: RequestContext, request: KycCheckRequest): Promise<KycCheckResult> {
    this.requests.push(request);
    const next = (this.script.length > 1 ? this.script.shift() : this.script[0]) ?? fakeKycResult();
    if (next instanceof Error) throw next;
    return next;
  }
}
