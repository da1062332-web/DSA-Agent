import type { Database, RequestContext, Tx, TxRunner } from '@dsa/contracts';
import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type DatabaseConnection,
  type Driver,
  type QueryResult,
} from 'kysely';

export interface MockUserRecord {
  id: string;
  tenant_id: string;
  idp_subject: string;
  email: string;
  mobile_e164: string | null;
  display_name: string;
  user_type: string;
  status: string;
  availability: string;
  primary_branch_id: string;
  lock_version: number;
  created_at: Date;
  updated_at: Date;
  assigned_roles: string[];
}

export interface MockTenantRecord {
  id: string;
  slug: string;
  legal_name: string;
  tenant_type: 'DSA_ORG' | 'NBFC_DISTRIBUTION';
  data_region: string;
  timezone: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'OFFBOARDING';
  created_at: Date;
  created_by: string;
}

export interface MockOrganisationRecord {
  id: string;
  tenant_id: string;
  legal_name: string;
  constitution: string;
  status: 'ACTIVE' | 'INACTIVE';
  lock_version: number;
  created_at: Date;
  created_by: string;
  updated_at: Date;
  updated_by: string;
}

export interface MockBranchRecord {
  id: string;
  tenant_id: string;
  organisation_id: string;
  code: string;
  name: string;
  pincode: string | null;
  timezone?: string;
  status: string;
  lock_version?: number;
  created_at?: Date;
  created_by?: string;
  updated_at?: Date;
  updated_by?: string;
}

export interface MockRoleRecord {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  is_template: boolean;
  version: number;
  permissions: string[];
}

export interface MockAssignmentRecord {
  id: string;
  tenant_id: string;
  user_id: string;
  role_id: string;
  scope_type: string;
  scope_branch_ids: string[];
  created_by: string;
}

export interface MockPermissionRecord {
  code: string;
  description: string;
  introduced_in: string;
}

