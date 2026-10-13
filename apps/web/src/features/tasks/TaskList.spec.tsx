// apps/web/src/features/tasks/TaskList.spec.tsx — owner: Dev 6 (UI-TASK-001 Automated Component Tests)
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { TaskList } from './TaskList';

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
  it('renders TaskList container with header and view controls in SSR / Memory context', () => {
    const html = renderTaskList();

    expect(html).toContain('Task Management (UI-TASK-001)');
    expect(html).toContain('+ Create Task');
    expect(html).toContain('Mine');
    expect(html).toContain('Queues');
    expect(html).toContain('All Visible');
  });

  it('renders filter dropdown control with Status label', () => {
    const html = renderTaskList();

    expect(html).toContain('Status');
    expect(html).toContain('MuiSelect-root');
  });

  it('renders initial loading indicator when query is loading', () => {
    const html = renderTaskList();

    // Query is initially in loading state before client hydration
    expect(html).toContain('MuiCircularProgress-root');
  });
});
