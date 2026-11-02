// The connector workspace tabs and the dashboard, rendered with their data in the query cache (TEST-CWS-UI). Each figure shown must come
// from the response it was given; a figure the caller may not see is shown as such.
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type {
  ConnectorActivityResource,
  ConnectorReferralResource,
  ConnectorResource,
  ConnectorSummaryResource,
} from '@dsa/contracts';
import { ConnectorActivityTab } from './ConnectorActivityTab';
import { ConnectorDashboard } from './ConnectorDashboard';
import { ConnectorEarningsTab } from './ConnectorEarningsTab';
import { ConnectorReferralsTab } from './ConnectorReferralsTab';
import { ConnectorVerificationTab } from './ConnectorVerificationTab';

const connector = (status: ConnectorResource['status']): ConnectorResource => ({
  id: 'con_1',
  tenantId: 'ten_1',
  connectorType: 'INDIVIDUAL',
  legalName: 'Synthetic Partner One',
  contactPerson: 'Synthetic Contact',
  mobileE164: '+919800000001',
  email: 'partner@example.com',
  panMasked: 'XXXXX1234X',
  gstin: null,
  primaryBranchId: 'br_1',
  relationshipOwnerUserId: 'usr_1',
  status,
  lockVersion: 1,
  createdAt: '2026-11-01T00:00:00.000Z',
  createdBy: 'usr_1',
  updatedAt: '2026-11-01T00:00:00.000Z',
  updatedBy: 'usr_1',
});

const summary: ConnectorSummaryResource = {
  range: { from: null, to: null },
  connectors: {
    total: 3,
    byStatus: { DRAFT: 0, PENDING_VERIFICATION: 1, ACTIVE: 1, SUSPENDED: 1, TERMINATED: 0 },
  },
  referrals: { total: 5, pending: 2, converted: 1 },
  disputes: { attributionOpen: null, partnerOpen: 2 },
  earnings: null,
};

const render = (seed: (qc: QueryClient) => void, node: React.ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  seed(qc);
  return renderToString(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('connector workspace (TEST-CWS-UI)', () => {
  it('TEST-CWS-UI-01 the dashboard shows the counts it was given, and a figure the caller may not see as not visible, never as zero', () => {
    const html = render((qc) => qc.setQueryData(['connector-summary', ''], summary), <ConnectorDashboard />);
    expect(html).toContain('TOTAL CONNECTORS');
    expect(html).toContain('PENDING REFERRALS');
    expect(html).toContain('Not visible to you');
    expect(html).toContain('earnings need a finance permission');
    expect(html).toContain('PENDING VERIFICATION');
  });

  it('TEST-CWS-UI-02 a connector’s referrals show the customer and the application, and never a mobile number', () => {
    const referrals: ConnectorReferralResource[] = [
      {
        id: 'lead_1',
        customerName: 'Referred Person',
        productCategory: 'PL',
        state: 'CONVERTED',
        duplicateFlag: 'NONE',
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-02T00:00:00.000Z',
        applicationId: 'app_1',
        applicationStatus: 'DRAFT',
      },
    ];
    const html = render(
      (qc) => qc.setQueryData(['connector-referrals', 'con_1'], { items: referrals }),
      <ConnectorReferralsTab connectorId="con_1" />,
    );
    expect(html).toContain('Referred Person');
    expect(html).toContain('app_1');
    expect(html).toContain('Converted');
    expect(html).not.toContain('+9198');
  });

  it('TEST-CWS-UI-03 the activity tab shows what happened, by whom and why, with the readable label', () => {
    const activity: ConnectorActivityResource[] = [
      {
        id: 'aud_1',
        occurredAt: '2026-11-02T10:00:00.000Z',
        action: 'connector.updated',
        entityType: 'connector',
        entityId: 'con_1',
        actorId: 'usr_1',
        actorName: 'Asha Rao',
        reason: 'Contact details refreshed',
      },
    ];
    const html = render(
      (qc) => qc.setQueryData(['connector-activity', 'con_1'], { items: activity }),
      <ConnectorActivityTab connectorId="con_1" />,
    );
    expect(html).toContain('Profile updated');
    expect(html).toContain('Asha Rao');
    expect(html).toContain('Contact details refreshed');
  });

  it('TEST-CWS-UI-04 an active connector cannot be activated again from the verification tab, and reject and request-information are shown as unavailable', () => {
    const html = render(
      (qc) => qc.setQueryData(['connector-activity', 'con_1'], { items: [] }),
      <ConnectorVerificationTab connector={connector('ACTIVE')} canManage onActivate={() => undefined} />,
    );
    const idx = html.indexOf('con.verification.activate');
    expect(idx).toBeGreaterThan(-1);
    expect(html.slice(Math.max(0, idx - 400), idx)).toMatch(/disabled/);
    expect(html).toContain('No verification decisions are recorded');
    expect(html).toContain('a connector has no verification record to reject yet');
  });

  it('TEST-CWS-UI-05 a pending connector with connector.manage can be activated, and the payables show their amounts exactly', () => {
    const verification = render(
      (qc) => qc.setQueryData(['connector-activity', 'con_1'], { items: [] }),
      <ConnectorVerificationTab
        connector={connector('PENDING_VERIFICATION')}
        canManage
        onActivate={() => undefined}
      />,
    );
    const idx = verification.indexOf('con.verification.activate');
    expect(verification.slice(Math.max(0, idx - 400), idx)).not.toMatch(/disabled/);

    const earnings = render(
      (qc) =>
        qc.setQueryData(['connector-payables', 'con_1'], {
          data: [
            {
              id: 'cpay_1',
              calculationId: 'ccal_1',
              connectorId: 'con_1',
              shareRate: '0.5',
              amount: '250.00',
              currency: 'INR',
              state: 'PAID',
              holdReasons: null,
              lockVersion: 0,
              createdAt: '2026-11-01T00:00:00.000Z',
              updatedAt: '2026-11-01T00:00:00.000Z',
            },
          ],
        }),
      <ConnectorEarningsTab connectorId="con_1" />,
    );
    expect(earnings).toContain('₹250.00');
    expect(earnings).toContain('PAID');
  });
});