export function createMockPlatformStore() {
  const tenants: MockTenantRecord[] = [
    {
      id: 'ten_01JTESTTENANT00000000000000',
      slug: 'acme-dsa',
      legal_name: 'Acme Financial Services Private Limited',
      tenant_type: 'DSA_ORG',
      data_region: 'IN',
      timezone: 'Asia/Kolkata',
      status: 'ACTIVE',
      created_at: new Date('2026-10-01T00:00:00Z'),
      created_by: 'usr_system',
    },
    {
      id: 'ten_OTHER_000000000000000000',
      slug: 'other-corp',
      legal_name: 'Other Distribution Corp',
      tenant_type: 'NBFC_DISTRIBUTION',
      data_region: 'IN',
      timezone: 'Asia/Kolkata',
      status: 'ACTIVE',
      created_at: new Date('2026-10-02T00:00:00Z'),
      created_by: 'usr_system',
    },
  ];

  const organisations: MockOrganisationRecord[] = [
    {
      id: 'org_01',
      tenant_id: 'ten_01JTESTTENANT00000000000000',
      legal_name: 'Acme Financial Services Private Limited',
      constitution: 'PVT_LTD',
      status: 'ACTIVE',
      lock_version: 0,
      created_at: new Date('2026-10-01T00:00:00Z'),
      created_by: 'usr_system',
      updated_at: new Date('2026-10-01T00:00:00Z'),
      updated_by: 'usr_system',
    },
    {
      id: 'org_other',
      tenant_id: 'ten_OTHER_000000000000000000',
      legal_name: 'Other Distribution Corp',
      constitution: 'LLP',
      status: 'ACTIVE',
      lock_version: 0,
      created_at: new Date('2026-10-02T00:00:00Z'),
      created_by: 'usr_system',
      updated_at: new Date('2026-10-02T00:00:00Z'),
      updated_by: 'usr_system',
    },
  ];

  const permissions: MockPermissionRecord[] = [
    { code: 'user.manage', description: 'Manage users', introduced_in: 'MVP-4D' },
    { code: 'role.manage', description: 'Manage roles and role-permission assignments', introduced_in: 'MVP-4D' },
    { code: 'config.manage', description: 'Manage configuration', introduced_in: 'MVP-4D' },
    { code: 'lead.read', description: 'Read leads in scope', introduced_in: 'MVP-4D' },
    { code: 'lead.create', description: 'Create leads', introduced_in: 'MVP-4D' },
    { code: 'task.read', description: 'Read tasks', introduced_in: 'MVP-4D' },
    { code: 'task.create', description: 'Create tasks', introduced_in: 'MVP-4D' },
  ];
  const branches: MockBranchRecord[] = [
    {
      id: 'br_mumbai',
      tenant_id: 'ten_01JTESTTENANT00000000000000',
      organisation_id: 'org_01',
      code: 'MUM01',
      name: 'Mumbai Central',
      pincode: '400001',
      timezone: 'Asia/Kolkata',
      status: 'ACTIVE',
      lock_version: 0,
      created_at: new Date('2026-10-01T00:00:00Z'),
      created_by: 'usr_system',
      updated_at: new Date('2026-10-01T00:00:00Z'),
      updated_by: 'usr_system',
    },
    {
      id: 'br_delhi',
      tenant_id: 'ten_01JTESTTENANT00000000000000',
      organisation_id: 'org_01',
      code: 'DEL01',
      name: 'Delhi North',
      pincode: '110001',
      timezone: 'Asia/Kolkata',
      status: 'ACTIVE',
      lock_version: 0,
      created_at: new Date('2026-10-01T00:00:00Z'),
      created_by: 'usr_system',
      updated_at: new Date('2026-10-01T00:00:00Z'),
      updated_by: 'usr_system',
    },
  ];

  const roles: MockRoleRecord[] = [
    {
      id: 'rol_admin',
      tenant_id: 'ten_01JTESTTENANT00000000000000',
      code: 'ROLE-ADMIN',
      name: 'Admin',
      is_template: true,
      version: 1,
      permissions: ['user.manage', 'role.manage', 'config.manage'],
    },
    {
      id: 'rol_loan_officer',
      tenant_id: 'ten_01JTESTTENANT00000000000000',
      code: 'ROLE-LOAN-OFFICER',
      name: 'Loan Officer',
      is_template: false, // a custom role: system templates are not editable, custom roles are
      version: 1,
      permissions: ['lead.read', 'lead.create'],
    },
  ];

  const users: MockUserRecord[] = [
    {
      id: 'usr_01JTESTUSER0000000000000000',
      tenant_id: 'ten_01JTESTTENANT00000000000000',
      idp_subject: 'idp_admin',
      email: 'admin@dsa.com',
      mobile_e164: '+919876543210',
      display_name: 'Akash Admin',
      user_type: 'STAFF',
      status: 'ACTIVE',
      availability: 'AVAILABLE',
      primary_branch_id: 'br_mumbai',
      lock_version: 0,
      created_at: new Date('2026-10-01T10:00:00Z'),
      updated_at: new Date('2026-10-01T10:00:00Z'),
      assigned_roles: ['Admin'],
    },
    {
      id: 'usr_staff_02',
      tenant_id: 'ten_01JTESTTENANT00000000000000',
      idp_subject: 'idp_staff2',
      email: 'staff2@dsa.com',
      mobile_e164: '+919876543211',
      display_name: 'Priya Sharma',
      user_type: 'STAFF',
      status: 'ACTIVE',
      availability: 'AVAILABLE',
      primary_branch_id: 'br_mumbai',
      lock_version: 0,
      created_at: new Date('2026-10-02T10:00:00Z'),
      updated_at: new Date('2026-10-02T10:00:00Z'),
      assigned_roles: ['Loan Officer'],
    },
    {
      id: 'usr_other_tenant',
      tenant_id: 'ten_OTHER_000000000000000000',
      idp_subject: 'idp_other',
      email: 'other@other.com',
      mobile_e164: '+919876543999',
      display_name: 'Other Tenant User',
      user_type: 'STAFF',
      status: 'ACTIVE',
      availability: 'AVAILABLE',
      primary_branch_id: 'br_mumbai',
      lock_version: 0,
      created_at: new Date('2026-10-03T10:00:00Z'),
      updated_at: new Date('2026-10-03T10:00:00Z'),
      assigned_roles: [],
    },
  ];

  const assignments: MockAssignmentRecord[] = [
    {
      id: 'ura_01',
      tenant_id: 'ten_01JTESTTENANT00000000000000',
      user_id: 'usr_01JTESTUSER0000000000000000',
      role_id: 'rol_admin',
      scope_type: 'TENANT',
      scope_branch_ids: [],
      created_by: 'usr_system',
    },
    {
      id: 'ura_02',
      tenant_id: 'ten_01JTESTTENANT00000000000000',
      user_id: 'usr_staff_02',
      role_id: 'rol_loan_officer',
      scope_type: 'TENANT',
      scope_branch_ids: [],
      created_by: 'usr_01JTESTUSER0000000000000000',
    },
  ];

  const handleQuery = (sqlText: string, params: readonly unknown[]): QueryResult<any> => {
    const sqlLower = sqlText.toLowerCase();

    // 1. SELECT branches list
    if (sqlLower.includes('from app.branch') && sqlLower.includes('organisation_id') && !sqlLower.includes('where id =')) {
      const tid = params[0] as string;
      const rows = branches
        .filter((b) => b.tenant_id === tid)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((b) => ({
          id: b.id,
          organisation_id: b.organisation_id,
          code: b.code,
          name: b.name,
          pincode: b.pincode,
          timezone: b.timezone ?? 'Asia/Kolkata',
          status: b.status,
          lock_version: b.lock_version ?? 0,
        }));
      return { rows };
    }

    // 2. Branch single fetch or existence check
    if (sqlLower.includes('select') && sqlLower.includes('from app.branch') && sqlLower.includes('where id =')) {
      const branchId = params[0] as string;
      const tid = params[1] as string;
      const found = branches.find((b) => b.id === branchId && b.tenant_id === tid);
      return {
        rows: found
          ? [
              {
                id: found.id,
                tenant_id: found.tenant_id,
                organisation_id: found.organisation_id,
                code: found.code,
                name: found.name,
                pincode: found.pincode,
                timezone: found.timezone ?? 'Asia/Kolkata',
                status: found.status,
                lock_version: found.lock_version ?? 0,
              },
            ]
          : [],
      };
    }

    // 3. Branch code uniqueness check
    if (sqlLower.includes('select') && sqlLower.includes('from app.branch') && sqlLower.includes('code =')) {
      const tid = params[0] as string;
      const code = params[1] as string;
      const found = branches.find((b) => b.tenant_id === tid && b.code === code);
      return { rows: found ? [{ id: found.id }] : [] };
    }

    // 4. Branch insert
    if (sqlLower.includes('insert into app.branch')) {
      const [id, tenant_id, organisation_id, code, name, pincode, timezone] = params;
      branches.push({
        id: id as string,
        tenant_id: tenant_id as string,
        organisation_id: organisation_id as string,
        code: code as string,
        name: name as string,
        pincode: (pincode as string) ?? null,
        timezone: (timezone as string) ?? 'Asia/Kolkata',
        status: 'ACTIVE',
        lock_version: 0,
        created_at: new Date(),
        created_by: params[10] as string,
        updated_at: new Date(),
        updated_by: params[12] as string,
      });
      return { rows: [] };
    }

    // 5. Branch update
    if (sqlLower.includes('update app.branch')) {
      const [name, pincode, timezone, status, lock_version, updated_by, id, tenant_id, currentLockVersion] = params;
      const b = branches.find((x) => x.id === id && x.tenant_id === tenant_id && (x.lock_version ?? 0) === (currentLockVersion as number));
      if (b) {
        b.name = name as string;
        b.pincode = (pincode as string) ?? null;
        b.timezone = (timezone as string) ?? 'Asia/Kolkata';
        b.status = status as string;
        b.lock_version = lock_version as number;
        b.updated_at = new Date();
        b.updated_by = updated_by as string;
      }
      return { rows: [] };
    }

    // 6. Tenant select
    if (sqlLower.includes('select') && sqlLower.includes('from app.tenant') && sqlLower.includes('where id =')) {
      const tid = params[0] as string;
      const t = tenants.find((x) => x.id === tid);
      return {
        rows: t
          ? [
              {
                id: t.id,
                slug: t.slug,
                legal_name: t.legal_name,
                tenant_type: t.tenant_type,
                data_region: t.data_region,
                timezone: t.timezone,
                status: t.status,
                created_at: t.created_at,
              },
            ]
          : [],
      };
    }

    // 7. Organisation select
    if (sqlLower.includes('select') && sqlLower.includes('from app.organisation') && sqlLower.includes('tenant_id =')) {
      const tid = params[0] as string;
      const org = organisations.find((x) => x.tenant_id === tid);
      return {
        rows: org
          ? [
              {
                id: org.id,
                tenant_id: org.tenant_id,
                legal_name: org.legal_name,
                constitution: org.constitution,
                status: org.status,
                lock_version: org.lock_version,
              },
            ]
          : [],
      };
    }

    // 8. Organisation update
    if (sqlLower.includes('update app.organisation')) {
      const [legalName, constitution, updatedBy, tenantId, orgId, lockVersion] = params;
      const org = organisations.find((x) => x.tenant_id === tenantId && x.id === orgId && x.lock_version === (lockVersion as number));
      if (org) {
        if (legalName !== null && legalName !== undefined) org.legal_name = legalName as string;
        if (constitution !== null && constitution !== undefined) org.constitution = constitution as string;
        org.lock_version += 1;
        org.updated_at = new Date();
        org.updated_by = updatedBy as string;
      }
      return { rows: [] };
    }

    // 9. Tenant update
    if (sqlLower.includes('update app.tenant')) {
      const [timezone, tenantId] = params;
      const t = tenants.find((x) => x.id === tenantId);
      if (t) {
        t.timezone = timezone as string;
      }
      return { rows: [] };
    }

    // Permissions list catalog
    if (sqlLower.includes('from app.permission')) {
      return { rows: permissions.slice().sort((a, b) => a.code.localeCompare(b.code)) };
    }

    // Role single fetch by ID with aggregated permissions
    if (sqlLower.includes('from app.role r') && sqlLower.includes('r.id =')) {
      const roleId = params[0] as string;
      const tid = params[1] as string;
      const r = roles.find((x) => x.id === roleId && x.tenant_id === tid);
      return {
        rows: r
          ? [
              {
                id: r.id,
                tenant_id: r.tenant_id,
                code: r.code,
                name: r.name,
                is_template: r.is_template,
                version: r.version,
                permissions: r.permissions,
              },
            ]
          : [],
      };
    }

    // Role duplicate code check
    if (sqlLower.includes('select') && sqlLower.includes('from app.role') && sqlLower.includes('code =')) {
      const tid = params[0] as string;
      const code = params[1] as string;
      const found = roles.find((r) => r.tenant_id === tid && r.code === code);
      return { rows: found ? [{ id: found.id }] : [] };
    }

    // Role existence / template / version check
    if (sqlLower.includes('select') && sqlLower.includes('from app.role') && sqlLower.includes('where id =')) {
      const roleId = params[0] as string;
      const tid = params[1] as string;
      const found = roles.find((r) => r.id === roleId && r.tenant_id === tid);
      return {
        rows: found
          ? [
              {
                id: found.id,
                tenant_id: found.tenant_id,
                code: found.code,
                name: found.name,
                is_template: found.is_template,
                version: found.version,
              },
            ]
          : [],
      };
    }

    // INSERT app.role
    if (sqlLower.includes('insert into app.role') && !sqlLower.includes('role_permission')) {
      const [id, tid, code, name, isTemplate, version] = params;
      roles.push({
        id: id as string,
        tenant_id: tid as string,
        code: code as string,
        name: name as string,
        is_template: Boolean(isTemplate),
        version: Number(version),
        permissions: [],
      });
      return { rows: [] };
    }

    // INSERT app.role_permission
    if (sqlLower.includes('insert into app.role_permission')) {
      const [tid, roleId, permCode] = params;
      const role = roles.find((r) => r.id === roleId && r.tenant_id === tid);
      if (role && !role.permissions.includes(permCode as string)) {
        role.permissions.push(permCode as string);
      }
      return { rows: [] };
    }

    // UPDATE app.role
    if (sqlLower.includes('update app.role') && sqlLower.includes('set name =')) {
      const [name, version, roleId, tid] = params;
      const role = roles.find((r) => r.id === roleId && r.tenant_id === tid);
      if (role) {
        role.name = name as string;
        role.version = Number(version);
      }
      return { rows: [] };
    }

    // DELETE app.role_permission
    if (sqlLower.includes('delete from app.role_permission')) {
      const [roleId, tid] = params;
      const role = roles.find((r) => r.id === roleId && r.tenant_id === tid);
      if (role) {
        role.permissions = [];
      }
      return { rows: [] };
    }

    // Check if role is assigned to any user
    if (sqlLower.includes('from app.user_role_assignment') && sqlLower.includes('where role_id =')) {
      const roleId = params[0] as string;
      const tid = params[1] as string;
      const found = assignments.find((a) => a.role_id === roleId && a.tenant_id === tid);
      return { rows: found ? [{ id: found.id }] : [] };
    }

    // DELETE app.role
    if (sqlLower.includes('delete from app.role') && !sqlLower.includes('role_permission') && sqlLower.includes('where id =')) {
      const [roleId, tid] = params;
      const idx = roles.findIndex((r) => r.id === roleId && r.tenant_id === tid);
      if (idx >= 0) roles.splice(idx, 1);
      return { rows: [] };
    }

    // Query user role assignments with role details
    if (sqlLower.includes('from app.user_role_assignment ura') && sqlLower.includes('join app.role r')) {
      const userId = params[0] as string;
      const tid = params[1] as string;
      const userAssignments = assignments.filter((a) => a.user_id === userId && a.tenant_id === tid);
      const rows = userAssignments.map((a) => {
        const r = roles.find((x) => x.id === a.role_id && x.tenant_id === tid);
        return {
          id: a.id,
          user_id: a.user_id,
          role_id: a.role_id,
          role_code: r ? r.code : '',
          role_name: r ? r.name : '',
          scope_type: a.scope_type,
          scope_branch_ids: a.scope_branch_ids,
          created_at: new Date('2026-10-01T10:00:00Z'),
        };
      });
      return { rows };
    }

    // Query user effective permissions
    if (sqlLower.includes('from app.user_role_assignment ura') && sqlLower.includes('join app.role_permission rp')) {
      const userId = params[0] as string;
      const tid = params[1] as string;
      const userAssignments = assignments.filter((a) => a.user_id === userId && a.tenant_id === tid);
      const rows: any[] = [];
      for (const a of userAssignments) {
        const r = roles.find((x) => x.id === a.role_id && x.tenant_id === tid);
        if (r) {
          for (const perm of r.permissions) {
            rows.push({
              permission_code: perm,
              scope_type: a.scope_type,
              scope_branch_ids: a.scope_branch_ids,
            });
          }
        }
      }
      return { rows };
    }

    // 4. SELECT roles list
    if (sqlLower.includes('select') && sqlLower.includes('from app.role') && !sqlLower.includes('where id =') && !sqlLower.includes('where r.id =') && !sqlLower.includes('code =')) {
      const tid = params[0] as string;
      const rows = roles
        .filter((r) => r.tenant_id === tid)
        .map((r) => ({
          id: r.id,
          tenant_id: r.tenant_id,
          code: r.code,
          name: r.name,
          is_template: r.is_template,
          version: r.version,
          permissions: r.permissions,
        }));
      return { rows };
    }

    // 5. Existing assignment check
    if (sqlLower.includes('from app.user_role_assignment') && sqlLower.includes('select id') && sqlLower.includes('user_id =')) {
      const uId = params[0] as string;
      const rId = params[1] as string;
      const tid = params[2] as string;
      const found = assignments.find((a) => a.user_id === uId && a.role_id === rId && a.tenant_id === tid);
      return { rows: found ? [{ id: found.id }] : [] };
    }

    // 6. INSERT user_role_assignment
    if (sqlLower.includes('insert into app.user_role_assignment')) {
      const [id, tid, userId, roleId, scopeType, scopeBranchIds, createdBy] = params;
      assignments.push({
        id: id as string,
        tenant_id: tid as string,
        user_id: userId as string,
        role_id: roleId as string,
        scope_type: scopeType as string,
        scope_branch_ids: (scopeBranchIds as string[]) ?? [],
        created_by: createdBy as string,
      });
      const user = users.find((u) => u.id === userId && u.tenant_id === tid);
      const role = roles.find((r) => r.id === roleId);
      if (user && role && !user.assigned_roles.includes(role.name)) {
        user.assigned_roles.push(role.name);
      }
      return { rows: [] };
    }

    // 7. END user_role_assignment (removal closes effective_range; the mock drops the assignment, which is how it looks to readers)
    if (sqlLower.includes('update app.user_role_assignment')) {
      const [userId, roleId, tid] = params;
      const idx = assignments.findIndex((a) => a.user_id === userId && a.role_id === roleId && a.tenant_id === tid);
      if (idx < 0) return { rows: [] };
      const ended = assignments.splice(idx, 1)[0]!;
      const user = users.find((u) => u.id === userId && u.tenant_id === tid);
      const role = roles.find((r) => r.id === roleId);
      if (user && role) {
        user.assigned_roles = user.assigned_roles.filter((r) => r !== role.name);
      }
      return { rows: [{ id: ended.id }] };
    }

    // 8. Duplicate email check
    if (sqlLower.includes('from app.app_user') && sqlLower.includes('email =')) {
      const tid = params[0] as string;
      const email = params[1] as string;
      const found = users.find((u) => u.tenant_id === tid && u.email.toLowerCase() === email.toLowerCase());
      return { rows: found ? [{ id: found.id }] : [] };
    }

    // 9. User check / lock_version check
    if (sqlLower.includes('from app.app_user') && sqlLower.includes('where id =') && !sqlLower.includes('display_name')) {
      const uId = params[0] as string;
      const tid = params[1] as string;
      const found = users.find((u) => u.id === uId && u.tenant_id === tid);
      return { rows: found ? [{ id: found.id, lock_version: found.lock_version }] : [] };
    }

    // 10. INSERT app_user
    if (sqlLower.includes('insert into app.app_user')) {
      const [
        id,
        tid,
        idpSubject,
        email,
        mobileE164,
        displayName,
        status,
        availability,
        primaryBranchId,
      ] = params;
      const newRecord: MockUserRecord = {
        id: id as string,
        tenant_id: tid as string,
        idp_subject: idpSubject as string,
        email: email as string,
        mobile_e164: (mobileE164 as string) ?? null,
        display_name: displayName as string,
        user_type: 'STAFF',
        status: (status as string) || 'ACTIVE',
        availability: (availability as string) || 'AVAILABLE',
        primary_branch_id: primaryBranchId as string,
        lock_version: 0,
        created_at: new Date(),
        updated_at: new Date(),
        assigned_roles: [],
      };
      users.push(newRecord);
      return { rows: [] };
    }

    // 11. UPDATE app_user display_name
    if (sqlLower.includes('update app.app_user') && sqlLower.includes('set display_name =')) {
      const [name, _updatedBy, uId, tid] = params;
      const u = users.find((x) => x.id === uId && x.tenant_id === tid);
      if (u) {
        u.display_name = name as string;
        u.lock_version += 1;
        u.updated_at = new Date();
      }
      return { rows: [] };
    }

    // 12. UPDATE app_user mobile_e164
    if (sqlLower.includes('update app.app_user') && sqlLower.includes('set mobile_e164 =')) {
      const [mobile, _updatedBy, uId, tid] = params;
      const u = users.find((x) => x.id === uId && x.tenant_id === tid);
      if (u) {
        u.mobile_e164 = mobile as string | null;
        u.lock_version += 1;
        u.updated_at = new Date();
      }
      return { rows: [] };
    }

    // 13. UPDATE app_user status
    if (sqlLower.includes('update app.app_user') && sqlLower.includes('set status =')) {
      const [st, _updatedBy, uId, tid] = params;
      const u = users.find((x) => x.id === uId && x.tenant_id === tid);
      if (u) {
        u.status = st as string;
        u.lock_version += 1;
        u.updated_at = new Date();
      }
      return { rows: [] };
    }

    // 14. UPDATE app_user availability
    if (sqlLower.includes('update app.app_user') && sqlLower.includes('set availability =')) {
      const [av, _updatedBy, uId, tid] = params;
      const u = users.find((x) => x.id === uId && x.tenant_id === tid);
      if (u) {
        u.availability = av as string;
        u.lock_version += 1;
        u.updated_at = new Date();
      }
      return { rows: [] };
    }

    // 15. UPDATE app_user primary_branch_id
    if (sqlLower.includes('update app.app_user') && sqlLower.includes('set primary_branch_id =')) {
      const [branch, _updatedBy, uId, tid] = params;
      const u = users.find((x) => x.id === uId && x.tenant_id === tid);
      if (u) {
        u.primary_branch_id = branch as string;
        u.lock_version += 1;
        u.updated_at = new Date();
      }
      return { rows: [] };
    }

    // 16. Single user fetch by ID
    if (sqlLower.includes('from app.app_user') && sqlLower.includes('where u.id =')) {
      const targetId = params[0] as string;
      const tid = params[1] as string;
      const u = users.find((x) => x.id === targetId && x.tenant_id === tid);
      if (!u) return { rows: [] };
      return {
        rows: [
          {
            id: u.id,
            tenant_id: u.tenant_id,
            email: u.email,
            mobile_e164: u.mobile_e164,
            display_name: u.display_name,
            user_type: u.user_type,
            status: u.status,
            availability: u.availability,
            primary_branch_id: u.primary_branch_id,
            lock_version: u.lock_version,
            created_at: u.created_at,
            updated_at: u.updated_at,
            assigned_roles: u.assigned_roles,
          },
        ],
      };
    }

    // 17. List users query (GROUP BY u.id ...)
    if (sqlLower.includes('from app.app_user') && sqlLower.includes('group by u.id')) {
      const tid = params[0] as string;
      const matching = users
        .filter((x) => x.tenant_id === tid)
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime() || b.id.localeCompare(a.id))
        .map((u) => ({
          id: u.id,
          tenant_id: u.tenant_id,
          email: u.email,
          mobile_e164: u.mobile_e164,
          display_name: u.display_name,
          user_type: u.user_type,
          status: u.status,
          availability: u.availability,
          primary_branch_id: u.primary_branch_id,
          lock_version: u.lock_version,
          created_at: u.created_at,
          updated_at: u.updated_at,
          assigned_roles: u.assigned_roles,
        }));
      return { rows: matching };
    }

    return { rows: [] };
  };

  class MockConnection implements DatabaseConnection {
    async executeQuery<R>(compiledQuery: { sql: string; parameters: readonly unknown[] }): Promise<QueryResult<R>> {
      return handleQuery(compiledQuery.sql, compiledQuery.parameters) as QueryResult<R>;
    }
    async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {}
  }

  const mockConn = new MockConnection();

  class MockDriver implements Driver {
    async init(): Promise<void> {}
    async acquireConnection(): Promise<DatabaseConnection> {
      return mockConn;
    }
    async beginTransaction(): Promise<void> {}
    async commitTransaction(): Promise<void> {}
    async rollbackTransaction(): Promise<void> {}
    async releaseConnection(): Promise<void> {}
    async destroy(): Promise<void> {}
  }

  const db = new Kysely<Database>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new MockDriver(),
      createIntrospector: (k) => new PostgresIntrospector(k),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });

  const runner: TxRunner = {
    async withTenantTx<T>(_ctx: RequestContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
      return fn(db as unknown as Tx);
    },
  };

  return { runner, users, branches, roles, assignments, tenants, organisations };
}
