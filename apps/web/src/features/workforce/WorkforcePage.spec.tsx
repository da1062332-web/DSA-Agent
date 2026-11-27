// apps/web/src/features/workforce/WorkforcePage.spec.tsx — Module 26: Workforce UI Tests
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { WorkforcePage } from './WorkforcePage';

vi.mock('../../api/useMe', () => ({
  useMe: () => ({
    data: {
      id: 'usr_01JTESTAGENT',
      displayName: 'Vikram Mehta',
      grants: [
        { code: 'user.manage', scope: 'TENANT', branchIds: [] },
        { code: 'attendance.manage', scope: 'TENANT', branchIds: [] },
      ],
    },
    isLoading: false,
  }),
  hasPermission: () => true,
}));

vi.mock('./api', () => ({
  getMyTodayAttendance: vi.fn().mockResolvedValue(null),
  getAttendance: vi.fn().mockResolvedValue([]),
  checkIn: vi.fn().mockResolvedValue({}),
  checkOut: vi.fn().mockResolvedValue({}),
}));

function renderWorkforcePage(initialPath = '/workforce') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return renderToString(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <WorkforcePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Module 26 — WorkforcePage Frontend Component (MOD-WRK)', () => {
  it('renders Workforce Management header and subtitle', () => {
    const html = renderWorkforcePage();

    expect(html).toContain('Workforce Management');
    expect(html).toContain('Daily attendance and check-in.');
  });

  it('TEST-P0-02 shows attendance only: no availability switcher, capacity table or leave coverage planner', () => {
    const html = renderWorkforcePage();

    expect(html).not.toContain('My Status:');
    expect(html).not.toContain('Capacity Meter');
    expect(html).not.toContain('Leave Coverage Planner');
  });
});
