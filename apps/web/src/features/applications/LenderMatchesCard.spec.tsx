// P1-04 Lender matches card (owner: Dipanshu). Rendered with the prefill and the latest run already in the query cache, so the inputs,
// the ranked results, the reasons and the Create lender case button can be checked, and the card is hidden without lender_match.run.
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as useMeModule from '../../api/useMe';
import { LenderMatchesCard } from './LenderMatchesCard';

vi.mock('../../api/useMe', async () => {
  const actual = await vi.importActual<typeof useMeModule>('../../api/useMe');
  return { ...actual, useMe: vi.fn() };
});

const APP = 'app_01JD8Y3Z4K5M6N7P8Q9R0S1T2V';
const BASE = `/v1/applications/${APP}/lender-matches`;
const inputs = {
  requestedAmount: { amount: '1000000.00', currency: 'INR' },
  tenureMonths: 60,
  monthlyIncome: { amount: '60000.00', currency: 'INR' },
  monthlyObligations: { amount: '10000.00', currency: 'INR' },
  ageYears: null,
  pincode: '560034',
  bureauScore: 742,
  collateralValue: null,
  employmentType: 'SALARIED',
  constitution: null,
  vintageMonths: null,
};
const result = (over: Record<string, unknown>) => ({
  rank: 1,
  policyId: 'lpo_A',
  lenderId: 'lnd_A',
  lenderName: 'Lender A',
  productVersionId: 'prv_A',
  productName: 'Lender A PL',
  outcome: 'ELIGIBLE',
  reasons: [],
  missingFields: [],
  eligibleAmount: { amount: '899100.00', currency: 'INR' },
  limitedBy: 'FOIR',
  emiMin: { amount: '19325.10', currency: 'INR' },
  emiMax: { amount: '20000.00', currency: 'INR' },
  foirBps: 5000,
  processingFee: null,
  rateMinBps: 1050,
  rateMaxBps: 1200,
  ...over,
});
const none = { eligibleAmount: null, limitedBy: null, emiMin: null, emiMax: null, foirBps: null };
const run = {
  id: 'lmr_1',
  applicationId: APP,
  evaluatedAt: '2026-11-27T09:00:00.000Z',
  inputs,
  inputsHash: `sha256:${'0'.repeat(64)}`,
  policyCount: 3,
  eligibleCount: 1,
  results: [
    result({}),
    result({
      rank: 2,
      policyId: 'lpo_D',
      lenderName: 'Lender D',
      outcome: 'NEEDS_DATA',
      missingFields: ['collateralValue'],
      ...none,
    }),
    result({
      rank: 3,
      policyId: 'lpo_B',
      lenderName: 'Lender B',
      outcome: 'NOT_ELIGIBLE',
      reasons: ['BUREAU_SCORE_BELOW_MIN'],
      ...none,
    }),
  ],
  createdBy: 'usr_1',
};

function setMe(codes: string[]) {
  vi.mocked(useMeModule.useMe).mockReturnValue({
    data: {
      id: 'usr_1',
      permissions: codes,
      grants: codes.map((code) => ({ code, scope: 'TENANT', branchIds: [] })),
    },
    isPending: false,
  } as unknown as ReturnType<typeof useMeModule.useMe>);
}

function render(latest: unknown = run) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData([BASE, 'inputs'], {
    applicationId: APP,
    inputs,
    sources: { requestedAmount: 'APPLICATION' },
  });
  qc.setQueryData([BASE, 'latest'], latest);
  return renderToString(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <LenderMatchesCard applicationId={APP} productCategory="PL" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('P1-04 Lender matches card', () => {
  beforeEach(() => setMe(['lender_match.run', 'lender_case.submit']));

  it('P1-04 shows the ranked results: amount, EMI band, FOIR, what limited it, and why the others were not matched', () => {
    const html = render();
    expect(html).toContain('data-testid="lenderMatches.card"');
    expect(html).toContain('1 of 3 lender policies eligible');
    expect(html).toContain('₹8,99,100.00');
    expect(html).toContain('₹19,325.10 – ₹20,000.00');
    expect(html).toContain('50.00%');
    expect(html).toContain('Limited by the FOIR cap');
    expect(html).toContain('Needs: Collateral value');
    expect(html).toContain('Bureau score below the minimum');
    expect(html).toContain('Not an offer or a sanction');
  });

  it('P1-04 figures that do not apply to a row are left blank, not shown as "Not set"; a policy with no fee says None', () => {
    const html = render();
    expect(html).not.toContain('Not set');
    expect(html).toContain('None');
    setMe(['lender_match.run']); // no case button: the action cell is empty too
    expect(render()).not.toContain('Not set');
  });

  it('P1-04 only an ELIGIBLE row offers Create lender case, and only with lender_case.submit', () => {
    expect(render()).toContain('data-testid="lenderMatches.createCase.lpo_A"');
    expect(render()).not.toContain('lenderMatches.createCase.lpo_B');
    setMe(['lender_match.run']);
    expect(render()).not.toContain('lenderMatches.createCase');
  });

  it('P1-04 the inputs are prefilled and say where they came from; no run yet shows the empty state', () => {
    const html = render(null);
    expect(html).toContain('data-testid="lenderMatches.input.requestedAmount"');
    expect(html).toContain('value="1000000"');
    expect(html).toContain('from the application');
    expect(html).toContain('data-testid="lenderMatches.run"');
    expect(html).toContain('No match has been run for this application yet.');
  });

  it('P1-04 without lender_match.run the card is not shown', () => {
    setMe(['application.read', 'application.update']);
    expect(render()).toBe('');
  });
});
