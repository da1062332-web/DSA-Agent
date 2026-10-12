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

export interface MockBranchRecord {
  id: string;
  tenant_id: string;
  organisation_id: string;
  code: string;
  name: string;
  pincode: string | null;
  status: string;
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
  const permissions: MockPermissionRecord[] = [
    { code: 'user.manage', description: 'Manage users', introduced_in: 'MVP-4D' },
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
      status: 'ACTIVE',
    },
    {
      id: 'br_delhi',
      tenant_id: 'ten_01JTESTTENANT00000000000000',
      organisation_id: 'org_01',
      code: 'DEL01',
      name: 'Delhi North',
      pincode: '110001',
      status: 'ACTIVE',
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
      permissions: ['user.manage'],
    },
    {
      id: 'rol_loan_officer',
      tenant_id: 'ten_01JTESTTENANT00000000000000',
      code: 'ROLE-LOAN-OFFICER',
      name: 'Loan Officer',
      is_template: true,
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
        .sort((a, b) => a.name.localeCompare(b.name));
      return { rows };
    }

    // 2. Branch existence check
    if (sqlLower.includes('from app.branch') && sqlLower.includes('where id =')) {
      const branchId = params[0] as string;
      const tid = params[1] as string;
      const found = branches.find((b) => b.id === branchId && b.tenant_id === tid);
      return { rows: found ? [{ id: found.id }] : [] };
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
    if (sqlLower.includes('insert into app.role')) {
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
    if (sqlLower.includes('delete from app.role') && sqlLower.includes('where id =')) {
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
    if (sqlLower.includes('from app.role') && !sqlLower.includes('where id =')) {
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

    // 7. DELETE user_role_assignment
    if (sqlLower.includes('delete from app.user_role_assignment')) {
      const [userId, roleId, tid] = params;
      const idx = assignments.findIndex((a) => a.user_id === userId && a.role_id === roleId && a.tenant_id === tid);
      if (idx >= 0) assignments.splice(idx, 1);
      const user = users.find((u) => u.id === userId && u.tenant_id === tid);
      const role = roles.find((r) => r.id === roleId);
      if (user && role) {
        user.assigned_roles = user.assigned_roles.filter((r) => r !== role.name);
      }
      return { rows: [] };
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

  return { runner, users, branches, roles, assignments };
}
