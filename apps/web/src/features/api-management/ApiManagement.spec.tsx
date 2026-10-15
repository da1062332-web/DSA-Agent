// apps/web/src/features/api-management/ApiManagement.spec.tsx — owner: Akash (Module 36: API Management MOD-API)
import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ApiManagementPage } from './ApiManagementPage';

describe('Module 36 — API Management (MOD-API) UI Component Suite', () => {
  it('TEST-UI-API-001 renders ApiManagementPage title, metric cards, and registration triggers', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/api-management']}>
        <ApiManagementPage />
      </MemoryRouter>
    );

    expect(html).toContain('API Management &amp; Credentials');
    expect(html).toContain('Register API Client');
    expect(html).toContain('Registered Clients');
    expect(html).toContain('Active Integrations');
  });
});
