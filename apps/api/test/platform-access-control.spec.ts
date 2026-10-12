// Module 5: Access Control (RBAC, Roles, Permissions, Assignments) tests — owner: Akash (Developer 2).
// Tests:
// - TEST-ACL-001: Permission catalog listing with auth/forbidden guards
// - TEST-ACL-002: Role CRUD (list, get with ETag, create with code validation, update with If-Match, delete guards)
// - TEST-ACL-003: User role assignment listing with self-view and user.manage guards
// - TEST-ACL-004: User effective permissions calculation with scope hierarchy
// - TEST-ACL-005: Separation of Duties (SOD-05) prevention of self-assignment / self-revocation
// - TEST-ACL-006: Tenant isolation guards (roles and assignments cannot leak across tenants)

import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestApp, fakeAuth, testPrincipal } from './support/fake-auth';
import { createMockPlatformStore } from './support/mock-platform-db';

describe('Module 5: Access Control (RBAC API)', () => {
  const adminPrincipal = testPrincipal({
    id: 'usr_01JTESTUSER0000000000000000',
    tenantId: 'ten_01JTESTTENANT00000000000000',
    grants: [
      {
        code: 'user.manage',
        scope: 'TENANT',
        branchIds: [],
      },
    ],
  });

  const staffPrincipal = testPrincipal({
    id: 'usr_staff_02',
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
    id: 'usr_other_admin',
    tenantId: 'ten_OTHER_000000000000000000',
    grants: [
      {
        code: 'user.manage',
        scope: 'TENANT',
        branchIds: [],
      },
    ],
  });

  describe('TEST-ACL-001: Permissions Catalog', () => {
    it('requires authentication for /v1/permissions', async () => {
      const store = createMockPlatformStore();
      const app = createTestApp({ deps: { txRunner: store.runner } });
      const res = await request(app).get('/v1/permissions');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('requires user.manage permission to view permissions catalog', async () => {
      const store = createMockPlatformStore();
      const app = createTestApp({
        auth: fakeAuth(staffPrincipal),
        deps: { txRunner: store.runner },
      });
      const res = await request(app).get('/v1/permissions');
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('returns catalog permissions for authorized admin', async () => {
      const store = createMockPlatformStore();
      const app = createTestApp({
        auth: fakeAuth(adminPrincipal),
        deps: { txRunner: store.runner },
      });
      const res = await request(app).get('/v1/permissions');
      expect(res.status).toBe(200);
      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.data.length).toBeGreaterThanOrEqual(5);
      expect(res.body.data[0]).toHaveProperty('code');
      expect(res.body.data[0]).toHaveProperty('description');
      expect(res.body.data[0]).toHaveProperty('introducedIn');
    });
  });

  describe('TEST-ACL-002: Role CRUD and Concurrency', () => {
    it('lists roles for caller tenant', async () => {
      const store = createMockPlatformStore();
      const app = createTestApp({
        auth: fakeAuth(adminPrincipal),
        deps: { txRunner: store.runner },
      });
      const res = await request(app).get('/v1/roles');
      expect(res.status).toBe(200);
      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.data.length).toBe(2);
      expect(res.body.data[0].code).toBe('ROLE-ADMIN');
    });

    it('gets role by ID with ETag', async () => {
      const store = createMockPlatformStore();
      const app = createTestApp({
        auth: fakeAuth(adminPrincipal),
        deps: { txRunner: store.runner },
      });
      const res = await request(app).get('/v1/roles/rol_admin');
      expect(res.status).toBe(200);
      expect(res.body.id).toBe('rol_admin');
      expect(res.body.name).toBe('Admin');
      expect(res.headers.etag).toBe('"1"');
      expect(res.body.permissions).toContain('user.manage');
    });

    it('returns 404 for unknown role ID', async () => {
      const store = createMockPlatformStore();
      const app = createTestApp({
        auth: fakeAuth(adminPrincipal),
        deps: { txRunner: store.runner },
      });
      const res = await request(app).get('/v1/roles/rol_nonexistent');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('creates a custom role with validation and permissions', async () => {
      const store = createMockPlatformStore();
      const app = createTestApp({
        auth: fakeAuth(adminPrincipal),
        deps: { txRunner: store.runner },
      });

      const res = await request(app)
        .post('/v1/roles')
        .send({
          code: 'ROLE-CREDIT-ANALYST',
          name: 'Credit Analyst',
          permissions: ['lead.read', 'task.read'],
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toMatch(/^rol_/);
      expect(res.body.code).toBe('ROLE-CREDIT-ANALYST');
      expect(res.body.name).toBe('Credit Analyst');
      expect(res.body.isTemplate).toBe(false);
      expect(res.body.version).toBe(1);
      expect(res.body.permissions).toEqual(['lead.read', 'task.read']);
      expect(res.headers.etag).toBe('"1"');
    });

    it('rejects creating role with invalid code pattern or duplicate code', async () => {
      const store = createMockPlatformStore();
      const app = createTestApp({
        auth: fakeAuth(adminPrincipal),
        deps: { txRunner: store.runner },
      });

      // Invalid format (lowercase)
      const invalidRes = await request(app)
        .post('/v1/roles')
        .send({
          code: 'role_invalid',
          name: 'Invalid Role',
        });
      expect(invalidRes.status).toBe(400);

      // Duplicate code
      const dupRes = await request(app)
        .post('/v1/roles')
        .send({
          code: 'ROLE-ADMIN',
          name: 'Another Admin',
        });
      expect(dupRes.status).toBe(400);
      expect(dupRes.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects creating role with unknown permission code', async () => {
      const store = createMockPlatformStore();
      const app = createTestApp({
        auth: fakeAuth(adminPrincipal),
        deps: { txRunner: store.runner },
      });

      const res = await request(app)
        .post('/v1/roles')
        .send({
          code: 'ROLE-SUPER-USER',
          name: 'Super User',
          permissions: ['system.destroy_everything'],
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('updates role with optimistic concurrency (If-Match)', async () => {
      const store = createMockPlatformStore();
      const app = createTestApp({
        auth: fakeAuth(adminPrincipal),
        deps: { txRunner: store.runner },
      });

      // Mismatch version
      const conflictRes = await request(app)
        .patch('/v1/roles/rol_loan_officer')
        .set('If-Match', '"999"')
        .send({ name: 'Senior Loan Officer' });
      expect(conflictRes.status).toBe(409);
      expect(conflictRes.body.error.code).toBe('CONCURRENCY_CONFLICT');

      // Successful update
      const updateRes = await request(app)
        .patch('/v1/roles/rol_loan_officer')
        .set('If-Match', '"1"')
        .send({
          name: 'Senior Loan Officer',
          permissions: ['lead.read', 'lead.create', 'task.read'],
        });
      expect(updateRes.status).toBe(200);
      expect(updateRes.body.name).toBe('Senior Loan Officer');
      expect(updateRes.body.version).toBe(2);
      expect(updateRes.body.permissions).toContain('task.read');
      expect(updateRes.headers.etag).toBe('"2"');
    });

    it('prevents deleting template role', async () => {
      const store = createMockPlatformStore();
      const app = createTestApp({
        auth: fakeAuth(adminPrincipal),
        deps: { txRunner: store.runner },
      });

      const res = await request(app).delete('/v1/roles/rol_admin');
      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('Template system roles cannot be deleted');
    });

    it('prevents deleting custom role that has active user assignments', async () => {
      const store = createMockPlatformStore();
      // Add custom role and assign it to user
      store.roles.push({
        id: 'rol_custom_assigned',
        tenant_id: 'ten_01JTESTTENANT00000000000000',
        code: 'ROLE-ASSIGNED-CUSTOM',
        name: 'Assigned Role',
        is_template: false,
        version: 1,
        permissions: ['lead.read'],
      });
      store.assignments.push({
        id: 'ura_assigned',
        tenant_id: 'ten_01JTESTTENANT00000000000000',
        user_id: 'usr_staff_02',
        role_id: 'rol_custom_assigned',
        scope_type: 'TENANT',
        scope_branch_ids: [],
        created_by: 'usr_01JTESTUSER0000000000000000',
      });

      const app = createTestApp({
        auth: fakeAuth(adminPrincipal),
        deps: { txRunner: store.runner },
      });

      const res = await request(app).delete('/v1/roles/rol_custom_assigned');
      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('currently assigned');
    });

    it('successfully deletes unassigned custom role', async () => {
      const store = createMockPlatformStore();
      store.roles.push({
        id: 'rol_custom_unassigned',
        tenant_id: 'ten_01JTESTTENANT00000000000000',
        code: 'ROLE-UNASSIGNED-CUSTOM',
        name: 'Unassigned Role',
        is_template: false,
        version: 1,
        permissions: ['lead.read'],
      });

      const app = createTestApp({
        auth: fakeAuth(adminPrincipal),
        deps: { txRunner: store.runner },
      });

      const res = await request(app).delete('/v1/roles/rol_custom_unassigned');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');

      // Verify it's gone
      const getRes = await request(app).get('/v1/roles/rol_custom_unassigned');
      expect(getRes.status).toBe(404);
    });
  });

  describe('TEST-ACL-003: User Role Assignments', () => {
    it('lists user role assignments for admin', async () => {
      const store = createMockPlatformStore();
      const app = createTestApp({
        auth: fakeAuth(adminPrincipal),
        deps: { txRunner: store.runner },
      });

      const res = await request(app).get('/v1/users/usr_staff_02/roles');
      expect(res.status).toBe(200);
      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].roleCode).toBe('ROLE-LOAN-OFFICER');
      expect(res.body.data[0].scopeType).toBe('TENANT');
    });

    it('allows user to view their own role assignments without user.manage permission', async () => {
      const store = createMockPlatformStore();
      const app = createTestApp({
        auth: fakeAuth(staffPrincipal),
        deps: { txRunner: store.runner },
      });

      const res = await request(app).get('/v1/users/usr_staff_02/roles');
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
    });

    it('forbids staff without user.manage from viewing another user role assignments', async () => {
      const store = createMockPlatformStore();
      const app = createTestApp({
        auth: fakeAuth(staffPrincipal),
        deps: { txRunner: store.runner },
      });

      const res = await request(app).get('/v1/users/usr_01JTESTUSER0000000000000000/roles');
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('TEST-ACL-004: User Effective Permissions Calculation', () => {
    it('calculates effective permissions and merges scope hierarchy', async () => {
      const store = createMockPlatformStore();
      // Add custom role with BRANCH scope granting lead.create and task.read
      store.roles.push({
        id: 'rol_branch_task',
        tenant_id: 'ten_01JTESTTENANT00000000000000',
        code: 'ROLE-BRANCH-TASK',
        name: 'Branch Task Manager',
        is_template: false,
        version: 1,
        permissions: ['lead.create', 'task.read'],
      });
      // User staff2 has rol_loan_officer (TENANT scope: lead.read, lead.create)
      // And add assignment to rol_branch_task with BRANCH scope
      store.assignments.push({
        id: 'ura_staff2_branch',
        tenant_id: 'ten_01JTESTTENANT00000000000000',
        user_id: 'usr_staff_02',
        role_id: 'rol_branch_task',
        scope_type: 'BRANCH',
        scope_branch_ids: ['br_mumbai'],
        created_by: 'usr_01JTESTUSER0000000000000000',
      });

      const app = createTestApp({
        auth: fakeAuth(adminPrincipal),
        deps: { txRunner: store.runner },
      });

      const res = await request(app).get('/v1/users/usr_staff_02/permissions');
      expect(res.status).toBe(200);
      expect(res.body.userId).toBe('usr_staff_02');
      expect(res.body.grants).toBeInstanceOf(Array);

      // lead.read has TENANT scope from loan officer role
      const leadRead = res.body.grants.find((g: any) => g.code === 'lead.read');
      expect(leadRead).toBeDefined();
      expect(leadRead.scope).toBe('TENANT');

      // lead.create has TENANT scope (from loan officer) and BRANCH (from branch role) -> TENANT wins!
      const leadCreate = res.body.grants.find((g: any) => g.code === 'lead.create');
      expect(leadCreate).toBeDefined();
      expect(leadCreate.scope).toBe('TENANT');

      // task.read only comes from branch role -> BRANCH scope with branchIds
      const taskRead = res.body.grants.find((g: any) => g.code === 'task.read');
      expect(taskRead).toBeDefined();
      expect(taskRead.scope).toBe('BRANCH');
      expect(taskRead.branchIds).toContain('br_mumbai');
    });

    it('allows self-view of effective permissions and forbids non-admin viewing others', async () => {
      const store = createMockPlatformStore();
      const app = createTestApp({
        auth: fakeAuth(staffPrincipal),
        deps: { txRunner: store.runner },
      });

      // Self-view OK
      const selfRes = await request(app).get('/v1/users/usr_staff_02/permissions');
      expect(selfRes.status).toBe(200);

      // Other user forbidden
      const otherRes = await request(app).get('/v1/users/usr_01JTESTUSER0000000000000000/permissions');
      expect(otherRes.status).toBe(403);
    });
  });

  describe('TEST-ACL-005: Separation of Duties (SOD-05)', () => {
    it('prevents user from assigning a role to themselves', async () => {
      const store = createMockPlatformStore();
      const app = createTestApp({
        auth: fakeAuth(adminPrincipal),
        deps: { txRunner: store.runner },
      });

      const res = await request(app)
        .post(`/v1/users/${adminPrincipal.id}/roles`)
        .send({
          roleId: 'rol_loan_officer',
          scopeType: 'TENANT',
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('SOD_VIOLATION');
      expect(res.body.error.message).toContain('SOD-05');
    });

    it('prevents user from revoking a role from themselves', async () => {
      const store = createMockPlatformStore();
      const app = createTestApp({
        auth: fakeAuth(adminPrincipal),
        deps: { txRunner: store.runner },
      });

      const res = await request(app).delete(`/v1/users/${adminPrincipal.id}/roles/rol_admin`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('SOD_VIOLATION');
      expect(res.body.error.message).toContain('SOD-05');
    });
  });

  describe('TEST-ACL-006: Tenant Isolation', () => {
    it('prevents tenant B admin from accessing tenant A roles or user assignments', async () => {
      const store = createMockPlatformStore();
      const app = createTestApp({
        auth: fakeAuth(otherTenantAdmin),
        deps: { txRunner: store.runner },
      });

      // Cannot access role of tenant A
      const roleRes = await request(app).get('/v1/roles/rol_admin');
      expect(roleRes.status).toBe(404);

      // Cannot access user assignments of tenant A
      const assignRes = await request(app).get('/v1/users/usr_staff_02/roles');
      expect(assignRes.status).toBe(404);

      // Cannot access user permissions of tenant A
      const permRes = await request(app).get('/v1/users/usr_staff_02/permissions');
      expect(permRes.status).toBe(404);
    });
  });
});
