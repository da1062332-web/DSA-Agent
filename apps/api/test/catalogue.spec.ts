// apps/api/test/catalogue.spec.ts — owner: Developer 5 (Bhushan)
// Test coverage for Module 28: Lender Management Enhancements (MOD-LND) & Module 29: Products (MOD-PRD)
import type { PermissionCode, RequestContext, Tx, TxRunner } from '@dsa/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { CatalogueService } from '../src/modules/origination/catalogue/catalogue-service';
import type {
  CatalogueRepository,
  EmpanelmentRow,
  LenderContactRow,
  LenderRow,
  LoanProductRow,
  LoanProductVersionRow,
} from '../src/modules/origination/catalogue/repository';
import { createTestApp, fakeAuth, testPrincipal } from './support/fake-auth';

const fakeTxRunner: TxRunner = {
  withTenantTx: async (_ctx, fn) => fn({} as any),
};

const appWith = (...grants: PermissionCode[]) =>
  createTestApp({
    auth: fakeAuth(
      testPrincipal({
        grants: grants.map((code) => ({ code, scope: 'TENANT' as const, branchIds: [] })),
      }),
    ),
    deps: { txRunner: fakeTxRunner },
  });

class InMemoryCatalogueRepository implements CatalogueRepository {
  lenders: LenderRow[] = [];
  empanelments: EmpanelmentRow[] = [];
  contacts: LenderContactRow[] = [];
  products: LoanProductRow[] = [];
  versions: LoanProductVersionRow[] = [];

  async insertLender(_tx: Tx, row: LenderRow): Promise<void> {
    this.lenders.push(row);
  }

  async findLenderById(_tx: Tx, tenantId: string, id: string): Promise<LenderRow | null> {
    return this.lenders.find((l) => l.tenant_id === tenantId && l.id === id) ?? null;
  }

  async findLenderByName(_tx: Tx, tenantId: string, name: string): Promise<LenderRow | null> {
    return this.lenders.find((l) => l.tenant_id === tenantId && l.name === name) ?? null;
  }

  async listLenders(
    _tx: Tx,
    tenantId: string,
    filters: { status?: string; lenderType?: string; cursor?: string; limit: number },
  ): Promise<{ rows: LenderRow[]; nextCursor: string | null }> {
    let list = this.lenders.filter((l) => l.tenant_id === tenantId);
    if (filters.status) list = list.filter((l) => l.status === filters.status);
    if (filters.lenderType) list = list.filter((l) => l.lender_type === filters.lenderType);
    return { rows: list.slice(0, filters.limit), nextCursor: null };
  }

  async updateLender(
    _tx: Tx,
    tenantId: string,
    id: string,
    expectedLockVersion: number,
    updates: Partial<LenderRow>,
  ): Promise<LenderRow | null> {
    const idx = this.lenders.findIndex((l) => l.tenant_id === tenantId && l.id === id);
    if (idx === -1) return null;
    const l = this.lenders[idx];
    if (!l || l.lock_version !== expectedLockVersion) return null;
    const updated: LenderRow = {
      ...l,
      ...updates,
      lock_version: l.lock_version + 1,
      updated_at: new Date(),
    };
    this.lenders[idx] = updated;
    return updated;
  }

  async insertEmpanelment(_tx: Tx, row: EmpanelmentRow): Promise<void> {
    this.empanelments.push(row);
  }

  async findEmpanelmentById(_tx: Tx, tenantId: string, id: string): Promise<EmpanelmentRow | null> {
    return this.empanelments.find((e) => e.tenant_id === tenantId && e.id === id) ?? null;
  }

  async listEmpanelments(_tx: Tx, tenantId: string, lenderId: string): Promise<EmpanelmentRow[]> {
    return this.empanelments.filter((e) => e.tenant_id === tenantId && e.lender_id === lenderId);
  }

  async updateEmpanelment(
    _tx: Tx,
    tenantId: string,
    id: string,
    expectedLockVersion: number,
    updates: Partial<EmpanelmentRow>,
  ): Promise<EmpanelmentRow | null> {
    const idx = this.empanelments.findIndex((e) => e.tenant_id === tenantId && e.id === id);
    if (idx === -1) return null;
    const e = this.empanelments[idx];
    if (!e || e.lock_version !== expectedLockVersion) return null;
    const updated: EmpanelmentRow = { ...e, ...updates, lock_version: e.lock_version + 1 };
    this.empanelments[idx] = updated;
    return updated;
  }

