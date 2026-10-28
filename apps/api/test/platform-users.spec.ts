// Module 4: Users (User Management) tests — owner: Akash (Developer 2).
// Tests:
// - TEST-USR-001: List users with search, filtering, and cursor pagination
// - TEST-USR-002: View user details with ETag and 404 handling
// - TEST-USR-003: The direct create (POST /v1/users) is retired; invitations are the only way to add a staff user
// - TEST-USR-004: Update user with field validation, optimistic concurrency (If-Match), and ETag
// - TEST-USR-005: Account status change (Active, Deactivated, Suspended) with self-lockout guard
// - TEST-USR-006: Role assignment and removal with SOD-05 enforcement
// - TEST-USR-007: Tenant isolation and authorization guards (user.manage permission required)

import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestApp, fakeAuth, testPrincipal } from './support/fake-auth';
import { createMockPlatformStore } from './support/mock-platform-db';

describe('Module 4: Users (User Management API)', () => {
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

  const staffPrincipalWithoutManage = testPrincipal({
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

  it('TEST-USR-007 requires authentication for /v1/users', async () => {
    const store = createMockPlatformStore();
    const app = createTestApp({ deps: { txRunner: store.runner } });
    const res = await request(app).get('/v1/users');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('TEST-USR-007 without user.manage, the list is the picker projection: no contact data and no roles', async () => {
    const store = createMockPlatformStore();
    const app = createTestApp({
      auth: fakeAuth(staffPrincipalWithoutManage),
      deps: { txRunner: store.runner },
    });
    const res = await request(app).get('/v1/users');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const u of res.body.data) {
      expect(Object.keys(u).sort()).toEqual(['availability', 'deleted', 'displayName', 'id', 'primaryBranchId', 'status']);
    }
  });

  it('TEST-USR-001 lists users for tenant with search, filtering, and pagination', async () => {
    const store = createMockPlatformStore();
    const app = createTestApp({
      auth: fakeAuth(adminPrincipal),
      deps: { txRunner: store.runner },
    });

    // List all
    const res = await request(app).get('/v1/users');
    expect(res.status).toBe(200);
    expect(res.body.data).toBeInstanceOf(Array);
    expect(res.body.data.length).toBe(2); // Only tenant 1 users
    expect(res.body.meta).toBeDefined();
    expect(res.body.meta.limit).toBe(50);

    // Search by name
    const searchRes = await request(app).get('/v1/users?search=Priya');
    expect(searchRes.status).toBe(200);
    expect(searchRes.body.data.length).toBe(1);
    expect(searchRes.body.data[0].displayName).toBe('Priya Sharma');

    // Filter by status
    const filterRes = await request(app).get('/v1/users?status=ACTIVE');
    expect(filterRes.status).toBe(200);
    expect(filterRes.body.data.length).toBe(2);

    // Pagination limit=1
    const pagedRes = await request(app).get('/v1/users?limit=1');
    expect(pagedRes.status).toBe(200);
    expect(pagedRes.body.data.length).toBe(1);
    expect(pagedRes.body.meta.nextCursor).not.toBeNull();

    // The next page continues after the cursor
    const page2 = await request(app).get(`/v1/users?limit=1&cursor=${pagedRes.body.meta.nextCursor}`);
    expect(page2.body.data.length).toBe(1);
    expect(page2.body.data[0].id).not.toBe(pagedRes.body.data[0].id);

    // Lists mask email and mobile (Contracts §12); the full values are only on GET /v1/users/:id
    for (const u of res.body.data) {
      expect(u.email).toBeUndefined();
      expect(u.mobileE164).toBeUndefined();
      expect(u.emailMasked).toMatch(/\*\*\*/);
    }

    // A malformed cursor or limit is a 422, not page one
    expect((await request(app).get('/v1/users?cursor=not-a-cursor')).status).toBe(422);
    expect((await request(app).get('/v1/users?limit=abc')).status).toBe(422);
  });

  it('TEST-USR-002 views user details with ETag header and allows self-view', async () => {
    const store = createMockPlatformStore();

    // Admin view
    const adminApp = createTestApp({
      auth: fakeAuth(adminPrincipal),
      deps: { txRunner: store.runner },
    });
    const res = await request(adminApp).get('/v1/users/usr_staff_02');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('usr_staff_02');
    expect(res.body.displayName).toBe('Priya Sharma');
    expect(res.headers.etag).toBe('"0"');

    // Self-view without user.manage permission is allowed
    const staffApp = createTestApp({
      auth: fakeAuth(staffPrincipalWithoutManage),
      deps: { txRunner: store.runner },
    });
    const selfRes = await request(staffApp).get('/v1/users/usr_staff_02');
    expect(selfRes.status).toBe(200);
    expect(selfRes.body.id).toBe('usr_staff_02');

    // Non-existent user returns 404
    const notFoundRes = await request(adminApp).get('/v1/users/usr_non_existent');
    expect(notFoundRes.status).toBe(404);
    expect(notFoundRes.body.error.code).toBe('NOT_FOUND');
  });

  it('TEST-USR-003 the retired direct create is not routed, so it cannot write an active user', async () => {
    const store = createMockPlatformStore();
    const app = createTestApp({
      auth: fakeAuth(adminPrincipal),
      deps: { txRunner: store.runner },
    });

    const res = await request(app).post('/v1/users').send({
      email: 'rohit.verma@dsa.com',
      displayName: 'Rohit Verma',
      primaryBranchId: 'br_mumbai',
      status: 'ACTIVE',
      availability: 'AVAILABLE',
    });
    expect(res.status).toBe(404);

    const list = await request(app).get('/v1/users');
    expect(list.body.data.length).toBe(2);
  });

  it('TEST-USR-004 updates user profile and verifies optimistic concurrency (If-Match)', async () => {
    const store = createMockPlatformStore();
    const app = createTestApp({
      auth: fakeAuth(adminPrincipal),
      deps: { txRunner: store.runner },
    });

    // Update display name
    const updateRes = await request(app)
      .patch('/v1/users/usr_staff_02')
      .set('If-Match', '"0"')
      .send({ displayName: 'Priya Sharma-Kapoor', availability: 'BUSY' });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.displayName).toBe('Priya Sharma-Kapoor');
    expect(updateRes.body.availability).toBe('BUSY');

    // Stale If-Match triggers 409 VERSION_CONFLICT
    const conflictRes = await request(app)
      .patch('/v1/users/usr_staff_02')
      .set('If-Match', '"0"')
      .send({ displayName: 'Stale update' });

    expect(conflictRes.status).toBe(409);
    expect(conflictRes.body.error.code).toBe('VERSION_CONFLICT');
  });

  it('TEST-USR-005 supports user status change and prevents self-deactivation', async () => {
    const store = createMockPlatformStore();
    const app = createTestApp({
      auth: fakeAuth(adminPrincipal),
      deps: { txRunner: store.runner },
    });

    // Deactivate another user
    const deactRes = await request(app).patch('/v1/users/usr_staff_02').send({ status: 'DEACTIVATED' });
    expect(deactRes.status).toBe(200);
    expect(deactRes.body.status).toBe('DEACTIVATED');

    // Admin attempting to deactivate or suspend self is rejected (SOD guard)
    const selfDeactRes = await request(app)
      .patch(`/v1/users/${adminPrincipal.id}`)
      .send({ status: 'DEACTIVATED' });
    expect(selfDeactRes.status).toBe(403);
    expect(selfDeactRes.body.error.code).toBe('SOD_VIOLATION');
  });

  it('TEST-USR-006 assigns and removes user roles and enforces SOD-05', async () => {
    const store = createMockPlatformStore();
    const app = createTestApp({
      auth: fakeAuth(adminPrincipal),
      deps: { txRunner: store.runner },
    });

    // Admin cannot assign roles to self (SOD-05)
    const selfAssign = await request(app)
      .post(`/v1/users/${adminPrincipal.id}/roles`)
      .send({ roleId: 'rol_loan_officer', scopeType: 'TENANT' });
    expect(selfAssign.status).toBe(403);
    expect(selfAssign.body.error.code).toBe('SOD_VIOLATION');

    // Admin cannot remove roles from self (SOD-05)
    const selfRemove = await request(app).delete(`/v1/users/${adminPrincipal.id}/roles/rol_admin`);
    expect(selfRemove.status).toBe(403);
    expect(selfRemove.body.error.code).toBe('SOD_VIOLATION');

    // Assign role to another staff user
    const assignRes = await request(app)
      .post('/v1/users/usr_staff_02/roles')
      .send({ roleId: 'rol_admin', scopeType: 'TENANT' });
    expect(assignRes.status).toBe(201);
    expect(assignRes.body.id).toMatch(/^ura_/);

    // Remove role from staff user
    const removeRes = await request(app).delete('/v1/users/usr_staff_02/roles/rol_loan_officer');
    expect(removeRes.status).toBe(200);
    expect(removeRes.body.status).toBe('ok');
  });

  it('TEST-USR-007 enforces tenant isolation: cross-tenant access returns 404', async () => {
    const store = createMockPlatformStore();
    const app = createTestApp({
      auth: fakeAuth(adminPrincipal),
      deps: { txRunner: store.runner },
    });

    // Trying to access user from different tenant
    const res = await request(app).get('/v1/users/usr_other_tenant');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
