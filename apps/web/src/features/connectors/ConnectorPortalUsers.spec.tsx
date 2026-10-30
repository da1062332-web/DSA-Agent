import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectorPortalUser, ConnectorResource } from '@dsa/contracts';
import * as useMeModule from '../../api/useMe';
import { ConnectorPortalUsers, invitationErrors, invitationLabel } from './ConnectorPortalUsers';

vi.mock('../../api/useMe', async () => {
  const actual = await vi.importActual<typeof useMeModule>('../../api/useMe');
  return { ...actual, useMe: vi.fn() };
});

const connector = (status = 'ACTIVE'): ConnectorResource =>
  ({
    id: 'con_1',
    legalName: 'Acme Partners',
    status,
    primaryBranchId: 'br_1',
    lockVersion: 1,
  }) as unknown as ConnectorResource;

const user = (
  id: string,
  status: string,
  invitation: Partial<ConnectorPortalUser['invitation']> = {},
): ConnectorPortalUser => ({
  id,
  connectorId: 'con_1',
  displayName: `Person ${id}`,
  email: `${id}@example.test`,
  status,
  invitation: {
    state: 'PENDING',
    deliveryState: 'QUEUED',
    lastFailure: null,
    sentAt: null,
    expiresAt: null,
    resendCount: 0,
    acceptedAt: null,
    ...invitation,
  },
  createdAt: '2026-10-29T10:00:00Z',
});

function render(
  c: ConnectorResource,
  users?: ConnectorPortalUser[],
  failedInvite?: Parameters<typeof ConnectorPortalUsers>[0]['failedInvite'],
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (users) client.setQueryData(['connector-portal-users', c.id], users);
  // Server rendering separates interpolated text with <!-- --> markers; they are removed so sentences read as the user sees them.
  return renderToString(
    <QueryClientProvider client={client}>
      <ConnectorPortalUsers connector={c} failedInvite={failedInvite} />
    </QueryClientProvider>,
  ).replace(/<!-- -->/g, '');
}

describe('Connector Portal Access & Users tab (TEST-CPU-UI)', () => {
  const mockUseMe = vi.mocked(useMeModule.useMe);
  const grants = (codes: string[]) =>
    mockUseMe.mockReturnValue({
      data: { id: 'usr_me', grants: codes.map((code) => ({ code, scope: 'TENANT', branchIds: [] })) },
      isLoading: false,
      isError: false,
    } as never);

  beforeEach(() => vi.clearAllMocks());

  it('TEST-CPU-UI-01 lists portal users with their real account and invitation state, and only the actions each state allows', () => {
    grants(['connector.manage', 'connector.read']);
    const html = render(connector(), [
      user('u1', 'INVITED'),
      user('u2', 'ACTIVE', { state: 'ACCEPTED', deliveryState: 'SENT', sentAt: '2026-10-29T10:05:00Z' }),
      user('u3', 'SUSPENDED', { state: 'ACCEPTED', deliveryState: 'SENT' }),
      user('u4', 'DEACTIVATED', { state: 'NONE', deliveryState: 'CANCELLED' }),
    ]);
    expect(html).toContain('Person u1');
    expect(html).toContain('Queued, not yet sent');
    expect(html).toContain('Accepted');
    expect(html).toContain('Withdrawn');
    expect(html).toContain('Resend invitation');
    expect(html).toContain('Suspend');
    expect(html).toContain('Reactivate');
    expect(html).toContain('Acme Partners');
    expect(html).not.toContain('Password');
  });

  it('TEST-CPU-UI-02 an empty list says a connector can work without portal access', () => {
    grants(['connector.manage']);
    expect(render(connector(), [])).toContain('No portal users yet');
  });

  it('TEST-CPU-UI-03 a reader without connector.manage sees no table and no invite action', () => {
    grants(['connector.read']);
    const html = render(connector(), [user('u1', 'INVITED')]);
    expect(html).toContain('Portal users are managed by connector managers.');
    expect(html).not.toContain('Person u1');
    expect(html).not.toContain('Invite Portal User</button>');
  });

  it('TEST-CPU-UI-04 a failed invitation after creating the connector is offered for retry, without creating the connector again', () => {
    grants(['connector.manage']);
    const html = render(connector('DRAFT'), [], {
      input: { displayName: 'New Person', email: 'new@example.test' },
      idempotencyKey: 'cpu_retry',
      message: 'The sign-in service did not accept the request.',
    });
    expect(html).toContain(
      'The connector was saved, but the invitation for new@example.test was not created',
    );
    expect(html).toContain('Retry invitation');
    expect(html).toContain('the portal opens for them only once the connector is active');
  });

  it('TEST-CPU-UI-05 a terminated connector cannot invite portal users', () => {
    grants(['connector.manage']);
    expect(render(connector('TERMINATED'), [])).toContain(
      'Portal users cannot be invited while the connector is terminated.',
    );
  });

  it('TEST-CPU-UI-06 the invite form validates the name, e-mail and optional mobile', () => {
    expect(invitationErrors({ displayName: 'A', email: 'bad', mobileE164: '12345' })).toEqual({
      displayName: expect.any(String),
      email: expect.any(String),
      mobileE164: expect.any(String),
    });
    expect(invitationErrors({ displayName: 'Asha Rao', email: 'asha@example.test', mobileE164: '' })).toEqual(
      {},
    );
    expect(invitationLabel(user('x', 'INVITED', { deliveryState: 'FAILED' }))).toBe('Delivery failed');
  });
});
