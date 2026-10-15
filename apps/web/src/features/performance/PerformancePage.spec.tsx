// apps/web/src/features/performance/PerformancePage.spec.tsx — Tests for CMP-PERF.02.1 & CMP-PERF.03.1
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { LeaderboardPage } from './LeaderboardPage';
import { PerformanceDashboardPage } from './PerformanceDashboardPage';

vi.mock('../../api/useMe', () => ({
  useMe: () => ({
    data: {
      id: 'usr_01JTESTUSER',
      grants: [{ code: 'report.read', scope: 'TENANT', branchIds: [] }],
    },
    isLoading: false,
  }),
  hasPermission: () => true,
}));

vi.mock('./api', () => ({
  useTeamPerformanceDashboard: () => ({
    data: {
      dashboardCode: 'TEAM_PERFORMANCE',
      title: 'Team Performance & Conversion Dashboard',
      period: '2026-10',
      asOf: '2026-10-14T10:00:00.000Z',
      summary: {
        leads: { actual: 120, target: 150, achievementPercentage: 80 },
        sanctions: { count: 45, amount: 90000000, targetCount: 50, achievementPercentage: 90 },
        disbursements: { count: 38, amount: 76000000, targetAmount: 80000000, achievementPercentage: 95 },
        conversionRate: 37.5,
        activityCount: 240,
      },
      funnel: [
        { stage: 'Leads Created', count: 120, rate: 100 },
        { stage: 'Qualified', count: 96, rate: 80 },
        { stage: 'Applied', count: 72, rate: 75 },
        { stage: 'Sanctioned', count: 45, rate: 62.5 },
        { stage: 'Disbursed', count: 38, rate: 84.4 },
      ],
      breakdown: [
        {
          dimensionType: 'BRANCH',
          dimensionId: 'brn_mum_01',
          dimensionName: 'Mumbai Central Branch',
          leadCount: 70,
          sanctionCount: 25,
          disbursementAmount: 42000000,
          disbursementTarget: 45000000,
          achievementPercentage: 93.3,
        },
      ],
    },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useLeaderboardDashboard: () => ({
    data: {
      dashboardCode: 'LEADERBOARD',
      title: 'Performance Leaderboard',
      period: '2026-10',
      asOf: '2026-10-14T10:00:00.000Z',
      rankingStatus: 'BLOCKED_PENDING_APPROVAL',
      unresolvedDecisions: [
        'Scoring formula weights for activity vs outcome vs quality metrics',
        'Minimum operational volume threshold before ranking eligibility',
        'Disqualification penalties for high early default rate (EDR > 2%)',
      ],
      entries: [
        {
          entityId: 'usr_agent_01',
          entityName: 'Rajesh Sharma',
          dimensionType: 'USER',
          branchName: 'Mumbai Central',
          volume: 40,
          sanctionCount: 15,
          disbursementAmount: 25000000,
          conversionRate: 37.5,
          rank: null,
          score: null,
          guardrailStatus: 'NORMAL',
        },
        {
          entityId: 'usr_agent_02',
          entityName: 'Pooja Verma',
          dimensionType: 'USER',
          branchName: 'Mumbai Central',
          volume: 4,
          sanctionCount: 1,
          disbursementAmount: 1200000,
          conversionRate: 25.0,
          rank: null,
          score: null,
          guardrailStatus: 'INSUFFICIENT_DATA',
        },
      ],
    },

    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

function renderWithClient(ui: React.ReactElement, initialPath = '/') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return renderToString(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CMP-PERF.02.1 — Team Performance Dashboard (SUB-PERF.02)', () => {
  it('renders header, description, and period/branch filter controls', () => {
    const html = renderWithClient(<PerformanceDashboardPage />);

    expect(html).toContain('Team Performance Dashboard');
    expect(html).toContain('CMP-PERF.02.1');
    expect(html).toContain('Period');
    expect(html).toContain('Filter Branch ID');
  });

  it('renders summary KPI cards with actuals, targets, and achievement percentages', () => {
    const html = renderWithClient(<PerformanceDashboardPage />);

    expect(html).toContain('LEAD INTAKE');
    expect(html).toContain('120');
    expect(html).toContain('80');

    expect(html).toContain('SANCTIONS ISSUED');
    expect(html).toContain('45');
    expect(html).toContain('90');

    expect(html).toContain('DISBURSEMENTS');
    expect(html).toContain('7.60 Cr');

    expect(html).toContain('LEAD CONVERSION RATE');
    expect(html).toContain('37.5');
  });

  it('renders activity-versus-outcome funnel stages', () => {
    const html = renderWithClient(<PerformanceDashboardPage />);

    expect(html).toContain('Activity-versus-Outcome Conversion Funnel');
    expect(html).toContain('STAGE');
    expect(html).toContain('Leads Created');
    expect(html).toContain('Qualified');
    expect(html).toContain('Sanctioned');
    expect(html).toContain('Disbursed');
  });

  it('renders branch performance breakdown with target comparison and drill-down', () => {
    const html = renderWithClient(<PerformanceDashboardPage />);

    expect(html).toContain('Dimensional Performance Breakdown');
    expect(html).toContain('Mumbai Central Branch');
    expect(html).toContain('93.3');
    expect(html).toContain('Drill Down');
  });
});

describe('CMP-PERF.03.1 — Performance Leaderboard (SUB-PERF.03)', () => {
  it('renders header and governance blocker alert', () => {
    const html = renderWithClient(<LeaderboardPage />);

    expect(html).toContain('Performance Leaderboards');
    expect(html).toContain('CMP-PERF.03.1');
    expect(html).toContain('Competitive Ranking Calculation Blocked Pending Business-Rule Sign-Off');
  });

  it('renders list of unresolved business decisions preventing ranking calculation', () => {
    const html = renderWithClient(<LeaderboardPage />);

    expect(html).toContain('Scoring formula weights for activity vs outcome vs quality metrics');
    expect(html).toContain('Minimum operational volume threshold before ranking eligibility');
    expect(html).toContain('Disqualification penalties for high early default rate (EDR &gt; 2%)');
  });

  it('renders unranked operational participant metrics table without fabricated scores', () => {
    const html = renderWithClient(<LeaderboardPage />);

    expect(html).toContain('Participant Operational Activity (Unranked)');
    expect(html).toContain('Rajesh Sharma');
    expect(html).toContain('Mumbai Central');
    expect(html).toContain('Ranking Status: Blocked');
    expect(html).toContain('Pending Formula');
    expect(html).toContain('NORMAL');
    expect(html).toContain('Pooja Verma');
    expect(html).toContain('INSUFFICIENT_DATA');
  });
});

