// Module 6: Configuration tests — owner: Akash (Developer 2).
// Tests:
// - TEST-CFG-001: Authentication and permission guards (401 unauthenticated, 403 forbidden without config.manage)
// - TEST-CFG-002: Tenant and organisation configuration retrieval with ETag and operational defaults
// - TEST-CFG-003: Tenant configuration updates with concurrency control (If-Match) and validation
// - TEST-CFG-004: Branch list and single get with ETag
// - TEST-CFG-005: Branch creation with code regex, 6-digit pincode validation, duplicate prevention
// - TEST-CFG-006: Branch updates with concurrency control (If-Match)
// - TEST-CFG-007: Multi-tenant isolation (branches and config cannot be accessed or modified across tenants)

import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestApp, fakeAuth, testPrincipal } from './support/fake-auth';
import { createMockPlatformStore } from './support/mock-platform-db';

describe('Module 6: Configuration & Branch Management API', () => {
  const configAdminPrincipal = testPrincipal({
    id: 'usr_config_admin',
    tenantId: 'ten_01JTESTTENANT00000000000000',
    grants: [
      {
        code: 'config.manage',
        scope: 'TENANT',
        branchIds: [],
      },
    ],
  });

  const staffPrincipal = testPrincipal({
    id: 'usr_staff_user',
    tenantId: 'ten_01JTESTTENANT00000000000000',
    grants: [
      {
        code: 'lead.read',
        scope: 'BRANCH',
        branchIds: ['br_mumbai'],
      },
    ],
  });

  const otherTenantAdmin = testPrincipal({
    id: 'usr_other_tenant_admin',
    tenantId: 'ten_OTHER_000000000000000000',
    grants: [
      {
        code: 'config.manage',
        scope: 'TENANT',
        branchIds: [],
      },
    ],
  });

  describe('TEST-CFG-001: Authentication & Authorization Guards', () => {
    it('rejects unauthenticated requests with 401 UNAUTHENTICATED', async () => {
      const store = createMockPlatformStore();
      const app = createTestApp({ deps: { txRunner: store.runner } });

      const getCfg = await request(app).get('/v1/config');
      expect(getCfg.status).toBe(401);
      expect(getCfg.body.error.code).toBe('UNAUTHENTICATED');

      const patchCfg = await request(app).patch('/v1/config').send({ timezone: 'Asia/Kolkata' });
      expect(patchCfg.status).toBe(401);
      expect(patchCfg.body.error.code).toBe('UNAUTHENTICATED');

      const postBr = await request(app).post('/v1/branches').send({ code: 'PUN01', name: 'Pune' });
      expect(postBr.status).toBe(401);
      expect(postBr.body.error.code).toBe('UNAUTHENTICATED');

      const patchBr = await request(app).patch('/v1/branches/br_mumbai').send({ name: 'Updated' });
      expect(patchBr.status).toBe(401);
      expect(patchBr.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('rejects requests without config.manage with 403 FORBIDDEN', async () => {
      const store = createMockPlatformStore();
      const app = createTestApp({
        deps: { txRunner: store.runner },
        auth: fakeAuth(staffPrincipal),
      });

      const getCfg = await request(app).get('/v1/config');
      expect(getCfg.status).toBe(403);
      expect(getCfg.body.error.code).toBe('FORBIDDEN');

      const patchCfg = await request(app).patch('/v1/config').send({ timezone: 'Asia/Kolkata' });
      expect(patchCfg.status).toBe(403);
      expect(patchCfg.body.error.code).toBe('FORBIDDEN');

      const postBr = await request(app).post('/v1/branches').send({ code: 'PUN01', name: 'Pune' });
      expect(postBr.status).toBe(403);
      expect(postBr.body.error.code).toBe('FORBIDDEN');

      const patchBr = await request(app).patch('/v1/branches/br_mumbai').send({ name: 'Updated' });
      expect(patchBr.status).toBe(403);
      expect(patchBr.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('TEST-CFG-002: Tenant and Organisation Configuration Retrieval', () => {
    it('retrieves tenant and organisation summary with ETag header and operational defaults', async () => {
      const store = createMockPlatformStore();
      const app = createTestApp({
        deps: { txRunner: store.runner },
        auth: fakeAuth(configAdminPrincipal),
      });

      const res = await request(app).get('/v1/config');
      expect(res.status).toBe(200);
      expect(res.headers.etag).toBe('"0"');

      // Tenant details
      expect(res.body.tenant.id).toBe('ten_01JTESTTENANT00000000000000');
      expect(res.body.tenant.slug).toBe('acme-dsa');
      expect(res.body.tenant.legalName).toBe('Acme Financial Services Private Limited');
      expect(res.body.tenant.tenantType).toBe('DSA_ORG');
      expect(res.body.tenant.dataRegion).toBe('IN');
      expect(res.body.tenant.timezone).toBe('Asia/Kolkata');
      expect(res.body.tenant.status).toBe('ACTIVE');

      // Organisation details
      expect(res.body.organisation.id).toBe('org_01');
      expect(res.body.organisation.legalName).toBe('Acme Financial Services Private Limited');
      expect(res.body.organisation.constitution).toBe('PVT_LTD');
      expect(res.body.organisation.status).toBe('ACTIVE');
      expect(res.body.organisation.lockVersion).toBe(0);

      // Operational settings
      expect(res.body.operationalSettings.defaultSlaMinutes).toBe(15);
      expect(res.body.operationalSettings.leadRoutingMode).toBe('ROUND_ROBIN');
      expect(res.body.operationalSettings.businessHoursStart).toBe('09:30');
      expect(res.body.operationalSettings.businessHoursEnd).toBe('18:30');
      expect(res.body.operationalSettings.dataRetentionDays).toBe(365);
    });
  });

  describe('TEST-CFG-003: Updating Configuration and Concurrency Control', () => {
    it('updates organisation name, constitution, and operational settings with lock_version increment', async () => {
      const store = createMockPlatformStore();
      const app = createTestApp({
        deps: { txRunner: store.runner },
        auth: fakeAuth(configAdminPrincipal),
      });

      const updateRes = await request(app)
        .patch('/v1/config')
        .set('If-Match', '"0"')
        .send({
          organisationName: 'Acme Financial Services Ltd',
          constitution: 'PUBLIC_LTD',
          timezone: 'Asia/Kolkata',
          operationalSettings: {
            defaultSlaMinutes: 30,
            leadRoutingMode: 'MANUAL',
            businessHoursStart: '09:00',
            businessHoursEnd: '19:00',
            dataRetentionDays: 730,
          },
        });

      expect(updateRes.status).toBe(200);
      expect(updateRes.headers.etag).toBe('"1"');
      expect(updateRes.body.organisation.legalName).toBe('Acme Financial Services Ltd');
      expect(updateRes.body.organisation.constitution).toBe('PUBLIC_LTD');
      expect(updateRes.body.organisation.lockVersion).toBe(1);
      expect(updateRes.body.operationalSettings.defaultSlaMinutes).toBe(30);
      expect(updateRes.body.operationalSettings.leadRoutingMode).toBe('MANUAL');
      expect(updateRes.body.operationalSettings.businessHoursStart).toBe('09:00');
      expect(updateRes.body.operationalSettings.businessHoursEnd).toBe('19:00');
      expect(updateRes.body.operationalSettings.dataRetentionDays).toBe(730);

      // Verify persistence via GET /v1/config
      const getRes = await request(app).get('/v1/config');
      expect(getRes.status).toBe(200);
      expect(getRes.body.organisation.legalName).toBe('Acme Financial Services Ltd');
      expect(getRes.body.organisation.constitution).toBe('PUBLIC_LTD');
      expect(getRes.body.organisation.lockVersion).toBe(1);
      expect(getRes.headers.etag).toBe('"1"');
    });

    it('rejects update with mismatched If-Match with 409 VERSION_CONFLICT', async () => {
      const store = createMockPlatformStore();
      const app = createTestApp({
        deps: { txRunner: store.runner },
        auth: fakeAuth(configAdminPrincipal),
      });

      const conflictRes = await request(app)
        .patch('/v1/config')
        .set('If-Match', '"99"')
        .send({ organisationName: 'Conflicting Name' });

      expect(conflictRes.status).toBe(409);
      expect(conflictRes.body.error.code).toBe('VERSION_CONFLICT');
    });

    it('rejects invalid payload with 422 VALIDATION_ERROR', async () => {
      const store = createMockPlatformStore();
      const app = createTestApp({
        deps: { txRunner: store.runner },
        auth: fakeAuth(configAdminPrincipal),
      });

      const res = await request(app)
        .patch('/v1/config')
        .send({
          organisationName: 'A', // Too short (min 2)
          operationalSettings: {
            defaultSlaMinutes: 0, // Min 1
            businessHoursStart: '25:00', // Invalid format
          },
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('TEST-CFG-004: Branch Listing and Single Branch View', () => {
    it('lists branches for authenticated tenant', async () => {
      const store = createMockPlatformStore();
      const app = createTestApp({
        deps: { txRunner: store.runner },
        auth: fakeAuth(configAdminPrincipal),
      });

      const res = await request(app).get('/v1/branches');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0].code).toBe('DEL01'); // DEL01 before MUM01 alphabetically
      expect(res.body.data[1].code).toBe('MUM01');
    });

    it('retrieves single branch details with ETag header', async () => {
      const store = createMockPlatformStore();
      const app = createTestApp({
        deps: { txRunner: store.runner },
        auth: fakeAuth(configAdminPrincipal),
      });

      const res = await request(app).get('/v1/branches/br_mumbai');
      expect(res.status).toBe(200);
      expect(res.headers.etag).toBe('"0"');
      expect(res.body.id).toBe('br_mumbai');
      expect(res.body.code).toBe('MUM01');
      expect(res.body.name).toBe('Mumbai Central');
      expect(res.body.pincode).toBe('400001');
      expect(res.body.timezone).toBe('Asia/Kolkata');
      expect(res.body.status).toBe('ACTIVE');
      expect(res.body.lockVersion).toBe(0);
    });

    it('returns 404 NOT_FOUND for unknown branch', async () => {
      const store = createMockPlatformStore();
      const app = createTestApp({
        deps: { txRunner: store.runner },
        auth: fakeAuth(configAdminPrincipal),
      });

      const res = await request(app).get('/v1/branches/br_nonexistent');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('TEST-CFG-005: Branch Creation with Code & Pincode Validation', () => {
    it('creates a new branch successfully with valid code and pincode', async () => {
      const store = createMockPlatformStore();
      const app = createTestApp({
        deps: { txRunner: store.runner },
        auth: fakeAuth(configAdminPrincipal),
      });

      const res = await request(app).post('/v1/branches').send({
        code: 'PUN01',
        name: 'Pune Shivaji Nagar',
        pincode: '411005',
        timezone: 'Asia/Kolkata',
      });

      expect(res.status).toBe(201);
      expect(res.headers.etag).toBe('"0"');
      expect(res.body.id).toMatch(/^br_/);
      expect(res.body.code).toBe('PUN01');
      expect(res.body.name).toBe('Pune Shivaji Nagar');
      expect(res.body.pincode).toBe('411005');
      expect(res.body.status).toBe('ACTIVE');
      expect(res.body.lockVersion).toBe(0);

      // Verify branch appears in list
      const listRes = await request(app).get('/v1/branches');
      expect(listRes.body.data.some((b: any) => b.code === 'PUN01')).toBe(true);
    });

    it('rejects invalid branch code formats with 422 VALIDATION_ERROR', async () => {
      const store = createMockPlatformStore();
      const app = createTestApp({
        deps: { txRunner: store.runner },
        auth: fakeAuth(configAdminPrincipal),
      });

      // Lowercase or special characters not allowed in code ^[A-Z0-9_-]{2,20}$
      const res = await request(app).post('/v1/branches').send({
        code: 'pun_lowercase',
        name: 'Invalid Code Branch',
      });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects invalid pincode formats with 422 VALIDATION_ERROR', async () => {
      const store = createMockPlatformStore();
      const app = createTestApp({
        deps: { txRunner: store.runner },
        auth: fakeAuth(configAdminPrincipal),
      });

      // Pincode must be 6 digits starting with 1-9
      const res1 = await request(app).post('/v1/branches').send({
        code: 'BLR01',
        name: 'Bangalore Branch',
        pincode: '012345', // Starts with 0
      });
      expect(res1.status).toBe(422);
      expect(res1.body.error.code).toBe('VALIDATION_ERROR');

      const res2 = await request(app).post('/v1/branches').send({
        code: 'BLR01',
        name: 'Bangalore Branch',
        pincode: '5600', // Only 4 digits
      });
      expect(res2.status).toBe(422);
      expect(res2.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects duplicate branch code with 422 VALIDATION_ERROR', async () => {
      const store = createMockPlatformStore();
      const app = createTestApp({
        deps: { txRunner: store.runner },
        auth: fakeAuth(configAdminPrincipal),
      });

      const res = await request(app).post('/v1/branches').send({
        code: 'MUM01', // Already exists in tenant
        name: 'Duplicate Mumbai',
      });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details.some((d: any) => d.field === 'code')).toBe(true);
    });
  });

  describe('TEST-CFG-006: Branch Updates and Concurrency Control', () => {
    it('updates branch details and increments lock_version', async () => {
      const store = createMockPlatformStore();
      const app = createTestApp({
        deps: { txRunner: store.runner },
        auth: fakeAuth(configAdminPrincipal),
      });

      const res = await request(app).patch('/v1/branches/br_mumbai').set('If-Match', '"0"').send({
        name: 'Mumbai Regional HQ',
        pincode: '400020',
        status: 'ACTIVE',
      });

      expect(res.status).toBe(200);
      expect(res.headers.etag).toBe('"1"');
      expect(res.body.name).toBe('Mumbai Regional HQ');
      expect(res.body.pincode).toBe('400020');
      expect(res.body.lockVersion).toBe(1);

      // Verify retrieval
      const getRes = await request(app).get('/v1/branches/br_mumbai');
      expect(getRes.body.name).toBe('Mumbai Regional HQ');
      expect(getRes.body.pincode).toBe('400020');
      expect(getRes.body.lockVersion).toBe(1);
    });

    it('rejects update with mismatched If-Match with 409 VERSION_CONFLICT', async () => {
      const store = createMockPlatformStore();
      const app = createTestApp({
        deps: { txRunner: store.runner },
        auth: fakeAuth(configAdminPrincipal),
      });

      const res = await request(app)
        .patch('/v1/branches/br_mumbai')
        .set('If-Match', '"99"')
        .send({ name: 'Conflict Update' });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('VERSION_CONFLICT');
    });

    it('returns 404 NOT_FOUND when updating non-existent branch', async () => {
      const store = createMockPlatformStore();
      const app = createTestApp({
        deps: { txRunner: store.runner },
        auth: fakeAuth(configAdminPrincipal),
      });

      const res = await request(app).patch('/v1/branches/br_unknown').send({ name: 'Does Not Exist' });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('TEST-CFG-007: Multi-Tenant Isolation', () => {
    it('isolates configuration data between tenants', async () => {
      const store = createMockPlatformStore();
      const tenantAApp = createTestApp({
        deps: { txRunner: store.runner },
        auth: fakeAuth(configAdminPrincipal),
      });
      const tenantBApp = createTestApp({
        deps: { txRunner: store.runner },
        auth: fakeAuth(otherTenantAdmin),
      });

      const cfgA = await request(tenantAApp).get('/v1/config');
      expect(cfgA.status).toBe(200);
      expect(cfgA.body.tenant.slug).toBe('acme-dsa');

      const cfgB = await request(tenantBApp).get('/v1/config');
      expect(cfgB.status).toBe(200);
      expect(cfgB.body.tenant.slug).toBe('other-corp');
      expect(cfgB.body.organisation.constitution).toBe('LLP');
    });

    it('prevents cross-tenant access to branches', async () => {
      const store = createMockPlatformStore();
      const otherApp = createTestApp({
        deps: { txRunner: store.runner },
        auth: fakeAuth(otherTenantAdmin),
      });

      // Tenant B tries to access Tenant A's branch br_mumbai
      const getRes = await request(otherApp).get('/v1/branches/br_mumbai');
      expect(getRes.status).toBe(404);
      expect(getRes.body.error.code).toBe('NOT_FOUND');

      // Tenant B tries to update Tenant A's branch br_mumbai
      const patchRes = await request(otherApp)
        .patch('/v1/branches/br_mumbai')
        .send({ name: 'Hacked Branch' });
      expect(patchRes.status).toBe(404);
      expect(patchRes.body.error.code).toBe('NOT_FOUND');
    });
  });
});
