// P2-04 Lender pack profile card and Download pack button (owner: Dipanshu). Rendered with the profile already in the query cache,
// so the order, the pattern, the default notice and the controls each permission unlocks can be checked.
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as useMeModule from '../../api/useMe';
import { DownloadPackButton } from './DownloadPackButton';
import { LenderPackProfileCard } from './LenderPackProfileCard';

vi.mock('../../api/useMe', async () => {
  const actual = await vi.importActual<typeof useMeModule>('../../api/useMe');
  return { ...actual, useMe: vi.fn() };
});

const LENDER = 'lnd_1';
const PATH = `/v1/lenders/${LENDER}/pack-profile`;
const saved = {
  lenderId: LENDER,
  isDefault: false,
  documentOrder: ['PAN', 'BANK_STATEMENT'],
  filenamePattern: '{seq}_{docType}_{party}',
  version: 2,
  updatedAt: '2026-11-28T05:00:00.000Z',
  updatedBy: 'usr_1',
};

function setMe(codes: string[]) {
  vi.mocked(useMeModule.useMe).mockReturnValue({
    data: { id: 'usr_1', grants: codes.map((code) => ({ code, scope: 'TENANT', branchIds: [] })) },
    isPending: false,
  } as unknown as ReturnType<typeof useMeModule.useMe>);
}

function render(node: React.ReactNode, profile: unknown = saved) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData([PATH], profile);
  qc.setQueryData(
    ['/v1/document-types', 'lookup', {}],
    [
      { code: 'PAN', name: 'PAN card' },
      { code: 'BANK_STATEMENT', name: 'Bank statement' },
    ],
  );
  return renderToString(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('P2-04 Lender pack profile card', () => {
  beforeEach(() => setMe(['lender.read']));

  it('TEST-PACK-WEB-004 shows the document order by name and the file name pattern', () => {
    const html = render(<LenderPackProfileCard lenderId={LENDER} />);
    expect(html).toContain('data-testid="lenderPack.card"');
    expect(html).toContain('1. PAN card');
    expect(html).toContain('2. Bank statement');
    expect(html).toContain('{seq}_{docType}_{party}');
    expect(html).not.toContain('lenderPack.default');
  });

  it('TEST-PACK-WEB-005 a lender on the default says so', () => {
    const html = render(<LenderPackProfileCard lenderId={LENDER} />, {
      ...saved,
      isDefault: true,
      documentOrder: [],
      filenamePattern: '{seq}_{docType}',
      version: 0,
    });
    expect(html).toContain('data-testid="lenderPack.default"');
    expect(html).toContain('As in the package');
  });

  it('TEST-PACK-WEB-006 Edit needs lender.manage or config.manage; without any lender permission the card is hidden', () => {
    expect(render(<LenderPackProfileCard lenderId={LENDER} />)).not.toContain('lenderPack.edit');
    setMe(['lender.manage']);
    expect(render(<LenderPackProfileCard lenderId={LENDER} />)).toContain('data-testid="lenderPack.edit"');
    setMe(['config.manage']);
    expect(render(<LenderPackProfileCard lenderId={LENDER} />)).toContain('data-testid="lenderPack.edit"');
    setMe(['application.read']);
    expect(render(<LenderPackProfileCard lenderId={LENDER} />)).toBe('');
  });

  it('TEST-PACK-WEB-007 Download pack shows for lender_case.submit, and is disabled until the package is frozen', () => {
    setMe(['lender_case.submit']);
    expect(render(<DownloadPackButton lenderCaseId="lcs_1" frozen />)).toContain(
      'data-testid="lenderPack.download"',
    );
    expect(render(<DownloadPackButton lenderCaseId="lcs_1" frozen={false} />)).toMatch(
      /disabled=""[^>]*data-testid="lenderPack\.download"|data-testid="lenderPack\.download"[^>]*disabled=""/,
    );
    setMe(['lender.read', 'document.download']);
    expect(render(<DownloadPackButton lenderCaseId="lcs_1" frozen />)).toBe('');
  });
});
