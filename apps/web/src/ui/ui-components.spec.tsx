import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import {
  AppButton,
  AppCard,
  SearchInput,
  PageHeader,
  StatusBadge,
  DataTable,
  FilterToolbar,
  AsyncContainer,
  EmptyState,
  ErrorState,
  StatCard,
  StatCardGrid,
  DetailCard,
  DetailField,
  ConfirmDialog,
  resolveStatusCategory,
} from './index';

describe('Enterprise UI Component Suite (apps/web/src/ui/)', () => {
  describe('PageHeader', () => {
    it('renders title, subtitle, and action buttons', () => {
      const html = renderToString(
        <MemoryRouter>
          <PageHeader
            title="Lead Management"
            subtitle="Manage and convert customer leads"
            actions={<button>Create Lead</button>}
          />
        </MemoryRouter>,
      );

      expect(html).toContain('Lead Management');
      expect(html).toContain('Manage and convert customer leads');
      expect(html).toContain('Create Lead');
    });

    it('renders breadcrumbs and back button when specified', () => {
      const html = renderToString(
        <MemoryRouter>
          <PageHeader
            title="Lead #101"
            breadcrumbs={[{ label: 'Leads', to: '/leads' }, { label: 'Details' }]}
            backTo="/leads"
          />
        </MemoryRouter>,
      );

      expect(html).toContain('Leads');
      expect(html).toContain('Details');
      expect(html).toContain('Back');
      expect(html).toContain('Lead #101');
    });
  });

  describe('StatusBadge', () => {
    it('resolves canonical categories correctly from string statuses', () => {
      expect(resolveStatusCategory('QUALIFIED')).toBe('success');
      expect(resolveStatusCategory('IN_PROGRESS')).toBe('warning');
      expect(resolveStatusCategory('REJECTED')).toBe('error');
      expect(resolveStatusCategory('NEW')).toBe('info');
      expect(resolveStatusCategory('ARCHIVED')).toBe('neutral');
    });

    it('renders formatted status with dot indicator', () => {
      const html = renderToString(<StatusBadge status="QUALIFIED" />);
      expect(html).toContain('QUALIFIED');
    });

    it('renders custom label and supports explicit category', () => {
      const html = renderToString(<StatusBadge label="High Priority" status="error" />);
      expect(html).toContain('High Priority');
    });
  });

  describe('AsyncContainer & States', () => {
    it('renders children when not loading, not error, and not empty', () => {
      const html = renderToString(
        <AsyncContainer isLoading={false} isError={false} isEmpty={false}>
          <div data-testid="content">Loaded Content</div>
        </AsyncContainer>,
      );
      expect(html).toContain('Loaded Content');
    });

    it('renders loading progress indicator when isLoading is true', () => {
      const html = renderToString(
        <AsyncContainer isLoading={true} dataTestId="test-async">
          <div>Hidden</div>
        </AsyncContainer>,
      );
      expect(html).toContain('data-testid="test-async.loading"');
      expect(html).not.toContain('Hidden');
    });

    it('renders ErrorState with retry trigger when isError is true', () => {
      const html = renderToString(
        <AsyncContainer isError={true} error="Failed network query" onRetry={() => {}}>
          <div>Hidden</div>
        </AsyncContainer>,
      );
      expect(html).toContain('Failed network query');
      expect(html).toContain('Retry');
    });

    it('renders EmptyState when isEmpty is true', () => {
      const html = renderToString(
        <AsyncContainer
          isEmpty={true}
          emptyTitle="No leads registered"
          emptyDescription="Start by adding your first lead"
          emptyAction={<button>Add Lead</button>}
        >
          <div>Hidden</div>
        </AsyncContainer>,
      );
      expect(html).toContain('No leads registered');
      expect(html).toContain('Start by adding your first lead');
      expect(html).toContain('Add Lead');
    });
  });

  describe('DataTable', () => {
    interface TestItem {
      id: string;
      name: string;
      amount: number;
    }

    const testColumns = [
      { id: 'name', header: 'Name', accessor: (row: TestItem) => row.name },
      { id: 'amount', header: 'Amount', accessor: (row: TestItem) => `₹${row.amount}` },
    ];

    const testData: TestItem[] = [
      { id: '1', name: 'Alpha Corp', amount: 50000 },
      { id: '2', name: 'Beta Ltd', amount: 75000 },
    ];

    it('renders table headers and row items', () => {
      const html = renderToString(
        <DataTable
          columns={testColumns}
          data={testData}
          keyExtractor={(item) => item.id}
          dataTestId="test-table"
        />,
      );

      expect(html).toContain('test-table');
      expect(html).toContain('Name');
      expect(html).toContain('Amount');
      expect(html).toContain('Alpha Corp');
      expect(html).toContain('₹50000');
      expect(html).toContain('Beta Ltd');
      expect(html).toContain('₹75000');
    });

    it('renders empty message when data is empty', () => {
      const html = renderToString(
        <DataTable
          columns={testColumns}
          data={[]}
          keyExtractor={(item) => item.id}
          emptyTitle="Zero records"
        />,
      );
      expect(html).toContain('Zero records');
    });

    it('supports pagination controls', () => {
      const html = renderToString(
        <DataTable
          columns={testColumns}
          data={testData}
          keyExtractor={(item) => item.id}
          pagination={{
            page: 1,
            totalPages: 3,
            hasNextPage: true,
            hasPrevPage: false,
            onNext: () => {},
            onPrev: () => {},
            nextTestId: 'test.next',
            prevTestId: 'test.prev',
          }}
        />,
      );

      expect(html).toContain('Page 1 of 3');
      expect(html).toContain('test.next');
      expect(html).toContain('test.prev');
    });
  });

  describe('FilterToolbar', () => {
    it('handles search input, filter controls, apply and reset clicks', () => {
      const html = renderToString(
        <FilterToolbar
          searchValue="test"
          onSearchChange={() => {}}
          searchPlaceholder="Search leads..."
          onApply={() => {}}
          onReset={() => {}}
          applyTestId="btn.apply"
          resetTestId="btn.reset"
        >
          <div>Custom Dropdown</div>
        </FilterToolbar>,
      );

      expect(html).toContain('Search leads...');
      expect(html).toContain('Custom Dropdown');
      expect(html).toContain('Apply');
      expect(html).toContain('Reset');
    });
  });

  describe('StatCard & StatCardGrid', () => {
    it('formats currency and displays trend correctly', () => {
      const html = renderToString(
        <StatCard
          title="Disbursed Volume"
          value={2500000}
          format="currency"
          trend={{ value: 14.5, label: 'vs last month' }}
          status="success"
        />,
      );

      expect(html).toContain('Disbursed Volume');
      expect(html).toContain('25,00,000');
      expect(html).toContain('+14.5% vs last month');
    });

    it('renders StatCardGrid with responsive children', () => {
      const html = renderToString(
        <StatCardGrid>
          <StatCard title="Card 1" value={10} />
          <StatCard title="Card 2" value={20} />
        </StatCardGrid>,
      );

      expect(html).toContain('Card 1');
      expect(html).toContain('Card 2');
    });
  });

  describe('DetailCard & DetailField', () => {
    it('renders title, actions, and key-value fields with fallback', () => {
      const html = renderToString(
        <DetailCard title="Customer Information" actions={<button>Edit</button>}>
          <DetailField label="Full Name" value="Aarav Sharma" />
          <DetailField label="Alternate Phone" value={null} />
        </DetailCard>,
      );

      expect(html).toContain('Customer Information');
      expect(html).toContain('Edit');
      expect(html).toContain('Full Name');
      expect(html).toContain('Aarav Sharma');
      expect(html).toContain('Alternate Phone');
      expect(html).toContain('—');
    });
  });

  describe('ConfirmDialog', () => {
    it('renders dialog title and content when open', () => {
      const html = renderToString(
        <ConfirmDialog
          open={true}
          disablePortal={true}
          title="Void Invoice"
          description="Are you sure you want to void this invoice? This cannot be undone."
          confirmLabel="Void Invoice"
          severity="error"
          onConfirm={() => {}}
          onClose={() => {}}
          confirmTestId="confirm.void"
          cancelTestId="confirm.cancel"
        />,
      );

      expect(html).toContain('Void Invoice');
      expect(html).toContain('Are you sure you want to void this invoice');
    });
  });

  describe('AppButton', () => {
    it('renders with default primary variant and text', () => {
      const html = renderToString(<AppButton>Save Details</AppButton>);
      expect(html).toContain('Save Details');
    });

    it('renders router link when "to" prop is passed', () => {
      const html = renderToString(
        <MemoryRouter>
          <AppButton to="/applications/new" variant="primary">
            + New Application
          </AppButton>
        </MemoryRouter>,
      );
      expect(html).toContain('href="/applications/new"');
      expect(html).toContain('+ New Application');
    });

    it('handles loading state with spinner and loadingText', () => {
      const html = renderToString(
        <AppButton loading loadingText="Submitting...">
          Submit
        </AppButton>,
      );
      expect(html).toContain('Submitting...');
      expect(html).toContain('MuiCircularProgress-root');
      expect(html).toContain('aria-busy="true"');
      expect(html).toContain('disabled');
    });

    it('renders various variants correctly', () => {
      const primaryHtml = renderToString(<AppButton variant="primary">Primary</AppButton>);
      const secondaryHtml = renderToString(<AppButton variant="secondary">Secondary</AppButton>);
      const outlinedHtml = renderToString(<AppButton variant="outlined">Outlined</AppButton>);
      const dangerHtml = renderToString(<AppButton variant="danger">Delete</AppButton>);

      expect(primaryHtml).toContain('Primary');
      expect(secondaryHtml).toContain('Secondary');
      expect(outlinedHtml).toContain('Outlined');
      expect(dangerHtml).toContain('Delete');
    });
  });

  describe('AppCard', () => {
    it('renders card with title, subtitle, badge, and actions', () => {
      const html = renderToString(
        <AppCard
          title="Loan Terms"
          subtitle="Interest and repayment specifications"
          badge={<StatusBadge status="ACTIVE" />}
          actions={<AppButton size="small">Edit</AppButton>}
          footer={<div>Card Footer</div>}
        >
          <div>Card Body Content</div>
        </AppCard>,
      );

      expect(html).toContain('Loan Terms');
      expect(html).toContain('Interest and repayment specifications');
      expect(html).toContain('ACTIVE');
      expect(html).toContain('Edit');
      expect(html).toContain('Card Body Content');
      expect(html).toContain('Card Footer');
    });
  });

  describe('SearchInput', () => {
    it('renders search input with placeholder and value', () => {
      const html = renderToString(
        <SearchInput value="test query" onSearchChange={() => {}} placeholder="Search customers..." />,
      );

      expect(html).toContain('value="test query"');
      expect(html).toContain('placeholder="Search customers..."');
    });
  });
});
