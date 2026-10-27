import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UserName } from './display';

describe('display.tsx — UserName component', () => {
  it('resolves user displayName from cached /v1/users data projection', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['/v1/users', undefined], [
      {
        id: 'usr_01M595WD3R4PN3K3KKQDKK7SMZ',
        displayName: 'Asha Admin (Qloax)',
        status: 'ACTIVE',
        availability: 'AVAILABLE',
        primaryBranchId: 'br_01',
      },
      {
        id: 'usr_01M595WDA7JVSXQKQRDKP8KHKQ',
        displayName: 'Omkar Owner (Qloax)',
        status: 'ACTIVE',
        availability: 'AVAILABLE',
        primaryBranchId: 'br_01',
      },
    ]);

    const html = renderToString(
      <QueryClientProvider client={queryClient}>
        <div>
          <span>Requested by: </span>
          <UserName id="usr_01M595WD3R4PN3K3KKQDKK7SMZ" />
        </div>
      </QueryClientProvider>,
    );

    expect(html).toContain('Asha Admin (Qloax)');
    expect(html).not.toContain('Requested by: usr_01M595WD3R4PN3K3KKQDKK7SMZ');
  });

  it('renders fallback when id is not provided', () => {
    const queryClient = new QueryClient();
    const html = renderToString(
      <QueryClientProvider client={queryClient}>
        <UserName id={null} fallback="Unassigned" />
      </QueryClientProvider>,
    );
    expect(html).toContain('Unassigned');
  });

  it('never shows the raw id if user is not in users list', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['/v1/users', undefined], []);
    const html = renderToString(
      <QueryClientProvider client={queryClient}>
        <UserName id="usr_unknown_999" />
      </QueryClientProvider>,
    );
    expect(html).not.toContain('usr_unknown_999');
  });
});