  async findActiveEmpanelmentForLender(
    _tx: Tx,
    tenantId: string,
    lenderId: string,
    category: string,
  ): Promise<EmpanelmentRow | null> {
    return (
      this.empanelments.find(
        (e) =>
          e.tenant_id === tenantId &&
          e.lender_id === lenderId &&
          e.status === 'ACTIVE' &&
          e.permitted_categories.includes(category),
      ) ?? null
    );
  }

  async replaceLenderContacts(
    _tx: Tx,
    tenantId: string,
    lenderId: string,
    contacts: LenderContactRow[],
  ): Promise<void> {
    this.contacts = this.contacts.filter((c) => !(c.tenant_id === tenantId && c.lender_id === lenderId));
    this.contacts.push(...contacts);
  }

  async listLenderContacts(_tx: Tx, tenantId: string, lenderId: string): Promise<LenderContactRow[]> {
    return this.contacts.filter((c) => c.tenant_id === tenantId && c.lender_id === lenderId);
  }

  async insertProduct(_tx: Tx, row: LoanProductRow): Promise<void> {
    this.products.push(row);
  }

  async findProductById(_tx: Tx, tenantId: string, id: string): Promise<LoanProductRow | null> {
    return this.products.find((p) => p.tenant_id === tenantId && p.id === id) ?? null;
  }

  async listProducts(
    _tx: Tx,
    tenantId: string,
    filters: { lenderId?: string; category?: string; status?: string; cursor?: string; limit: number },
  ): Promise<{ rows: LoanProductRow[]; nextCursor: string | null }> {
    let list = this.products.filter((p) => p.tenant_id === tenantId);
    if (filters.lenderId) list = list.filter((p) => p.lender_id === filters.lenderId);
    if (filters.category) list = list.filter((p) => p.category === filters.category);
    if (filters.status) list = list.filter((p) => p.status === filters.status);
    return { rows: list.slice(0, filters.limit), nextCursor: null };
  }

  async updateProductStatus(_tx: Tx, tenantId: string, id: string, status: string): Promise<LoanProductRow | null> {
    const p = this.products.find((x) => x.tenant_id === tenantId && x.id === id);
    if (!p) return null;
    p.status = status;
    return p;
  }

  async insertProductVersion(_tx: Tx, row: LoanProductVersionRow): Promise<void> {
    this.versions.push(row);
  }

  async findProductVersionById(_tx: Tx, tenantId: string, id: string): Promise<LoanProductVersionRow | null> {
    return this.versions.find((v) => v.tenant_id === tenantId && v.id === id) ?? null;
  }

  async findActiveProductVersion(_tx: Tx, tenantId: string, productId: string): Promise<LoanProductVersionRow | null> {
    const list = this.versions.filter((v) => v.tenant_id === tenantId && v.product_id === productId && v.status === 'ACTIVE');
    return list.sort((a, b) => b.version_no - a.version_no)[0] ?? null;
  }

  async listProductVersions(_tx: Tx, tenantId: string, productId: string): Promise<LoanProductVersionRow[]> {
    return this.versions.filter((v) => v.tenant_id === tenantId && v.product_id === productId);
  }
}

