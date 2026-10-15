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
  getAgents: vi.fn().mockResolvedValue([
    {
      id: 'usr_01JTESTAGENT',
      displayName: 'Vikram Mehta',
      email: 'vikram@dsa.com',
      availability: 'AVAILABLE',
      capacity: 10,
      activeLeadCount: 3,
      activeApplicationCount: 1,
      primaryBranchId: 'br_mumbai',
      status: 'ACTIVE',
    },
  ]),
  getDelegations: vi.fn().mockResolvedValue([]),
  getMyTodayAttendance: vi.fn().mockResolvedValue(null),
  getAttendance: vi.fn().mockResolvedValue([]),
  updateMyAvailability: vi.fn().mockResolvedValue({ user: {}, etag: '"1"' }),
  updateAgentCapacity: vi.fn().mockResolvedValue({ user: {}, etag: '"1"' }),
  createDelegation: vi.fn().mockResolvedValue({}),
  endDelegation: vi.fn().mockResolvedValue({}),
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
    expect(html).toContain(
      'Availability &amp; capacity routing, leave coverage planner, and daily attendance.',
    );
  });

  it('renders quick self-availability switcher chips (SUB-WRK.01)', () => {
    const html = renderWorkforcePage();

    expect(html).toContain('My Status:');
    expect(html).toContain('Available');
    expect(html).toContain('Busy');
    expect(html).toContain('Off Duty');
    expect(html).toContain('On Leave');
  });

  it('renders all 3 submodule tabs: Capacity, Leave Coverage, Attendance', () => {
    const html = renderWorkforcePage();

    expect(html).toContain('Capacity &amp; Availability (SUB-WRK.01)');
    expect(html).toContain('Leave Coverage Planner (SUB-WRK.02)');
    expect(html).toContain('Attendance &amp; Check-in (SUB-WRK.03)');
  });

  it('renders capacity & availability table headers on initial load', () => {
    const html = renderWorkforcePage();

    expect(html).toContain('Agent');
    expect(html).toContain('Branch');
    expect(html).toContain('Working Status');
    expect(html).toContain('Active Workload');
    expect(html).toContain('Capacity Meter');
    expect(html).toContain('Actions');
  });
});
