import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import {
  DashboardDateFilter,
  formatIndianCurrency,
  formatMetricValue,
  KpiMetricCard,
  PipelineFunnelChart,
  TaskWorkQueue,
  type TaskWorkQueueItem,
} from './index';

describe('Phase 2A: Shared Dashboard Components', () => {
  describe('KpiMetricCard', () => {
    it('formats Indian currency numbers correctly', () => {
      expect(formatIndianCurrency(15000000)).toBe('₹1.50 Cr');
      expect(formatIndianCurrency(2500000)).toBe('₹25.00 L');
      expect(formatIndianCurrency(45000)).toContain('45,000');
    });

    it('formats percentages and numbers correctly', () => {
      expect(formatMetricValue(84.56, 'percent')).toBe('84.6%');
      expect(formatMetricValue(1250, 'number')).toContain('1,250');
      expect(formatMetricValue('Custom Value', 'raw')).toBe('Custom Value');
    });

    it('renders title, formatted value, and trend', () => {
      const html = renderToString(
        <MemoryRouter>
          <KpiMetricCard
            title="Total Disbursals"
            value={15000000}
            format="currency"
            subtitle="vs previous month"
            trend={{ value: 12.5, isPositive: true }}
            dataTestId="kpi-total-disbursals"
          />
        </MemoryRouter>,
      );

      expect(html).toContain('Total Disbursals');
      expect(html).toContain('₹1.50 Cr');
      expect(html).toContain('+12.5%');
      expect(html).toContain('vs previous month');
    });

    it('renders skeleton loader when isLoading is true', () => {
      const html = renderToString(
        <MemoryRouter>
          <KpiMetricCard title="Loading Metric" isLoading={true} />
        </MemoryRouter>,
      );

      expect(html).toContain('MuiSkeleton-root');
    });

    it('renders unavailable chip without fabricating data when value is null', () => {
      const html = renderToString(
        <MemoryRouter>
          <KpiMetricCard
            title="SLA Compliance"
            value={null}
            unavailableMessage="Pending Calculation"
          />
        </MemoryRouter>,
      );

      expect(html).toContain('Pending Calculation');
    });

    it('renders error state when isError is true', () => {
      const html = renderToString(
        <MemoryRouter>
          <KpiMetricCard title="Error Metric" isError={true} />
        </MemoryRouter>,
      );

      expect(html).toContain('Failed to load metric');
    });
  });

  describe('PipelineFunnelChart', () => {
    const mockStages = [
      { key: 'new', label: 'New Leads', count: 100, amount: 10000000 },
      { key: 'contacted', label: 'Contacted', count: 75, amount: 7500000 },
      { key: 'qualified', label: 'Qualified', count: 50, amount: 5000000 },
      { key: 'converted', label: 'Converted', count: 25, amount: 2500000 },
    ];

    it('renders title and stages with relative conversion percentages', () => {
      const html = renderToString(
        <MemoryRouter>
          <PipelineFunnelChart
            title="Lead Conversion Funnel"
            stages={mockStages}
            dataTestId="test-funnel"
          />
        </MemoryRouter>,
      );

      expect(html).toContain('Lead Conversion Funnel');
      expect(html).toContain('New Leads');
      expect(html).toContain('Contacted');
      expect(html).toContain('75%');
      expect(html).toContain('50%');
      expect(html).toContain('25%');
    });

    it('renders empty message when all counts are 0', () => {
      const emptyStages = [
        { key: 'new', label: 'New', count: 0 },
        { key: 'contacted', label: 'Contacted', count: 0 },
      ];

      const html = renderToString(
        <MemoryRouter>
          <PipelineFunnelChart
            stages={emptyStages}
            emptyMessage="Zero pipeline entries"
          />
        </MemoryRouter>,
      );

      expect(html).toContain('Zero pipeline entries');
    });

    it('TEST-DASH-COLUMNS-001 draws the columns variant with a whole-number count axis, a count above each stage and conversion under it', () => {
      const html = renderToString(
        <MemoryRouter>
          <PipelineFunnelChart
            variant="columns"
            stages={[
              { key: 'leads', label: 'Inbound Leads', count: 3 },
              { key: 'files', label: 'New Files', count: 0 },
              { key: 'disbursed', label: 'Disbursed', count: 1 },
            ]}
          />
        </MemoryRouter>,
      );

      // React's server render splits "33% of inbound leads" into pieces with comment markers; match the joined text.
      const text = html.replace(/<!-- -->/g, '');
      expect(text).toContain('data-testid="pipeline-funnel"');
      // Peak 3 -> axis 0..4 in steps of 1; no fractional ticks on a count axis.
      for (const tick of ['>0<', '>1<', '>2<', '>3<', '>4<']) expect(text).toContain(tick);
      expect(text).not.toContain('>0.5<');
      expect(text).toContain('Inbound Leads');
      expect(text).toContain('33% of inbound leads');
      expect(text).toContain('Overall conversion:');
    });
  });

  describe('TaskWorkQueue', () => {
    const mockTasks: TaskWorkQueueItem[] = [
      {
        id: 'tsk-001',
        title: 'Call borrower for income documents',
        category: 'Follow-up',
        priority: 'URGENT',
        isOverdue: true,
        entityLink: { label: 'APP-1024', to: '/applications/app-1024' },
        actionLabel: 'Call',
      },
      {
        id: 'tsk-002',
        title: 'Review bureau report',
        category: 'Verification',
        priority: 'HIGH',
        slaMinutesRemaining: 45,
        entityLink: { label: 'APP-1025', to: '/applications/app-1025' },
        actionLabel: 'Review',
      },
    ];

    it('renders work queue items with priority chips and SLA badges', () => {
      const html = renderToString(
        <MemoryRouter>
          <TaskWorkQueue
            title="Daily Action Items"
            items={mockTasks}
            viewAllTo="/tasks"
            dataTestId="test-work-queue"
          />
        </MemoryRouter>,
      );

      expect(html).toContain('Daily Action Items');
      expect(html).toContain('Call borrower for income documents');
      expect(html).toContain('URGENT');
      expect(html).toContain('Overdue');
      expect(html).toContain('APP-1024');
      expect(html).toContain('Call');
      expect(html).toContain('&lt; 1h left');
    });

    it('renders empty message when no items are present', () => {
      const html = renderToString(
        <MemoryRouter>
          <TaskWorkQueue
            title="Daily Action Items"
            items={[]}
            emptyMessage="All caught up!"
          />
        </MemoryRouter>,
      );

      expect(html).toContain('All caught up!');
    });
  });

  describe('DashboardDateFilter', () => {
    it('renders all scope toggles with current active selection', () => {
      const html = renderToString(
        <DashboardDateFilter value="month" onChange={vi.fn()} />
      );

      expect(html).toContain('Today');
      expect(html).toContain('This Week');
      expect(html).toContain('This Month');
      expect(html).toContain('Quarter');
      expect(html).toContain('All');
    });
  });
});