describe('Module 28: Lender Management Enhancements (MOD-LND)', () => {
  it('TC-LND-001 POST /v1/lenders enforces permission config.manage', async () => {
    const unauthApp = appWith('lead.read');
    const res = await request(unauthApp)
      .post('/v1/lenders')
      .set('Idempotency-Key', 'idem-12345678')
      .send({
        name: 'HDFC Bank',
        lenderType: 'BANK',
      });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('TC-LND-002 POST /v1/lenders validates payload schema', async () => {
    const app = appWith('config.manage');
    const res = await request(app)
      .post('/v1/lenders')
      .set('Idempotency-Key', 'idem-12345678')
      .send({
        name: 'X',
        lenderType: 'INVALID_TYPE',
      });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('TC-LND-003 PATCH /v1/lenders/:id requires If-Match header for optimistic concurrency', async () => {
    const app = appWith('config.manage');
    const res = await request(app)
      .patch('/v1/lenders/lnd_01J00000000000000000000000')
      .send({
        status: 'PAUSED',
        statusReason: 'Annual review pending',
      });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toContain('If-Match');
  });

  it('TC-LND-004 PUT /v1/lenders/:id/contacts validates contact payload', async () => {
    const app = appWith('config.manage');
    const res = await request(app)
      .put('/v1/lenders/lnd_01J00000000000000000000000/contacts')
      .send({
        contacts: [
          {
            name: 'Rohit Sharma',
            role: 'RM',
            email: 'invalid-email-address',
            channel: 'EMAIL',
            escalationLevel: 1,
          },
        ],
      });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('TC-LND-005 Full lifecycle: create lender, add empanelment, set contacts, and update status', async () => {
    const repo = new InMemoryCatalogueRepository();
    const service = new CatalogueService({ repository: repo });
    const ctx: RequestContext = {
      principal: testPrincipal({
        grants: [{ code: 'config.manage', scope: 'TENANT', branchIds: [] }],
      }),
      correlationId: 'corr-001',
      now: new Date(),
    };
    const tx = {} as Tx;

    // 1. Create Lender
    const lender = await service.createLender(tx, ctx, {
      name: 'Axis Bank',
      lenderType: 'BANK',
      regulatorRef: 'RBI-AXIS-01',
      status: 'ACTIVE',
    });
    expect(lender.id).toMatch(/^lnd_/);
    expect(lender.name).toBe('Axis Bank');
    expect(lender.lockVersion).toBe(0);

    // 2. Add Empanelment
    const emp = await service.createEmpanelment(tx, ctx, lender.id, {
      organisationId: 'org_01J00000000000000000000000',
      dsaCode: 'DSA-AXIS-MUM-01',
      validFrom: '2026-01-01',
      validTo: '2026-12-31',
      permittedCategories: ['HL', 'LAP'],
      status: 'ACTIVE',
    });
    expect(emp.id).toMatch(/^emp_/);
    expect(emp.dsaCode).toBe('DSA-AXIS-MUM-01');

    // 3. Set RM Contacts
    const contacts = await service.setLenderContacts(tx, ctx, lender.id, {
      contacts: [
        {
          name: 'Priya Mehta',
          role: 'National Head - Mortgages',
          email: 'priya.mehta@axis.example.com',
          phone: '+919876543210',
          channel: 'EMAIL',
          escalationLevel: 1,
        },
      ],
    });
    expect(contacts).toHaveLength(1);
    expect(contacts[0]?.name).toBe('Priya Mehta');

    // 4. Update Lender Status with lock version
    const updated = await service.updateLender(tx, ctx, lender.id, 0, {
      status: 'PAUSED',
      statusReason: 'Underwriting threshold renegotiation',
    });
    expect(updated.status).toBe('PAUSED');
    expect(updated.lockVersion).toBe(1);
  });

  it('TC-LND-006 Tenant isolation: Tenant B cannot access or update Tenant A\'s lender', async () => {
    const repo = new InMemoryCatalogueRepository();
    const service = new CatalogueService({ repository: repo });
    const tenantACtx: RequestContext = {
      principal: testPrincipal({
        tenantId: 'ten_tenantA000000000000000001',
        grants: [{ code: 'config.manage', scope: 'TENANT', branchIds: [] }],
      }),
      correlationId: 'corr-t-01',
      now: new Date(),
    };
    const tenantBCtx: RequestContext = {
      principal: testPrincipal({
        tenantId: 'ten_tenantB000000000000000002',
        grants: [{ code: 'config.manage', scope: 'TENANT', branchIds: [] }],
      }),
      correlationId: 'corr-t-02',
      now: new Date(),
    };
    const tx = {} as Tx;

    // Tenant A creates lender
    const lender = await service.createLender(tx, tenantACtx, {
      name: 'Kotak Bank',
      lenderType: 'BANK',
      status: 'ACTIVE',
    });

    // Tenant B cannot retrieve it -> 404 NOT_FOUND
    await expect(service.getLender(tx, tenantBCtx, lender.id)).rejects.toThrowError(/not found/i);

    // Tenant B cannot update it -> 404 NOT_FOUND
    await expect(
      service.updateLender(tx, tenantBCtx, lender.id, 0, { status: 'PAUSED' }),
    ).rejects.toThrowError(/not found/i);
  });

  it('TC-LND-007 Optimistic concurrency: Stale lock version throws VERSION_CONFLICT', async () => {
    const repo = new InMemoryCatalogueRepository();
    const service = new CatalogueService({ repository: repo });
    const ctx: RequestContext = {
      principal: testPrincipal({
        grants: [{ code: 'config.manage', scope: 'TENANT', branchIds: [] }],
      }),
      correlationId: 'corr-occ-01',
      now: new Date(),
    };
    const tx = {} as Tx;

    const lender = await service.createLender(tx, ctx, {
      name: 'IDFC First',
      lenderType: 'BANK',
      status: 'ACTIVE',
    });

    // Attempt update with stale version (e.g. 99 instead of 0)
    await expect(
      service.updateLender(tx, ctx, lender.id, 99, { status: 'PAUSED' }),
    ).rejects.toThrowError(/version conflict/i);
  });

  it('TC-LND-008 Empanelment tenant isolation and stale version conflict', async () => {
    const repo = new InMemoryCatalogueRepository();
    const service = new CatalogueService({ repository: repo });
    const ctxA: RequestContext = {
      principal: testPrincipal({
        tenantId: 'ten_tenantA000000000000000001',
        grants: [{ code: 'config.manage', scope: 'TENANT', branchIds: [] }],
      }),
      correlationId: 'corr-emp-01',
      now: new Date(),
    };
    const ctxB: RequestContext = {
      principal: testPrincipal({
        tenantId: 'ten_tenantB000000000000000002',
        grants: [{ code: 'config.manage', scope: 'TENANT', branchIds: [] }],
      }),
      correlationId: 'corr-emp-02',
      now: new Date(),
    };
    const tx = {} as Tx;

    const lender = await service.createLender(tx, ctxA, {
      name: 'Yes Bank',
      lenderType: 'BANK',
      status: 'ACTIVE',
    });
    const emp = await service.createEmpanelment(tx, ctxA, lender.id, {
      organisationId: 'org_01J00000000000000000000000',
      dsaCode: 'DSA-YES-01',
      validFrom: '2026-01-01',
      validTo: '2026-12-31',
      permittedCategories: ['PL'],
      status: 'ACTIVE',
    });

    // Tenant B cannot retrieve Tenant A's empanelment -> NOT_FOUND
    await expect(service.getEmpanelment(tx, ctxB, emp.id)).rejects.toThrowError(/not found/i);

    // Stale lock version update throws VERSION_CONFLICT
    await expect(
      service.updateEmpanelment(tx, ctxA, emp.id, 5, { status: 'SUSPENDED' }),
    ).rejects.toThrowError(/version conflict/i);
  });
});

describe('Module 29: Loan Product Management Enhancements (MOD-PRD)', () => {
  it('TC-PRD-001 POST /v1/products requires config.manage permission', async () => {
    const app = appWith('lead.read');
    const res = await request(app)
      .post('/v1/products')
      .send({
        lenderId: 'lnd_01J00000000000000000000000',
        name: 'Prime Home Loan',
        category: 'HL',
        applicantTypes: ['SALARIED'],
        secured: true,
      });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('TC-PRD-002 POST /v1/products validates category enum and amounts', async () => {
    const app = appWith('config.manage');
    const res = await request(app)
      .post('/v1/products')
      .send({
        lenderId: 'lnd_01J00000000000000000000000',
        name: 'Gold Loan Express',
        category: 'INVALID_CATEGORY',
        applicantTypes: ['INDIVIDUAL'],
        secured: true,
      });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('TC-PRD-003 POST /v1/products/:id/versions validates version parameters', async () => {
    const app = appWith('config.manage');
    const res = await request(app)
      .post('/v1/products/prd_01J00000000000000000000000/versions')
      .send({
        amountMin: '50000.00',
        amountMax: '1000000.00',
        currency: 'INR',
        tenureMinMonths: 0,
        tenureMaxMonths: 60,
      });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('TC-PRD-004 Product and Version Lifecycle with Paused and Empanelment Gates for Adwait', async () => {
    const repo = new InMemoryCatalogueRepository();
    const service = new CatalogueService({ repository: repo });
    const ctx: RequestContext = {
      principal: testPrincipal({
        grants: [{ code: 'config.manage', scope: 'TENANT', branchIds: [] }],
      }),
      correlationId: 'corr-002',
      now: new Date(),
    };
    const tx = {} as Tx;

    // Create an active lender
    const lender = await service.createLender(tx, ctx, {
      name: 'ICICI Bank',
      lenderType: 'BANK',
      status: 'ACTIVE',
    });

    // Create Product with initial version
    const product = await service.createProduct(tx, ctx, {
      lenderId: lender.id as any,
      name: 'ICICI Home Advantage',
      category: 'HL',
      applicantTypes: ['SALARIED', 'SELF_EMPLOYED_PROFESSIONAL'],
      secured: true,
      initialVersion: {
        amountMin: '1000000.00',
        amountMax: '50000000.00',
        currency: 'INR',
        tenureMinMonths: 12,
        tenureMaxMonths: 360,
        illustrativeRateText: '8.50% - 9.25% p.a.',
      },
    });
    expect(product.id).toMatch(/^prd_/);
    expect(product.activeVersion?.versionNo).toBe(1);
    expect(product.activeVersion?.amountMin).toBe('1000000.00');

    // Create new immutable Version 2 with extended attributes
    const v2 = await service.createProductVersion(tx, ctx, product.id, {
      amountMin: '1500000.00',
      amountMax: '75000000.00',
      currency: 'INR',
      tenureMinMonths: 12,
      tenureMaxMonths: 360,
      illustrativeRateText: '8.40% - 9.10% p.a.',
      feeText: '0.5% processing fee',
      geoRules: { states: ['MH', 'KA'] },
      documentProfileId: 'doc_profile_hl',
      workflowProfile: { tier: 'FAST_TRACK' },
    });
    expect(v2.versionNo).toBe(2);
    expect(v2.feeText).toBe('0.5% processing fee');
    expect(v2.geoRules).toEqual({ states: ['MH', 'KA'] });

    // Test Gate 1: Check Empanelment Gate (No empanelment yet)
    await expect(
      service.validateLenderAndEmpanelmentForCase(tx, ctx.principal.tenantId, lender.id, 'HL'),
    ).rejects.toThrowError(/EMPANELMENT_INACTIVE/);

    // Add active empanelment for HL with permittedGeos and agreementDocumentId
    const emp = await service.createEmpanelment(tx, ctx, lender.id, {
      organisationId: 'org_01J00000000000000000000000',
      dsaCode: 'DSA-ICICI-001',
      validFrom: '2026-01-01',
      validTo: '2026-12-31',
      permittedCategories: ['HL'],
      permittedGeos: { regions: ['WEST', 'SOUTH'] },
      agreementDocumentId: 'doc_agr_001',
      status: 'ACTIVE',
    });
    expect(emp.permittedGeos).toEqual({ regions: ['WEST', 'SOUTH'] });
    expect(emp.agreementDocumentId).toBe('doc_agr_001');

    // Retrieve empanelment directly
    const fetchedEmp = await service.getEmpanelment(tx, ctx, emp.id);
    expect(fetchedEmp.id).toBe(emp.id);
    expect(fetchedEmp.dsaCode).toBe('DSA-ICICI-001');

    // Gate should now pass!
    await expect(
      service.validateLenderAndEmpanelmentForCase(tx, ctx.principal.tenantId, lender.id, 'HL'),
    ).resolves.toBeUndefined();

    // Pause the lender
    await service.updateLender(tx, ctx, lender.id, 0, { status: 'PAUSED' });

    // Test Gate 2: Paused Lender Gate
    await expect(
      service.validateLenderAndEmpanelmentForCase(tx, ctx.principal.tenantId, lender.id, 'HL'),
    ).rejects.toThrowError(/LENDER_PAUSED/);
  });

  it('TC-PRD-005 Product tenant isolation: Tenant B cannot access Tenant A\'s product', async () => {
    const repo = new InMemoryCatalogueRepository();
    const service = new CatalogueService({ repository: repo });
    const ctxA: RequestContext = {
      principal: testPrincipal({
        tenantId: 'ten_tenantA000000000000000001',
        grants: [{ code: 'config.manage', scope: 'TENANT', branchIds: [] }],
      }),
      correlationId: 'corr-prd-iso-01',
      now: new Date(),
    };
    const ctxB: RequestContext = {
      principal: testPrincipal({
        tenantId: 'ten_tenantB000000000000000002',
        grants: [{ code: 'config.manage', scope: 'TENANT', branchIds: [] }],
      }),
      correlationId: 'corr-prd-iso-02',
      now: new Date(),
    };
    const tx = {} as Tx;

    const lender = await service.createLender(tx, ctxA, {
      name: 'SBI',
      lenderType: 'BANK',
      status: 'ACTIVE',
    });
    const product = await service.createProduct(tx, ctxA, {
      lenderId: lender.id as any,
      name: 'SBI Yuva Loan',
      category: 'PL',
      applicantTypes: ['SALARIED'],
      secured: false,
    });

    // Tenant B cannot get product -> NOT_FOUND
    await expect(service.getProduct(tx, ctxB, product.id)).rejects.toThrowError(/not found/i);

    // Tenant B cannot add a version to Tenant A's product -> NOT_FOUND
    await expect(
      service.createProductVersion(tx, ctxB, product.id, {
        amountMin: '50000.00',
        amountMax: '500000.00',
        currency: 'INR',
        tenureMinMonths: 12,
        tenureMaxMonths: 60,
      }),
    ).rejects.toThrowError(/not found/i);
  });
});
