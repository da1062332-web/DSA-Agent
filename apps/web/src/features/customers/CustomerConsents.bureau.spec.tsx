// apps/web/src/features/customers/CustomerConsents.bureau.spec.tsx — P1-05 (guest work in the customers lane, review: Bhushan): what the consents
// page shows for a BUREAU_PULL consent. The web workspace tests screens with react-dom/server (no browser): each case seeds the query data the
// page reads and renders it at an address. `inline` makes the Record dialog render in place (a portal is not rendered on the server). The
// rules behind the form (what is sent, what is dropped) are tested in consent-form.spec.ts.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as useMeModule from '../../api/useMe';
import { CustomerConsents } from './CustomerConsents';
import type { ConsentResource, CustomerResource } from './types';

vi.mock('../../api/useMe', async () => {
  const actual = await vi.importActual<typeof useMeModule>('../../api/useMe');
  return { ...actual, useMe: vi.fn() };
});

const ID = 'cust_ui_consent_1';
const DIALOG_TITLE = 'Record Customer Consent (DPDP Act)';

function mockGrants(grants: string[]) {
  vi.mocked(useMeModule.useMe).mockReturnValue({
    data: {
      id: 'usr_test',
      tenantId: 'ten_test',
      email: 'test@example.com',
      displayName: 'Test User',
      primaryBranchId: null,
      queueIds: [],
      grants: grants.map((code) => ({ code, scope: 'TENANT', branchIds: [] })),
      mfaVerifiedAt: null,
    },
    isLoading: false,
    isError: false,
  } as never);
}

const customer: CustomerResource = {
  id: ID,
  tenantId: 'ten_1',
  partyType: 'INDIVIDUAL',
  fullName: 'Synthetic Test Customer',
  homeBranchId: 'br_1',
  status: 'ACTIVE',
  lockVersion: 0,
  createdAt: '2026-11-01T09:00:00.000Z',
  updatedAt: '2026-11-01T09:00:00.000Z',
};

const consent = (over: Partial<ConsentResource> = {}): ConsentResource => ({
  id: 'cnst_1',
  tenantId: 'ten_1',
  subjectType: 'CUSTOMER',
  subjectId: ID,
  purpose: 'BUREAU_PULL',
  purposeTarget: 'CIBIL',
  noticeVersion: 'NV-2026.1',
  channel: 'IN_PERSON',
  evidenceRef: null,
  capturedBy: 'usr_1',
  capturedAt: '2026-11-20T09:00:00.000Z',
  status: 'ACTIVE',
  withdrawnAt: null,
  withdrawnBy: null,
  withdrawalReason: null,
  expiresAt: null,
  createdAt: '2026-11-20T09:00:00.000Z',
  ...over,
});

