// OpenAPI registration for module platform (owner: see router.ts). Register this module's paths with zod schemas;
// tools/gen-openapi.ts writes openapi/openapi.yaml (never hand-edited; CI fails on a diff).
import {
  listResponse,
  CreateUserRequest,
  UpdateUserRequest,
  AssignRoleRequest,
  UserRoleAssignmentSummary,
  UserEffectiveGrants,
  RoleSummary,
  CreateRoleRequest,
  UpdateRoleRequest,
  PermissionSummary,
  UserSummary as FullUserSummary,
} from '@dsa/contracts';
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';
import { z, type ZodTypeAny } from 'zod';
import {
  Branch,
  BranchCreate,
  BranchList,
  BranchPatch,
  ListQuery,
  MeResponse,
  Organisation,
  OrganisationPatch,
  TeamCreate,
  TeamDetail,
  TeamList,
  TeamMembersPut,
  TeamPatch,
  Tenant,
  UserList,
  UserListQuery,
  WorkQueueCreate,
  WorkQueueDetail,
  WorkQueueList,
  WorkQueueMembersPut,
  WorkQueuePatch,
} from './schemas';

export const tags = [
  {
    name: 'MOD-USR Users',
    description: 'User management, staff accounts, profiles, and assignments (MOD-USR).',
  },
  {
    name: 'MOD-ACL Access Control',
    description: 'Role-based access control, custom roles, and permission catalog (MOD-ACL).',
  },
  {
    name: 'MOD-ORG Organisation',
    description: 'Organisation hierarchy, branches, teams, and work queues (MOD-ORG).',
  },
];

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';
interface Op {
  method: Method;
  path: string;
  id: string;
  summary: string;
  response: ZodTypeAny;
  status?: 200 | 201;
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  idem?: boolean;
  ifMatch?: boolean;
  tags?: string[];
}

const json = (schema: ZodTypeAny) => ({ 'application/json': { schema } });

