// apps/web/src/features/tasks/TaskList.spec.tsx — owner: Dev 6 (UI-TASK-001 Automated Component Tests)
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setAuthToken } from '../../auth/token';
import { TaskList } from './TaskList';
import * as useMeModule from '../../api/useMe';

vi.mock('../../api/useMe', async () => {
  const actual = await vi.importActual<typeof useMeModule>('../../api/useMe');
  return {
    ...actual,
    useMe: vi.fn(),
  };
});

function renderTaskList(initialPath = '/tasks') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return renderToString(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <TaskList />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Module 9 — TaskList Frontend Component Rendering (UI-TASK-001)', () => {
  const mockUseMe = vi.mocked(useMeModule.useMe);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockGrants(grants: string[]) {
    mockUseMe.mockReturnValue({
      data: {
        id: 'usr_test',
        tenantId: 'ten_test',
        email: 'test@example.com',
        displayName: 'Test User',
        primaryBranchId: null,
        queueIds: [],
        grants: grants.map((code) => ({ code, scope: 'TENANT', branchIds: [] })),
        mfaVerifiedAt: null,
      },
      isLoading: false,
      isError: false,
    } as any);
  }

  it('renders TaskList container with header and view controls and hides + Create Task for view-only users', () => {
    mockGrants(['task.read']);
    const html = renderTaskList();

    expect(html).toContain('Tasks');
    expect(html).not.toContain('+ Create Task');
    expect(html).toContain('Mine');
    expect(html).toContain('Queues');
    expect(html).toContain('All Visible');
  });

  it('renders + Create Task when user possesses task.create', () => {
    mockGrants(['task.read', 'task.create']);
    const html = renderTaskList();

    expect(html).toContain('Tasks');
    expect(html).toContain('+ Create Task');
  });

  it('renders filter dropdown control with Status label', () => {
    mockGrants(['task.read']);
    const html = renderTaskList();

    expect(html).toContain('Status');
    expect(html).toContain('MuiSelect-root');
  });

  it('renders initial loading indicator when query is loading', () => {
    mockGrants(['task.read']);
    const html = renderTaskList();

    expect(html).toContain('MuiCircularProgress-root');
  });
});
