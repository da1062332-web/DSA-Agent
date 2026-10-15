// apps/web/src/features/invoices/InvoicesPage.spec.tsx — Module 33: Invoices UI Tests
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../shell/toast';
import { InvoicesPage } from './InvoicesPage';

vi.mock('../../api/useMe', () => ({
  useMe: () => ({
    data: {
      id: 'usr_fin_exec_01',
      displayName: 'Finance Manager',
      grants: [
        { code: 'invoice.manage', scope: 'TENANT', branchIds: [] },
        { code: 'finance.view', scope: 'TENANT', branchIds: [] },
      ],
    },
    isLoading: false,
  }),
  hasPermission: () => true,
}));

vi.mock('./api', () => ({
  getInvoices: vi.fn().mockResolvedValue({
    data: [
      {
        id: 'inv_01',
        tenantId: 'ten_01',
        direction: 'TO_LENDER',
        number: 'INV-2026-901',
        date: '2026-10-15',
        dueDate: '2026-11-15',
        amount: 150000,
        currency: 'INR',
        taxFields: { gstRate: 18, gstAmount: 27000, hsnSac: '9971' },
        status: 'DRAFT',
        calculationIds: ['ccal_01'],
        partyId: 'lnd_hdfc',
        partyName: 'HDFC Bank',
        notes: 'Monthly origination fee invoice',
        lockVersion: 0,
        createdAt: '2026-10-15T10:00:00Z',
        createdBy: 'usr_fin_exec_01',
        updatedAt: '2026-10-15T10:00:00Z',
        updatedBy: 'usr_fin_exec_01',
      },
      {
        id: 'inv_02',
        tenantId: 'ten_01',
        direction: 'FROM_CONNECTOR',
        number: 'INV-CONN-042',
        date: '2026-10-14',
        dueDate: null,
        amount: 35000,
        currency: 'INR',
        taxFields: { tdsRate: 10, tdsAmount: 3500 },
        status: 'ISSUED',
        calculationIds: [],
        partyId: 'con_01',
        partyName: 'Apex Capital Associates',
        notes: 'Partner commission invoice',
        lockVersion: 1,
        createdAt: '2026-10-14T09:00:00Z',
        createdBy: 'usr_fin_exec_01',
        updatedAt: '2026-10-14T11:00:00Z',
        updatedBy: 'usr_fin_exec_01',
      },
    ],
    nextCursor: null,
  }),
  createInvoice: vi.fn().mockResolvedValue({ invoice: {}, etag: '"0"' }),
  updateInvoiceStatus: vi.fn().mockResolvedValue({ invoice: {}, etag: '"1"' }),
  getConnectorStatements: vi.fn().mockResolvedValue({
    connectorId: 'con_01',
    fromDate: '2026-09-01',
    toDate: '2026-10-15',
    currency: 'INR',
    openingBalance: 20000,
    totalCredits: 60000,
    totalDebits: 35000,
    netChange: 25000,
    closingBalance: 45000,
    entries: [
      {
        id: 'led_01',
        date: '2026-09-10',
        type: 'COMMISSION_EARNED',
        description: 'Commission payout for application #9921',
        referenceId: 'ccal_01',
        credit: 60000,
        debit: 0,
        runningBalance: 80000,
      },
      {
        id: 'led_02',
        date: '2026-09-28',
        type: 'PAYOUT_DISBURSED',
        description: 'Bank transfer payout #44910',
        referenceId: 'INV-CONN-042',
        credit: 0,
        debit: 35000,
        runningBalance: 45000,
      },
    ],
  }),
}));

const mockInvoicesList = [
  {
    id: 'inv_01',
    tenantId: 'ten_01',
    direction: 'TO_LENDER',
    number: 'INV-2026-901',
    date: '2026-10-15',
    dueDate: '2026-11-15',
    amount: 150000,
    currency: 'INR',
    taxFields: { gstRate: 18, gstAmount: 27000, hsnSac: '9971' },
    status: 'DRAFT',
    calculationIds: ['ccal_01'],
    partyId: 'lnd_hdfc',
    partyName: 'HDFC Bank',
    notes: 'Monthly origination fee invoice',
    lockVersion: 0,
    createdAt: '2026-10-15T10:00:00Z',
    createdBy: 'usr_fin_exec_01',
    updatedAt: '2026-10-15T10:00:00Z',
    updatedBy: 'usr_fin_exec_01',
  },
];

function renderInvoicesPage(initialPath = '/invoices') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  queryClient.setQueryData(['invoices', 'ALL', 'ALL', ''], {
    data: mockInvoicesList,
    nextCursor: null,
  });

  return renderToString(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[initialPath]}>
          <InvoicesPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('Module 33 — InvoicesPage Frontend Component (MOD-INV)', () => {
  it('renders Invoices & Statements title and module subtitle', () => {
    const html = renderInvoicesPage();

    expect(html).toContain('Invoices &amp; Statements');
    expect(html).toContain('Module 33 (MOD-INV)');
    expect(html).toContain(
      'Manage lender billing, connector invoices, and periodic payout account statements.',
    );
  });

  it('renders both tabs: Invoice Register and Statement Generator', () => {
    const html = renderInvoicesPage();

    expect(html).toContain('CMP-INV.01.1 Invoice Register');
    expect(html).toContain('CMP-INV.02.1 Statement Generator');
  });

  it('renders action button for recording invoice when user has permission', () => {
    const html = renderInvoicesPage();

    expect(html).toContain('+ Record Invoice');
  });

  it('renders KPI summary cards for volume, lender billing, and connector payouts', () => {
    const html = renderInvoicesPage();

    expect(html).toContain('Total Volume');
    expect(html).toContain('Billed to Lenders');
    expect(html).toContain('From Connectors');
    expect(html).toContain('Paid Volume');
  });

  it('renders invoice table headers and filters', () => {
    const html = renderInvoicesPage();

    expect(html).toContain('Invoice #');
    expect(html).toContain('Direction');
    expect(html).toContain('Date');
    expect(html).toContain('Party Name');
    expect(html).toContain('Amount');
    expect(html).toContain('Taxes');
    expect(html).toContain('Status');
    expect(html).toContain('Actions');
  });
});
