// apps/api/test/imports.spec.ts — MOD-IMP Import Framework Test Suite
import type { RequestContext, Tx, TxRunner } from '@dsa/contracts';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryImportRepository } from '../src/modules/platform/imports/repository';
import { InMemoryReportingRepository } from '../src/modules/reporting/repository';
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
  let reportingRepo: InMemoryReportingRepository;

  const tenantA = 'ten_tenant_alpha';
  const tenantB = 'ten_tenant_beta';

  const importerUserA = testPrincipal({
    tenantId: tenantA,
    id: 'usr_importer_a',
    primaryBranchId: 'brn_a1',
    authTime: new Date().toISOString(),
    grants: [
      { code: 'lead.create', scope: 'TENANT', branchIds: [] },
      { code: 'customer.create', scope: 'TENANT', branchIds: [] },
      { code: 'import.run', scope: 'TENANT', branchIds: [] },
      { code: 'export.run', scope: 'TENANT', branchIds: [] },
    ],
  });

  const unauthorizedUser = testPrincipal({
    tenantId: tenantA,
    id: 'usr_unauth',
    primaryBranchId: 'brn_a1',
    authTime: null,
    grants: [], // No import, export, or create permissions
  });

  const tenantBUser = testPrincipal({
    tenantId: tenantB,
    id: 'usr_importer_b',
    primaryBranchId: 'brn_b1',
    authTime: new Date().toISOString(),
    grants: [
      { code: 'lead.create', scope: 'TENANT', branchIds: [] },
      { code: 'import.run', scope: 'TENANT', branchIds: [] },
      { code: 'export.run', scope: 'TENANT', branchIds: [] },
    ],
  });

  beforeEach(() => {
    repository = new InMemoryImportRepository();
    reportingRepo = new InMemoryReportingRepository();
  });

  function getApp(principal = importerUserA) {
    return createTestApp({
      auth: fakeAuth(principal),
      deps: {
        txRunner: inMemoryTxRunner,
        importRepository: repository,
        reportingRepository: reportingRepo,
        audit: {
          record: async () => 'aud_test',
        },
      },
    });
  }

  const sampleCsvContent = Buffer.from(
    'Full Name,Phone Number,Email Address,Product,Amount\n' +
      'Aarav Sharma,9876543210,aarav@example.com,PL,500000\n' +
      'Diya Patel,9123456780,diya@example.com,HL,2500000\n',
  ).toString('base64');

  const formulaCsvContent = Buffer.from(
    'Full Name,Phone Number,Email Address\n' + "=cmd|' /C calc'!A0,9876543210,bad@example.com\n",
  ).toString('base64');

  it('TC-IMP-001 rejects import creation when file content is empty or missing with 422 VALIDATION_ERROR', async () => {
    const app = getApp(importerUserA);

    const res = await request(app).post('/v1/imports').send({
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

    const res = await request(app).post('/v1/imports').send({
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

    const res = await request(app).post('/v1/imports').send({
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

    const res = await request(app).post('/v1/imports').send({
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

    const createRes = await request(app).post('/v1/imports').send({
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

    const createRes = await request(app).post('/v1/imports').send({
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
          Product: 'productCategory',
          Amount: 'indicativeAmount',
        },
      });

    expect(mapRes.status).toBe(200);
    expect(mapRes.body.status).toBe('MAPPED');
    expect(mapRes.body.columnMapping['Full Name']).toBe('fullName');
  });

  it('TC-IMP-008 rejects commit when batch is not in MAPPED status', async () => {
    const app = getApp(importerUserA);

    const createRes = await request(app).post('/v1/imports').send({
      targetEntity: 'LEAD',
      fileFormat: 'CSV',
      filename: 'leads_unmapped.csv',
      contentBase64: sampleCsvContent,
    });

    const batchId = createRes.body.id;

    // Direct commit without mapping
    const commitRes = await request(app).post(`/v1/imports/${batchId}/commit`).send({});

    expect(commitRes.status).toBe(422);
    expect(commitRes.body.error?.code).toBe('VALIDATION_ERROR');
  });

  it('TC-IMP-009 commits MAPPED batch idempotently and transitions to COMPLETED', async () => {
    const app = getApp(importerUserA);

    const createRes = await request(app).post('/v1/imports').send({
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
          Product: 'productCategory',
          Amount: 'indicativeAmount',
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
        'Invalid Phone,123,badphone@example.com\n',
    ).toString('base64');

    const createRes = await request(app).post('/v1/imports').send({
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

    const commitRes = await request(app).post(`/v1/imports/${batchId}/commit`).send({});

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

    const createRes = await request(app).post('/v1/imports').send({
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

    const createRes = await request(app).post('/v1/imports').send({
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

  it('TC-IMP-013 enforces cross-tenant isolation across all import operations', async () => {
    const appA = getApp(importerUserA);
    const appB = getApp(tenantBUser);

    const createRes = await request(appA).post('/v1/imports').send({
      targetEntity: 'LEAD',
      fileFormat: 'CSV',
      filename: 'tenant_a_data.csv',
      contentBase64: sampleCsvContent,
    });

    const batchId = createRes.body.id;

    // Tenant B attempts to read Tenant A's batch -> 404
    const getRes = await request(appB).get(`/v1/imports/${batchId}`);
    expect(getRes.status).toBe(404);

    // Tenant B attempts to configure mapping on Tenant A's batch -> 404
    const mapRes = await request(appB)
      .post(`/v1/imports/${batchId}/mapping`)
      .send({
        columnMapping: { 'Full Name': 'fullName', 'Phone Number': 'mobile' },
      });
    expect(mapRes.status).toBe(404);

    // Tenant B attempts to commit Tenant A's batch -> 404
    const commitRes = await request(appB).post(`/v1/imports/${batchId}/commit`).send({});
    expect(commitRes.status).toBe(404);

    // Tenant B attempts to download Tenant A's validation error report -> 404
    const reportRes = await request(appB).get(`/v1/imports/${batchId}/report`);
    expect(reportRes.status).toBe(404);

    // Tenant B attempts to rollback Tenant A's batch -> 404
    const rollbackRes = await request(appB)
      .post(`/v1/imports/${batchId}/rollback`)
      .send({ reason: 'Cross-tenant tampering attempt' });
    expect(rollbackRes.status).toBe(404);

    // Tenant B lists batches -> Tenant A's batch is not present
    const listRes = await request(appB).get('/v1/imports');
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.some((b: any) => b.id === batchId)).toBe(false);
  });

  it('TC-IMP-014 verifies export authentication, MFA step-up controls, and cross-tenant isolation', async () => {
    const appAuthorized = getApp(importerUserA);
    const appUnauth = getApp(unauthorizedUser);
    const appTenantB = getApp(tenantBUser);

    // 1. Missing permission -> 403 FORBIDDEN
    const forbiddenRes = await request(appUnauth).post('/v1/exports').send({
      exportType: 'METRICS',
      fileFormat: 'CSV',
      filters: {},
      scopeType: 'TENANT',
    });
    expect(forbiddenRes.status).toBe(403);

    // 2. Missing/stale MFA authTime -> 401 STEP_UP_REQUIRED
    const staleUser = testPrincipal({
      tenantId: tenantA,
      id: 'usr_stale_exp',
      primaryBranchId: 'brn_a1',
      authTime: null,
      grants: [{ code: 'export.run', scope: 'TENANT', branchIds: [] }],
    });
    const appStale = getApp(staleUser);
    const stepUpRes = await request(appStale).post('/v1/exports').send({
      exportType: 'METRICS',
      fileFormat: 'CSV',
      filters: {},
      scopeType: 'TENANT',
    });
    expect(stepUpRes.status).toBe(401);
    expect(stepUpRes.body.error?.code).toBe('STEP_UP_REQUIRED');

    // 3. Authorized caller with fresh MFA -> 201 CREATED
    const successRes = await request(appAuthorized).post('/v1/exports').send({
      exportType: 'METRICS',
      fileFormat: 'CSV',
      filters: {},
      scopeType: 'TENANT',
    });
    expect(successRes.status).toBe(201);
    const exportId = successRes.body.id;

    // 4. Cross-tenant export access -> 404
    const crossTenantGet = await request(appTenantB).get(`/v1/exports/${exportId}`);
    expect(crossTenantGet.status).toBe(404);

    const crossTenantDl = await request(appTenantB).get(`/v1/exports/${exportId}/download`);
    expect(crossTenantDl.status).toBe(404);
  });

  it('TC-IMP-015 verifies end-to-end 24-hour rollback lifecycle', async () => {
    const app = getApp(importerUserA);

    const createRes = await request(app).post('/v1/imports').send({
      targetEntity: 'LEAD',
      fileFormat: 'CSV',
      filename: 'leads_lifecycle_rollback.csv',
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

    // Rollback within 24h succeeds
    const rollbackRes = await request(app)
      .post(`/v1/imports/${batchId}/rollback`)
      .send({ reason: 'Operator requested rollback within SLA' });

    expect(rollbackRes.status).toBe(200);
    expect(rollbackRes.body.status).toBe('ROLLED_BACK');
    expect(rollbackRes.body.rolledBackAt).toBeDefined();

    // Idempotent repeat rollback returns the already rolled back batch with 200 OK
    const repeatRes = await request(app)
      .post(`/v1/imports/${batchId}/rollback`)
      .send({ reason: 'Repeated rollback attempt' });
    expect(repeatRes.status).toBe(200);
    expect(repeatRes.body.status).toBe('ROLLED_BACK');

    // Attempting to rollback an uncommitted/mapped batch fails with 422 VALIDATION_ERROR
    const uncommittedBatch = await request(app).post('/v1/imports').send({
      targetEntity: 'LEAD',
      fileFormat: 'CSV',
      filename: 'uncommitted.csv',
      contentBase64: sampleCsvContent,
    });
    const uncommittedId = uncommittedBatch.body.id;

    const invalidRollback = await request(app)
      .post(`/v1/imports/${uncommittedId}/rollback`)
      .send({ reason: 'Premature rollback attempt' });
    expect(invalidRollback.status).toBe(422);
    expect(invalidRollback.body.error?.code).toBe('VALIDATION_ERROR');
  });
});
