import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MessagingPage } from './MessagingPage';

vi.mock('../../api/useMe', () => ({
  useMe: () => ({
    data: {
      id: 'usr_test',
      tenantId: 'ten_default',
      displayName: 'Test User',
      grants: [{ code: 'message.send', scope: 'TENANT', branchIds: [] }],
    },
    isLoading: false,
    isError: false,
  }),
  hasPermission: () => true,
}));

describe('MessagingPage access notice', () => {
  it('shows no warning before any request is refused', () => {
    const queryClient = new QueryClient();
    const html = renderToString(
      <QueryClientProvider client={queryClient}>
        <MessagingPage />
      </QueryClientProvider>,
    );
    expect(html).not.toContain('messaging.noAccess');
  });
});
