// apps/api/test/imports.spec.ts — MOD-IMP Import Framework Test Suite
import type { RequestContext, Tx, TxRunner } from '@dsa/contracts';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryImportRepository } from '../src/modules/platform/imports/repository';
import { createTestApp, fakeAuth, testPrincipal } from './support/fake-auth';

const inMemoryTxRunner: TxRunner = {
  async withTenantTx<T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const tx = {} as any;
    tx.tenantId = ctx.principal.tenantId;
    return fn(tx as Tx);
  },
};

describe('Module MOD-IMP — Generic Bulk Import Framework', () => {
  let repository: InMemoryImportRepository;

  const tenantA = 'ten_tenant_alpha';
  const tenantB = 'ten_tenant_beta';

  const importerUserA = testPrincipal({
    tenantId: tenantA,
    id: 'usr_importer_a',
    primaryBranchId: 'brn_a1',
    grants: [
      { code: 'lead.create', scope: 'TENANT', branchIds: [] },
      { code: 'customer.create', scope: 'TENANT', branchIds: [] },
      { code: 'import.run', scope: 'TENANT', branchIds: [] },
    ],
  });

  const unauthorizedUser = testPrincipal({
    tenantId: tenantA,
    id: 'usr_unauth',
    primaryBranchId: 'brn_a1',
    grants: [], // No import or create permissions
  });

  const tenantBUser = testPrincipal({
    tenantId: tenantB,
    id: 'usr_importer_b',
    primaryBranchId: 'brn_b1',
    grants: [
      { code: 'lead.create', scope: 'TENANT', branchIds: [] },
      { code: 'import.run', scope: 'TENANT', branchIds: [] },
    ],
  });

  beforeEach(() => {
    repository = new InMemoryImportRepository();
  });

  function getApp(principal = importerUserA) {
    return createTestApp({
      auth: fakeAuth(principal),
      deps: {
        txRunner: inMemoryTxRunner,
        importRepository: repository,
        audit: {
          record: async () => 'aud_test',
        },
      },
    });
  }

  const sampleCsvContent = Buffer.from(
    'Full Name,Phone Number,Email Address,Product,Amount\n' +
    'Aarav Sharma,9876543210,aarav@example.com,PL,500000\n' +
    'Diya Patel,9123456780,diya@example.com,HL,2500000\n'
  ).toString('base64');

  const formulaCsvContent = Buffer.from(
    'Full Name,Phone Number,Email Address\n' +
    '=cmd|\' /C calc\'!A0,9876543210,bad@example.com\n'
  ).toString('base64');

  it('TC-IMP-001 rejects import creation when file content is empty or missing with 422 VALIDATION_ERROR', async () => {
    const app = getApp(importerUserA);

    const res = await request(app)
      .post('/v1/imports')
      .send({
        targetEntity: 'LEAD',
        fileFormat: 'CSV',
        filename: 'empty.csv',
        contentBase64: '',
      });

    expect(res.status).toBe(422);
    expect(res.body.error?.code).toBe('VALIDATION_ERROR');
  });

  it('TC-IMP-002 rejects unsupported file format or extension with 422 VALIDATION_ERROR', async () => {
    const app = getApp(importerUserA);

    const res = await request(app)
      .post('/v1/imports')
      .send({
        targetEntity: 'LEAD',
        fileFormat: 'PDF', // Unsupported
        filename: 'document.pdf',
        contentBase64: Buffer.from('dummy-pdf-content').toString('base64'),
      });

    expect(res.status).toBe(422);
  });

  it('TC-IMP-003 rejects formula injection risks in CSV data', async () => {
    const app = getApp(importerUserA);

    const res = await request(app)
      .post('/v1/imports')
      .send({
        targetEntity: 'LEAD',
        fileFormat: 'CSV',
        filename: 'formula_test.csv',
        contentBase64: formulaCsvContent,
      });

    expect(res.status).toBe(422);
    expect(res.body.error?.code).toBe('VALIDATION_ERROR');
    expect(res.body.error?.message).toContain('Formula injection risk');
  });

  it('TC-IMP-004 rejects unauthorized caller lacking target entity permission with 403 FORBIDDEN', async () => {
    const app = getApp(unauthorizedUser);

    const res = await request(app)
      .post('/v1/imports')
      .send({
        targetEntity: 'LEAD',
        fileFormat: 'CSV',
        filename: 'leads.csv',
        contentBase64: sampleCsvContent,
      });

    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe('FORBIDDEN');
  });

  it('TC-IMP-005 successfully creates import batch with parsed preview data and total rows', async () => {
    const app = getApp(importerUserA);

    const res = await request(app)
      .post('/v1/imports')
      .send({
        targetEntity: 'LEAD',
        fileFormat: 'CSV',
        filename: 'leads_valid.csv',
        contentBase64: sampleCsvContent,
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toMatch(/^imp_/);
    expect(res.body.status).toBe('PARSED');
    expect(res.body.totalRows).toBe(2);
    expect(res.body.previewData).toBeDefined();
    expect(res.body.previewData.length).toBe(2);
  });

  it('TC-IMP-006 rejects mapping configuration when required fields are missing', async () => {
    const app = getApp(importerUserA);

    const createRes = await request(app)
      .post('/v1/imports')
      .send({
        targetEntity: 'LEAD',
        fileFormat: 'CSV',
        filename: 'leads_for_map.csv',
        contentBase64: sampleCsvContent,
      });

    const batchId = createRes.body.id;

    // Missing 'mobile' target field
    const mapRes = await request(app)
      .post(`/v1/imports/${batchId}/mapping`)
      .send({
        columnMapping: {
          'Full Name': 'fullName',
        },
      });

    expect(mapRes.status).toBe(422);
    expect(mapRes.body.error?.code).toBe('VALIDATION_ERROR');
    expect(mapRes.body.error?.message).toContain('mobile');
  });

  it('TC-IMP-007 successfully configures column mapping and transitions batch to MAPPED', async () => {
    const app = getApp(importerUserA);

    const createRes = await request(app)
      .post('/v1/imports')
      .send({
        targetEntity: 'LEAD',
        fileFormat: 'CSV',
        filename: 'leads_map_ok.csv',
        contentBase64: sampleCsvContent,
      });

    const batchId = createRes.body.id;

    const mapRes = await request(app)
      .post(`/v1/imports/${batchId}/mapping`)
      .send({
        columnMapping: {
          'Full Name': 'fullName',
          'Phone Number': 'mobile',
          'Email Address': 'email',
          'Product': 'productCategory',
          'Amount': 'indicativeAmount',
        },
      });

    expect(mapRes.status).toBe(200);
    expect(mapRes.body.status).toBe('MAPPED');
    expect(mapRes.body.columnMapping['Full Name']).toBe('fullName');
  });

  it('TC-IMP-008 rejects commit when batch is not in MAPPED status', async () => {
    const app = getApp(importerUserA);

    const createRes = await request(app)
      .post('/v1/imports')
      .send({
        targetEntity: 'LEAD',
        fileFormat: 'CSV',
        filename: 'leads_unmapped.csv',
        contentBase64: sampleCsvContent,
      });

    const batchId = createRes.body.id;

    // Direct commit without mapping
    const commitRes = await request(app)
      .post(`/v1/imports/${batchId}/commit`)
      .send({});

    expect(commitRes.status).toBe(422);
    expect(commitRes.body.error?.code).toBe('VALIDATION_ERROR');
  });

  it('TC-IMP-009 commits MAPPED batch idempotently and transitions to COMPLETED', async () => {
    const app = getApp(importerUserA);

    const createRes = await request(app)
      .post('/v1/imports')
      .send({
        targetEntity: 'LEAD',
        fileFormat: 'CSV',
        filename: 'leads_commit.csv',
        contentBase64: sampleCsvContent,
      });

    const batchId = createRes.body.id;

    await request(app)
      .post(`/v1/imports/${batchId}/mapping`)
      .send({
        columnMapping: {
          'Full Name': 'fullName',
          'Phone Number': 'mobile',
          'Email Address': 'email',
          'Product': 'productCategory',
          'Amount': 'indicativeAmount',
        },
      });

    const commitRes = await request(app)
      .post(`/v1/imports/${batchId}/commit`)
      .set('Idempotency-Key', 'idemp_key_001')
      .send({});

    expect(commitRes.status).toBe(200);
    expect(commitRes.body.status).toBe('COMPLETED');
    expect(commitRes.body.importedRows).toBe(2);
    expect(commitRes.body.validRows).toBe(2);

    // Second commit with same idempotency key or on completed batch returns existing state safely
    const retryCommit = await request(app)
      .post(`/v1/imports/${batchId}/commit`)
      .set('Idempotency-Key', 'idemp_key_001')
      .send({});

    expect(retryCommit.status).toBe(200);
    expect(retryCommit.body.status).toBe('COMPLETED');
  });

  it('TC-IMP-010 handles row validation errors and generates downloadable error report', async () => {
    const app = getApp(importerUserA);

    // 1 valid row, 1 row with invalid phone number
    const mixedCsv = Buffer.from(
      'Full Name,Phone Number,Email Address\n' +
      'Valid Person,9876543210,valid@example.com\n' +
      'Invalid Phone,123,badphone@example.com\n'
    ).toString('base64');

    const createRes = await request(app)
      .post('/v1/imports')
      .send({
        targetEntity: 'LEAD',
        fileFormat: 'CSV',
        filename: 'mixed.csv',
        contentBase64: mixedCsv,
      });

    const batchId = createRes.body.id;

    await request(app)
      .post(`/v1/imports/${batchId}/mapping`)
      .send({
        columnMapping: {
          'Full Name': 'fullName',
          'Phone Number': 'mobile',
          'Email Address': 'email',
        },
      });

    const commitRes = await request(app)
      .post(`/v1/imports/${batchId}/commit`)
      .send({});

    expect(commitRes.status).toBe(200);
    expect(commitRes.body.status).toBe('COMPLETED');
    expect(commitRes.body.importedRows).toBe(1);
    expect(commitRes.body.invalidRows).toBe(1);
    expect(commitRes.body.reportFileKey).toBeDefined();

    // Download validation error report
    const reportRes = await request(app).get(`/v1/imports/${batchId}/report`);
    expect(reportRes.status).toBe(200);
    expect(reportRes.headers['content-type']).toContain('text/csv');
    expect(reportRes.text).toContain('INVALID_MOBILE');
  });

  it('TC-IMP-011 allows rollback within 24-hour window with audit reason', async () => {
    const app = getApp(importerUserA);

    const createRes = await request(app)
      .post('/v1/imports')
      .send({
        targetEntity: 'LEAD',
        fileFormat: 'CSV',
        filename: 'leads_rollback.csv',
        contentBase64: sampleCsvContent,
      });

    const batchId = createRes.body.id;

    await request(app)
      .post(`/v1/imports/${batchId}/mapping`)
      .send({
        columnMapping: {
          'Full Name': 'fullName',
          'Phone Number': 'mobile',
        },
      });

    await request(app).post(`/v1/imports/${batchId}/commit`).send({});

    const rollbackRes = await request(app)
      .post(`/v1/imports/${batchId}/rollback`)
      .send({ reason: 'Accidental duplicate file uploaded by operator' });

    expect(rollbackRes.status).toBe(200);
    expect(rollbackRes.body.status).toBe('ROLLED_BACK');
    expect(rollbackRes.body.rolledBackAt).toBeDefined();
  });

  it('TC-IMP-012 rejects rollback when 24-hour rollback window has expired', async () => {
    const app = getApp(importerUserA);

    const createRes = await request(app)
      .post('/v1/imports')
      .send({
        targetEntity: 'LEAD',
        fileFormat: 'CSV',
        filename: 'leads_expired_rollback.csv',
        contentBase64: sampleCsvContent,
      });

    const batchId = createRes.body.id;

    await request(app)
      .post(`/v1/imports/${batchId}/mapping`)
      .send({
        columnMapping: {
          'Full Name': 'fullName',
          'Phone Number': 'mobile',
        },
      });

    await request(app).post(`/v1/imports/${batchId}/commit`).send({});

    // Simulate batch committed 25 hours ago
    const batch = await repository.findBatchById({} as any, tenantA, batchId);
    if (batch) {
      batch.committed_at = new Date(Date.now() - 25 * 60 * 60 * 1000);
    }

    const rollbackRes = await request(app)
      .post(`/v1/imports/${batchId}/rollback`)
      .send({ reason: 'Attempting rollback past 24 hours' });

    expect(rollbackRes.status).toBe(422);
    expect(rollbackRes.body.error?.code).toBe('VALIDATION_ERROR');
    expect(rollbackRes.body.error?.message).toContain('24-hour rollback window');
  });

  it('TC-IMP-013 enforces cross-tenant isolation and blocks Tenant B from accessing Tenant A batch', async () => {
    const appA = getApp(importerUserA);
    const appB = getApp(tenantBUser);

    const createRes = await request(appA)
      .post('/v1/imports')
      .send({
        targetEntity: 'LEAD',
        fileFormat: 'CSV',
        filename: 'tenant_a_data.csv',
        contentBase64: sampleCsvContent,
      });

    const batchId = createRes.body.id;

    // Tenant B attempts to read Tenant A's batch
    const getRes = await request(appB).get(`/v1/imports/${batchId}`);
    expect(getRes.status).toBe(404);

    // Tenant B attempts to rollback Tenant A's batch
    const rollbackRes = await request(appB)
      .post(`/v1/imports/${batchId}/rollback`)
      .send({ reason: 'Cross-tenant tampering attempt' });

    expect(rollbackRes.status).toBe(404);
  });
});
