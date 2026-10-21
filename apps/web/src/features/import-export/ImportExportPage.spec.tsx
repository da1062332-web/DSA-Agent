// apps/web/src/features/import-export/ImportExportPage.spec.tsx — Tests for MOD-IMP UI
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ImportExportPage } from './ImportExportPage';

vi.mock('../../auth/AuthProvider', () => ({
  useAuth: () => ({
    session: { user: { id: 'usr_test' } },
  }),
  useOptionalAuth: () => ({
    session: { user: { id: 'usr_test' } },
  }),
}));

vi.mock('../../api/useMe', () => ({
  useMe: () => ({
    data: {
      id: 'usr_test',
      tenantId: 'ten_default',
      displayName: 'Test User',
      grants: [
        { code: 'import.run', scope: 'TENANT', branchIds: [] },
        { code: 'export.run', scope: 'TENANT', branchIds: [] },
      ],
    },
    isLoading: false,
    isError: false,
  }),
  hasPermission: () => true,
}));

vi.mock('./api', () => ({
  useImportBatches: () => ({
    data: [
      {
        id: 'imp_01JTESTBATCH001',
        tenantId: 'ten_default',
        requesterId: 'usr_test',
        targetEntity: 'LEAD',
        sourceFileKey: 'source/ten_default/imp_01JTESTBATCH001.csv',
        fileFormat: 'CSV',
        fileSizeBytes: 1024,
        checksumSha256: 'abc123',
        columnMapping: { 'Full Name': 'fullName', Mobile: 'mobile' },
        importOptions: {},
        status: 'COMPLETED',
        totalRows: 10,
        validRows: 9,
        invalidRows: 1,
        importedRows: 9,
        previewData: [{ 'Full Name': 'Aarav Kumar', Mobile: '9876543210' }],
        errorSummary: [],
        createdAt: '2026-10-14T00:00:00.000Z',
        updatedAt: '2026-10-14T00:00:00.000Z',
        expiresAt: '2026-10-21T00:00:00.000Z',
        lockVersion: 1,
      },
    ],
    isLoading: false,
  }),
  useExportJobs: () => ({
    data: [
      {
        id: 'exp_01JTESTEXPORT001',
        tenantId: 'ten_default',
        requesterId: 'usr_test',
        scopeType: 'TENANT',
        scopeId: null,
        exportType: 'LEAD',
        fileFormat: 'CSV',
        filters: {},
        rowCount: 42,
        fileKey: 'exports/ten_default/exp_01JTESTEXPORT001.csv',
        status: 'COMPLETED',
        downloadUrl: '/v1/exports/exp_01JTESTEXPORT001/download',
        expiresAt: '2026-10-15T00:00:00.000Z',
        downloadedAt: null,
        createdAt: '2026-10-14T00:00:00.000Z',
      },
    ],
    isLoading: false,
  }),
  useCreateImport: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useConfigureMapping: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCommitImport: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRollbackImport: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateExportJob: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

describe('CMP-IMP.01.1 — ImportExportPage Frontend Component', () => {
  it('renders page header and tabs for Bulk Import and Data Exports', () => {
    const qc = new QueryClient();
    const html = renderToString(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <ImportExportPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(html).toContain('Import and Export Framework (MOD-IMP)');
    expect(html).toContain('Bulk Import Wizard (CMP-IMP.01.1)');
    expect(html).toContain('Data Exports (SUB-IMP.02)');
  });

  it('renders Step 1 upload controls and recent batches table', () => {
    const qc = new QueryClient();
    const html = renderToString(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <ImportExportPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(html).toContain('Step 1: Upload Source File');
    expect(html).toContain('Target Entity');
    expect(html).toContain('Recent Import Batches');
    expect(html).toContain('imp_01JTESTBATCH001');
  });
});
