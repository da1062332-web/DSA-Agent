// The Overview tab and the Portal Users tab read one cache entry. It must hold the list whichever tab loads first.
import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as clientModule from '../../api/client';
import { apiFetch } from '../../api/client';
import { connectorPortalUsersQuery } from './ConnectorPortalUsers';

vi.mock('../../api/client', async () => ({
  ...(await vi.importActual<typeof clientModule>('../../api/client')),
  apiFetch: vi.fn(),
}));

describe('connector portal users cache entry', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  it('stores the list under the connector key, not the response object', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ items: [{ id: 'usr_1', status: 'ACTIVE' }] });
    const client = new QueryClient();

    await client.fetchQuery(connectorPortalUsersQuery('con_1'));

    expect(apiFetch).toHaveBeenCalledWith('/v1/connectors/con_1/users');
    expect(client.getQueryData(['connector-portal-users', 'con_1'])).toEqual([
      { id: 'usr_1', status: 'ACTIVE' },
    ]);
  });

  it('uses the same key for every reader of a connector', () => {
    expect(connectorPortalUsersQuery('con_1').queryKey).toEqual(['connector-portal-users', 'con_1']);
  });
});
