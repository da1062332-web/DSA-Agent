// apps/web/src/features/verification/VerificationList.spec.tsx — owner: Developer 2
import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { VerificationListPage } from './VerificationListPage';

function renderVerificationList(initialPath = '/verifications') {
  return renderToString(
    <MemoryRouter initialEntries={[initialPath]}>
      <VerificationListPage />
    </MemoryRouter>
  );
}

describe('Module 19 — VerificationListPage Component Rendering', () => {
  it('renders page header and action buttons', () => {
    const html = renderVerificationList();

    expect(html).toContain('Verification Cases (Module 19)');
    expect(html).toContain('+ New Verification');
    expect(html).toContain('Manage document attestation, identity KYC, and field investigation workflows');
  });

  it('renders KPI summary cards', () => {
    const html = renderVerificationList();

    expect(html).toContain('Total Verifications');
    expect(html).toContain('Pending Initiation');
    expect(html).toContain('Under Review / Assigned');
    expect(html).toContain('Verified / Complete');
  });

  it('renders filter controls for status, type, and priority', () => {
    const html = renderVerificationList();

    expect(html).toContain('Status');
    expect(html).toContain('Verification Type');
    expect(html).toContain('Priority');
    expect(html).toContain('Refresh');
  });

  it('renders table columns correctly', () => {
    const html = renderVerificationList();

    expect(html).toContain('Verification ID');
    expect(html).toContain('Application ID');
    expect(html).toContain('Type');
    expect(html).toContain('Priority');
    expect(html).toContain('Status');
    expect(html).toContain('Outcome');
    expect(html).toContain('Assignee / Branch');
    expect(html).toContain('Actions');
  });
});