function render(query: string, consents: ConsentResource[] = []): string {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, retryOnMount: false } },
  });
  client.setQueryData(['customer', ID], { customer, etag: '"0"' });
  client.setQueryData(['customer-consents', ID], consents);
  return renderToString(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/customers/${ID}/consents${query}`]}>
        <Routes>
          <Route path="/customers/:id/consents" element={<CustomerConsents inline />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const bureauSelect = (html: string) =>
  html.includes('data-testid="consent.purposeTarget"') && html.includes('Credit bureau');

describe('P1-05 consents page: the Record dialog and BUREAU_PULL', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGrants(['consent.record', 'customer.read']);
  });

  it('P1-05 without a link the dialog is closed and the page is as before', () => {
    const html = render('');

    expect(html).toContain('Customer Consent Management');
    expect(html).toContain('+ Record New Consent');
    expect(html).not.toContain(DIALOG_TITLE);
    expect(bureauSelect(html)).toBe(false);
  });

  it('P1-05 ?record=BUREAU_PULL&bureau=CRIF opens the dialog with BUREAU_PULL as the purpose, the bureau select shown and CRIF chosen', () => {
    const html = render('?record=BUREAU_PULL&bureau=CRIF');

    expect(html).toContain(DIALOG_TITLE);
    // The Purpose select shows BUREAU_PULL: a value with no option would show nothing, so this also proves the option exists.
    expect(html).toMatch(/MuiSelect-select[^>]*>BUREAU_PULL</);
    expect(bureauSelect(html)).toBe(true);
    expect(html).toMatch(/MuiSelect-select[^>]*>CRIF</);
    expect(html).toContain('The bureau this consent allows a credit report to be pulled from');
  });

  it('P1-05 the chosen bureau is shown by its name: EXPERIAN as Experian', () => {
    expect(render('?record=BUREAU_PULL&bureau=EXPERIAN')).toMatch(/MuiSelect-select[^>]*>Experian</);
    expect(render('?record=BUREAU_PULL&bureau=EQUIFAX')).toMatch(/MuiSelect-select[^>]*>Equifax</);
  });

  it('P1-05 BUREAU_PULL shows no lender field and no agency field', () => {
    const html = render('?record=BUREAU_PULL&bureau=CIBIL');

    expect(html).not.toContain('Target Lender');
    expect(html).not.toContain('Verification Agency / Target');
    expect(html).not.toContain('LENDER_HDFC_01');
  });

  it('P1-05 a link without a bureau, or with a value that is not a bureau, opens the dialog with no bureau chosen', () => {
    for (const q of [
      '?record=BUREAU_PULL',
      '?record=BUREAU_PULL&bureau=TRANSUNION',
      '?record=BUREAU_PULL&bureau=cibil',
    ]) {
      const html = render(q);

      expect(html).toContain(DIALOG_TITLE);
      expect(bureauSelect(html)).toBe(true);
      expect(html).not.toMatch(/MuiSelect-select[^>]*>(CIBIL|CRIF|Experian|Equifax)</);
      expect(html).not.toContain('TRANSUNION');
    }
  });

  it('P1-05 a link with a value that is not a purpose shows no dialog, and nothing from the address is printed on the page', () => {
    for (const q of [
      '?record=NOPE&bureau=CRIF',
      '?record=&bureau=CRIF',
      '?bureau=CRIF',
      '?record=%3Cscript%3Ealert(1)%3C%2Fscript%3E',
    ]) {
      const html = render(q);

      expect(html).not.toContain(DIALOG_TITLE);
      expect(html).not.toContain('NOPE');
      expect(html).not.toContain('<script>alert');
    }
  });

  it('P1-05 a link for a lender consent still shows the lender field and not the bureau field; for an agency, the agency field', () => {
    const lender = render('?record=SHARE_WITH_LENDER');
    const agency = render('?record=VERIFICATION_CHECK');
    const contact = render('?record=CONTACT');

    expect(lender).toContain('Target Lender');
    expect(bureauSelect(lender)).toBe(false);
    expect(agency).toContain('Verification Agency / Target');
    expect(bureauSelect(agency)).toBe(false);
    for (const html of [contact, render('?record=MARKETING'), render('?record=LOAN_PROCESSING')]) {
      expect(html).toContain(DIALOG_TITLE);
      expect(html).not.toContain('Target Lender');
      expect(html).not.toContain('Verification Agency / Target');
      expect(bureauSelect(html)).toBe(false);
    }
  });

  it('P1-05 the registry lists a BUREAU_PULL consent with its purpose and the bureau as its target', () => {
    const html = render('', [
      consent({ purposeTarget: 'CRIF' }),
      consent({ id: 'cnst_2', purposeTarget: 'EQUIFAX', status: 'WITHDRAWN' }),
    ]);

    expect(html).toContain('BUREAU_PULL');
    expect(html).toContain('CRIF');
    expect(html).toContain('EQUIFAX');
    expect(html).toContain('Revoked');
    expect(html).toContain('1 Active Consents');
  });

  it('P1-05 the Record button is still hidden without the consent.record permission, but the page shows the registry', () => {
    mockGrants(['customer.read']);
    const html = render('', [consent()]);

    expect(html).not.toContain('+ Record New Consent');
    expect(html).toContain('BUREAU_PULL');
  });
});
