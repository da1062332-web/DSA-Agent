// P1-04 Lender policy grid card (owner: Dipanshu). The list comes from mocked hooks, so the version list, the status chips and the
// actions each permission unlocks can be checked: Edit and New need lender_policy.manage, Activate needs rule.approve and is disabled
// for an editor of the draft (maker-checker), Retire is offered on the ACTIVE version only.
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as useMeModule from '../../api/useMe';
import { LenderPoliciesCard } from './LenderPoliciesCard';

const rows = vi.hoisted(() => ({ data: [] as unknown[] }));

vi.mock('../../api/useMe', async () => {
  const actual = await vi.importActual<typeof useMeModule>('../../api/useMe');
  return { ...actual, useMe: vi.fn() };
});
vi.mock('../admin/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useList: () => ({ data: { pages: [{ data: rows.data }] }, isPending: false, error: null }),
  useLookup: () => ({
    data: [{ id: 'prd_1', name: 'Salary PL', category: 'PL' }],
    isPending: false,
    error: null,
  }),
  useResource: () => ({
    data: { id: 'prv_1', productId: 'prd_1', versionNo: 2 },
    isPending: false,
    error: null,
  }),
  useCommand: () => ({ mutate: () => undefined, isPending: false, error: null }),
}));

const policy = (over: Record<string, unknown>) => ({
  id: 'lpo_1',
  lenderId: 'lnd_1',
  productVersionId: 'prv_1',
  status: 'DRAFT',
  versionNo: 2,
  rateMinBps: 1050,
  rateMaxBps: 1200,
  foirCapBps: 5000,
  minBureauScore: 700,
  effectiveFrom: '2026-11-30T18:30:00.000Z',
  effectiveTo: null,
  editors: ['usr_maker'],
  version: 0,
  ...over,
});

function setMe(id: string, codes: string[]) {
  vi.mocked(useMeModule.useMe).mockReturnValue({
    data: { id, grants: codes.map((code) => ({ code, scope: 'TENANT', branchIds: [] })) },
    isPending: false,
  } as unknown as ReturnType<typeof useMeModule.useMe>);
}

const render = (lenderOpen = true) =>
  renderToString(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <LenderPoliciesCard lenderId="lnd_1" lenderOpen={lenderOpen} />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('P1-04 Lender policy grid card', () => {
  beforeEach(() => {
    rows.data = [policy({}), policy({ id: 'lpo_0', status: 'ACTIVE', versionNo: 1, editors: ['usr_other'] })];
  });

  it('P1-04 lists every version with its product, status, rate band, FOIR cap and start date', () => {
    setMe('usr_maker', ['lender_policy.read']);
    const html = render();
    expect(html).toContain('data-testid="lenderPolicy.card"');
    expect(html).toContain('Salary PL · v2');
    expect(html).toContain('data-testid="lenderPolicy.status.lpo_1"');
    expect(html).toContain('10.5 – 12%');
    expect(html).toContain('50%');
    expect(html).toContain('2026-12-01');
  });

  it('P1-04 a maker can draft, edit and retire, but Activate is disabled on their own draft', () => {
    setMe('usr_maker', ['lender_policy.read', 'lender_policy.manage', 'rule.approve']);
    const html = render();
    expect(html).toContain('data-testid="lenderPolicy.new"');
    expect(html).toContain('data-testid="lenderPolicy.edit.lpo_1"');
    expect(html).toContain('data-testid="lenderPolicy.retire.lpo_0"');
    expect(html).toMatch(
      /disabled=""[^>]*data-testid="lenderPolicy\.activate\.lpo_1"|data-testid="lenderPolicy\.activate\.lpo_1"[^>]*disabled=""/,
    );
  });

  it('P1-04 a checker who did not edit the draft can activate it, and sees no edit controls', () => {
    setMe('usr_checker', ['lender_policy.read', 'rule.approve']);
    const html = render();
    expect(html).toContain('data-testid="lenderPolicy.activate.lpo_1"');
    expect(html).not.toMatch(
      /disabled=""[^>]*data-testid="lenderPolicy\.activate\.lpo_1"|data-testid="lenderPolicy\.activate\.lpo_1"[^>]*disabled=""/,
    );
    expect(html).not.toContain('lenderPolicy.new');
    expect(html).not.toContain('lenderPolicy.edit.');
    expect(html).not.toContain('lenderPolicy.retire.');
  });

  it('P1-04 a terminated lender takes no new drafts; without lender_policy.read the card is hidden', () => {
    setMe('usr_maker', ['lender_policy.read', 'lender_policy.manage']);
    expect(render(false)).not.toContain('lenderPolicy.new');
    setMe('usr_maker', ['lender.read']);
    expect(render()).toBe('');
  });
});
