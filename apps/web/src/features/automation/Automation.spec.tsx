// apps/web/src/features/automation/Automation.spec.tsx — owner: Akash (Module 24: Workflow Automation MOD-WFA)
import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

// No signed-in user in these render tests: permissions fail closed, as they do before sign-in.
vi.mock('../../api/useMe', () => ({
  useMe: () => ({ data: undefined, isLoading: false, isError: false }),
  hasPermission: () => false,
}));
import { AutomationListPage } from './AutomationListPage';
import { AutomationDetailPage } from './AutomationDetailPage';

describe('Module 24 — Workflow Automation (MOD-WFA) UI Component Suite', () => {
  it('TEST-UI-WFA-001 renders AutomationListPage title, tabs, and creation triggers', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/automations']}>
        <AutomationListPage />
      </MemoryRouter>,
    );

    expect(html).toContain('Workflow Automation Engine');
    expect(html).toContain('Automation Rules');
    expect(html).toContain('Execution Logs');
    expect(html).toContain('Dead Letter Queue');
    expect(html).toContain('New Automation Rule');
  });

  it('TEST-UI-WFA-002 renders AutomationDetailPage container', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/automations/wfd_01JTEST00000000000000000000']}>
        <Routes>
          <Route path="/automations/:id" element={<AutomationDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(html).toBeDefined();
  });
});
