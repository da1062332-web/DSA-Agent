// apps/web/src/features/verification/VerificationDetail.spec.tsx — owner: Developer 2
import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { VerificationCreateDialog } from './VerificationCreateDialog';
import { VerificationDetailPage } from './VerificationDetailPage';
import { routes } from './routes';

describe('Module 19 — Verification Detail & Create Dialog Component Rendering', () => {
  it('renders VerificationCreateDialog with all form fields and actions when open', () => {
    const html = renderToString(
      <VerificationCreateDialog open={true} onClose={() => {}} onSuccess={() => {}} />
    );

    expect(html).toContain('Initiate Verification Case');
    expect(html).toContain('Loan Application ID');
    expect(html).toContain('Verification Type');
    expect(html).toContain('Branch');
    expect(html).toContain('Priority');
    expect(html).toContain('Initial Instructions / Scope Summary');
    expect(html).toContain('Cancel');
    expect(html).toContain('Create Verification');
  });

  it('renders VerificationDetailPage initial loading state', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/verifications/vrf_01JTEST']}>
        <Routes>
          <Route path="/verifications/:id" element={<VerificationDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    // Initial state renders circular loading indicator
    expect(html).toContain('MuiCircularProgress-root');
  });

  it('exports valid routes configuration for Module 19', () => {
    expect(routes).toHaveLength(2);
    expect(routes[0]?.path).toBe('/verifications');
    expect(routes[1]?.path).toBe('/verifications/:id');
  });
});
