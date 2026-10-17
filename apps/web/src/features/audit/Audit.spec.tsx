// apps/web/src/features/audit/Audit.spec.tsx — owner: Akash (Module 37: Audit MOD-AUD)
import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AuditSearchPage } from './AuditSearchPage';

describe('Module 37 — Audit (MOD-AUD) UI Component Suite', () => {
  it('TEST-UI-AUD-001 renders AuditSearchPage title, filters, and action buttons', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/audit']}>
        <AuditSearchPage />
      </MemoryRouter>,
    );

    expect(html).toContain('Audit Trail &amp; Cryptographic Verification');
    expect(html).toContain('Verify Chain Integrity');
    expect(html).toContain('Seal Chain');
    expect(html).toContain('Export Evidence Pack');
    expect(html).toContain('Filter Audit Log');
  });
});