export function registerOpenApi(registry: OpenAPIRegistry): void {
  const ops: Op[] = [
    {
      method: 'get',
      path: '/v1/me',
      id: 'API-USR-010',
      summary: 'The signed-in user: profile, grants, MFA state',
      response: MeResponse,
      tags: ['MOD-USR Users'],
    },
    {
      method: 'get',
      path: '/v1/users',
      id: 'API-USR-LIST',
      summary: 'Users of the tenant with role aggregation and search',
      response: UserList,
      query: UserListQuery,
      tags: ['MOD-USR Users'],
    },
    {
      method: 'post',
      path: '/v1/users',
      id: 'API-USR-CREATE',
      summary: 'Create a new staff user',
      body: CreateUserRequest,
      response: FullUserSummary,
      status: 201,
      tags: ['MOD-USR Users'],
    },
    {
      method: 'get',
      path: '/v1/users/{id}',
      id: 'API-USR-GET',
      summary: 'Get user details by ID',
      response: FullUserSummary,
      tags: ['MOD-USR Users'],
    },
    {
      method: 'patch',
      path: '/v1/users/{id}',
      id: 'API-USR-UPDATE',
      summary: 'Update user profile, status, or availability',
      body: UpdateUserRequest,
      response: FullUserSummary,
      tags: ['MOD-USR Users'],
    },
    {
      method: 'get',
      path: '/v1/users/{id}/roles',
      id: 'API-USR-ROLES-LIST',
      summary: 'List roles assigned to a user',
      response: listResponse(UserRoleAssignmentSummary),
      tags: ['MOD-USR Users'],
    },
    {
      method: 'post',
      path: '/v1/users/{id}/roles',
      id: 'API-USR-ROLES-ASSIGN',
      summary: 'Assign a role to a user (enforces SOD-05)',
      body: AssignRoleRequest,
      response: UserRoleAssignmentSummary,
      status: 201,
      tags: ['MOD-USR Users'],
    },
    {
      method: 'delete',
      path: '/v1/users/{id}/roles/{roleId}',
      id: 'API-USR-ROLES-REMOVE',
      summary: 'Remove role assignment from a user (enforces SOD-05)',
      response: z.object({ status: z.string() }),
      tags: ['MOD-USR Users'],
    },
    {
      method: 'get',
      path: '/v1/users/{id}/permissions',
      id: 'API-USR-PERMS-GET',
      summary: 'Calculate effective permissions for a user',
      response: UserEffectiveGrants,
      tags: ['MOD-USR Users'],
    },
    {
      method: 'get',
      path: '/v1/roles',
      id: 'API-ACL-ROLES-LIST',
      summary: 'List roles in tenant with permissions',
      response: listResponse(RoleSummary),
      tags: ['MOD-ACL Access Control'],
    },
    {
      method: 'post',
      path: '/v1/roles',
      id: 'API-ACL-ROLES-CREATE',
      summary: 'Create a custom role',
      body: CreateRoleRequest,
      response: RoleSummary,
      status: 201,
      tags: ['MOD-ACL Access Control'],
    },
    {
      method: 'get',
      path: '/v1/roles/{id}',
      id: 'API-ACL-ROLES-GET',
      summary: 'Get role details by ID',
      response: RoleSummary,
      tags: ['MOD-ACL Access Control'],
    },
    {
      method: 'patch',
      path: '/v1/roles/{id}',
      id: 'API-ACL-ROLES-UPDATE',
      summary: 'Update role name or permissions',
      body: UpdateRoleRequest,
      response: RoleSummary,
      ifMatch: true,
      tags: ['MOD-ACL Access Control'],
    },
    {
      method: 'delete',
      path: '/v1/roles/{id}',
      id: 'API-ACL-ROLES-DELETE',
      summary: 'Delete a custom role',
      response: z.object({ status: z.string() }),
      tags: ['MOD-ACL Access Control'],
    },
    {
      method: 'get',
      path: '/v1/permissions',
      id: 'API-ACL-PERMS-LIST',
      summary: 'List catalog permissions',
      response: listResponse(PermissionSummary),
      tags: ['MOD-ACL Access Control'],
    },
    {
      method: 'get',
      path: '/v1/tenant',
      id: 'API-TEN-SELF',
      summary: "The caller's tenant",
      response: Tenant,
    },
    {
      method: 'get',
      path: '/v1/organisations',
      id: 'API-ORG-001',
      summary: 'Organisations of the tenant (config.manage)',
      response: listResponse(Organisation),
    },
    {
      method: 'get',
      path: '/v1/organisations/{id}',
      id: 'API-ORG-001-GET',
      summary: 'One organisation (config.manage)',
      response: Organisation,
    },
    {
      method: 'patch',
      path: '/v1/organisations/{id}',
      id: 'API-ORG-002',
      summary: 'Update the organisation profile (config.manage)',
      response: Organisation,
      body: OrganisationPatch,
      ifMatch: true,
    },
    {
      method: 'post',
      path: '/v1/branches',
      id: 'API-ORG-003',
      summary: 'Create a branch (config.manage)',
      response: Branch,
      status: 201,
      body: BranchCreate,
      idem: true,
    },
    {
      method: 'get',
      path: '/v1/branches',
      id: 'API-ORG-004',
      summary: 'List branches',
      response: BranchList,
      query: ListQuery,
    },
    {
      method: 'get',
      path: '/v1/branches/{id}',
      id: 'API-ORG-004-GET',
      summary: 'One branch',
      response: Branch,
    },
    {
      method: 'patch',
      path: '/v1/branches/{id}',
      id: 'API-ORG-005',
      summary: 'Update a branch (config.manage)',
      response: Branch,
      body: BranchPatch,
      ifMatch: true,
    },
    {
      method: 'post',
      path: '/v1/branches/{id}/deactivation',
      id: 'API-ORG-006',
      summary: 'Deactivate a branch and its queues (config.manage)',
      response: Branch,
      ifMatch: true,
    },
    {
      method: 'post',
      path: '/v1/teams',
      id: 'API-ORG-007',
      summary: 'Create a team (config.manage or user.manage; branch managers within their branch)',
      response: TeamDetail,
      status: 201,
      body: TeamCreate,
      idem: true,
    },
    {
      method: 'get',
      path: '/v1/teams',
      id: 'API-ORG-007-LIST',
      summary: 'List teams',
      response: TeamList,
      query: ListQuery,
    },
    {
      method: 'get',
      path: '/v1/teams/{id}',
      id: 'API-ORG-007-GET',
      summary: 'One team with its current members',
      response: TeamDetail,
    },
    {
      method: 'patch',
      path: '/v1/teams/{id}',
      id: 'API-ORG-008',
      summary: 'Update a team (config.manage or user.manage; branch managers within their branch)',
      response: TeamDetail,
      body: TeamPatch,
      ifMatch: true,
    },
    {
      method: 'put',
      path: '/v1/teams/{id}/members',
      id: 'API-ORG-009',
      summary: 'Replace the team members (user.manage; branch managers within their branch)',
      response: TeamDetail,
      body: TeamMembersPut,
      ifMatch: true,
    },
    {
      method: 'post',
      path: '/v1/work-queues',
      id: 'API-ORG-011',
      summary: 'Create a work queue (config.manage)',
      response: WorkQueueDetail,
      status: 201,
      body: WorkQueueCreate,
      idem: true,
    },
    {
      method: 'get',
      path: '/v1/work-queues',
      id: 'API-ORG-012',
      summary: 'List work queues',
      response: WorkQueueList,
      query: ListQuery,
    },
    {
      method: 'get',
      path: '/v1/work-queues/{id}',
      id: 'API-ORG-012-GET',
      summary: 'One work queue with its members',
      response: WorkQueueDetail,
    },
    {
      method: 'patch',
      path: '/v1/work-queues/{id}',
      id: 'API-ORG-013',
      summary: 'Update a work queue (config.manage)',
      response: WorkQueueDetail,
      body: WorkQueuePatch,
      ifMatch: true,
    },
    {
      method: 'put',
      path: '/v1/work-queues/{id}/members',
      id: 'API-ORG-014',
      summary: 'Replace the queue members (user.manage; branch managers within their branch)',
      response: WorkQueueDetail,
      body: WorkQueueMembersPut,
      ifMatch: true,
    },
  ];

  for (const op of ops) {
    const headers = [
      ...(op.idem ? [{ $ref: '#/components/parameters/IdempotencyKey' }] : []),
      ...(op.ifMatch ? [{ $ref: '#/components/parameters/IfMatch' }] : []),
    ];
    registry.registerPath({
      method: op.method,
      path: op.path,
      operationId: op.id,
      summary: op.summary,
      tags: op.tags ?? ['MOD-ORG Organisation'],
      ...(headers.length ? { parameters: headers } : {}),
      request: {
        ...(op.query ? { query: op.query as never } : {}),
        ...(op.body ? { body: { content: json(op.body) } } : {}),
      },
      responses: {
        [op.status ?? 200]: { description: 'OK', content: json(op.response) },
        401: { description: 'UNAUTHENTICATED or TOKEN_EXPIRED' },
        ...(op.method !== 'get'
          ? { 403: { description: 'FORBIDDEN' }, 422: { description: 'VALIDATION_ERROR' } }
          : {}),
        ...(op.ifMatch ? { 409: { description: 'VERSION_CONFLICT' } } : {}),
      },
    });
  }
}
