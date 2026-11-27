// TEST-UI-CUST-P102 customer profile tabs (task P1-02). Rendered on the server with query data seeded, so no network is used.
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import * as useMeModule from '../../api/useMe';
import { AddressesTab, IdentityTab, ProfileTab } from './CustomerProfileTabs';

vi.mock('../../api/useMe', async () => {
  const actual = await vi.importActual<typeof useMeModule>('../../api/useMe');
  return { ...actual, useMe: vi.fn() };
});

const ID = 'cust_ui_1';
const mockUseMe = vi.mocked(useMeModule.useMe);
const grant = (codes: string[]) =>
  mockUseMe.mockReturnValue({
    data: {
      id: 'usr_1',
      tenantId: 'ten_1',
      email: 'user@example.com',
      displayName: 'User',
      primaryBranchId: null,
      queueIds: [],
      grants: codes.map((code) => ({ code, scope: 'TENANT', branchIds: [] })),
    },
  } as never);

function render(node: React.ReactNode, seed: (c: QueryClient) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  seed(client);
  return renderToString(
    <QueryClientProvider client={client}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const identity = (over: object = {}) => ({
  identity: {
    customerId: ID,
    panMasked: 'ZZZPZ****Z',
    hasDateOfBirth: true,
    birthYear: 1990,
    possibleDuplicatePan: false,
    lockVersion: 1,
    updatedAt: '2026-11-27T00:00:00.000Z',
    ...over,
  },
  etag: '"1"',
});

describe('TEST-UI-CUST-P102 customer profile tabs', () => {
  it('TEST-UI-CUST-P102-01 identity shows only the masked PAN and the birth year, never a full date', () => {
    grant(['customer.read']);
    const html = render(<IdentityTab customerId={ID} readOnly />, (c) =>
      c.setQueryData(['customer-identity', ID], identity()),
    );
    expect(html).toContain('ZZZPZ****Z');
    expect(html).toContain('born 1990');
    expect(html).not.toContain('customer.identity.reveal-pan');
    expect(html).not.toContain('customer.identity.save');
  });

  it('TEST-UI-CUST-P102-02 the Reveal buttons appear only with customer.reveal_sensitive', () => {
    grant(['customer.read', 'customer.reveal_sensitive']);
    const html = render(<IdentityTab customerId={ID} readOnly={false} />, (c) =>
      c.setQueryData(['customer-identity', ID], identity()),
    );
    expect(html).toContain('customer.identity.reveal-pan');
    expect(html).toContain('customer.identity.reveal-dob');
    expect(html).toContain('customer.identity.save');
  });

  it('TEST-UI-CUST-P102-03 a duplicate PAN shows the review warning', () => {
    grant(['customer.read']);
    const html = render(<IdentityTab customerId={ID} readOnly />, (c) =>
      c.setQueryData(['customer-identity', ID], identity({ possibleDuplicatePan: true })),
    );
    expect(html).toContain('customer.identity.duplicate');
  });

  it('TEST-UI-CUST-P102-04 profile and addresses render their data; read-only hides the controls', () => {
    grant(['customer.read']);
    const profile = render(<ProfileTab customerId={ID} readOnly />, (c) =>
      c.setQueryData(['customer-profile', ID], {
        profile: {
          customerId: ID,
          constitution: null,
          employmentType: 'SALARIED',
          employerName: 'Synthetic Systems',
          businessName: null,
          vintageMonths: 24,
          gstin: null,
          udyamNumber: null,
          monthlyIncome: { amount: '60000.00', currency: 'INR' },
          monthlyObligations: null,
          lockVersion: 1,
          updatedAt: null,
        },
        etag: '"1"',
      }),
    );
    expect(profile).not.toContain('customer.profile.save');
    const addresses = render(<AddressesTab customerId={ID} readOnly />, (c) =>
      c.setQueryData(
        ['customer-addresses', ID],
        [
          {
            id: 'cad_1',
            customerId: ID,
            addressType: 'CURRENT',
            line1: 'Flat 4, Shanti Nagar',
            line2: null,
            landmark: null,
            city: 'Pune',
            state: 'Maharashtra',
            pincode: '411001',
            ownership: 'RENTED',
            yearsAtAddress: 3,
            lockVersion: 0,
            createdAt: '2026-11-27T00:00:00.000Z',
            updatedAt: '2026-11-27T00:00:00.000Z',
          },
        ],
      ),
    );
    expect(addresses).toContain('Flat 4, Shanti Nagar');
    expect(addresses).toContain('411001');
    expect(addresses).not.toContain('customer.address.add');
  });
});
