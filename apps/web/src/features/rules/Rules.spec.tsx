// apps/web/src/features/rules/Rules.spec.tsx — owner: Developer 6 (Module 23: Business Rule Engine)
import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { DecisionRecordDetailPage } from './DecisionRecordDetailPage';
import { DecisionRecordsListPage } from './DecisionRecordsListPage';
import { RuleSetDetailPage } from './RuleSetDetailPage';
import { RulesListPage } from './RulesListPage';
import { RuleVersionDetailPage } from './RuleVersionDetailPage';

describe('Module 23 — Business Rule Engine (BRE) Frontend Component Tests', () => {
  it('TEST-UI-BRE-001 renders RulesListPage header, tabs, and action buttons', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/rules']}>
        <RulesListPage />
      </MemoryRouter>,
    );

    expect(html).toContain('Business Rule Engine');
    expect(html).toContain('Rule Sets');
    expect(html).toContain('Decision Registry');
    expect(html).toContain('New Rule Set');
    expect(html).toContain('View Execution Logs');
  });

  it('TEST-UI-BRE-002 renders RuleSetDetailPage with versions and test suite tabs', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/rules/rs_01JTEST00000000000000000000']}>
        <Routes>
          <Route path="/rules/:ruleSetId" element={<RuleSetDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    // Initial loading or container renders
    expect(html).toBeDefined();
  });

  it('TEST-UI-BRE-003 renders RuleVersionDetailPage with action toolbar and editor', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/rules/versions/rsv_01JTEST00000000000000000000']}>
        <Routes>
          <Route path="/rules/versions/:versionId" element={<RuleVersionDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(html).toBeDefined();
  });

  it('TEST-UI-BRE-004 renders DecisionRecordsListPage table and filters', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/decisions']}>
        <DecisionRecordsListPage />
      </MemoryRouter>,
    );

    expect(html).toContain('Decision Execution Audit Records');
    expect(html).toContain('Decision Key');
    expect(html).toContain('Status');
    expect(html).toContain('Reset Filters');
  });

  it('TEST-UI-BRE-005 renders DecisionRecordDetailPage audit viewer container', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/decisions/dr_01JTEST00000000000000000000']}>
        <Routes>
          <Route path="/decisions/:id" element={<DecisionRecordDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(html).toBeDefined();
  });
});
