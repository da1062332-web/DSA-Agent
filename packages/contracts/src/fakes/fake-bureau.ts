// Fake BureauPullPort (Contracts §4.5) for route tests: records every request and answers from a script. Owner: Prathamesh.
import type { RequestContext, Tx } from '../kernel';
import type { BureauPullPort, BureauPullRequest, BureauPullResult } from '../ports/bureau-port';

/** A SCORED result with a summary and no personal data. Override what a test needs. */
export function fakeBureauResult(overrides: Partial<BureauPullResult> = {}): BureauPullResult {
  return {
    provider: 'FAKE',
    outcome: 'SCORED',
    reportDate: '2026-11-28',
    summary: {
      score: 742,
      activeAccounts: 3,
      monthlyEmi: { amount: '18400.00', currency: 'INR' },
      maxDpd12m: 0,
      enquiries6m: 1,
    },
    vendorRef: 'fake_bureau_ref_1',
    unitCost: null,
    ...overrides,
  };
}

export class FakeBureauPullPort implements BureauPullPort {
  /** Every request the port was asked to pull, in order. */
  readonly requests: BureauPullRequest[] = [];
  private readonly script: (BureauPullResult | Error)[] = [];

  /** Queue answers. They are used in order and the last one repeats. An Error is thrown instead of returned. */
  respondWith(...answers: (BureauPullResult | Error)[]): this {
    this.script.push(...answers);
    return this;
  }

  async pull(_tx: Tx, _ctx: RequestContext, request: BureauPullRequest): Promise<BureauPullResult> {
    this.requests.push(request);
    const next = (this.script.length > 1 ? this.script.shift() : this.script[0]) ?? fakeBureauResult();
    if (next instanceof Error) throw next;
    return next;
  }
}
