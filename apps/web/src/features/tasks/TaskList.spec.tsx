// apps/web/src/features/tasks/TaskList.spec.tsx
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { TaskList } from './TaskList';

describe('TaskList Frontend Component Rendering', () => {
  it('renders TaskList container in SSR / Memory context', () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const html = renderToString(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/tasks']}>
          <TaskList />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(html).toContain('Task Management (UI-TASK-001)');
    expect(html).toContain('+ Create Task');
    expect(html).toContain('Mine');
    expect(html).toContain('Queues');
  });
});
