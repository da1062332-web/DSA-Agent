// OpenAPI registration for module platform (owner: Akash / Developer 2).
// tools/gen-openapi.ts writes openapi/openapi.yaml (never hand-edited; CI fails on a diff).
import {
  AssignRoleRequest,
  BranchConfigSummary,
  CreateBranchRequest,
  CreateRoleRequest,
  CreateUserRequest,
  ErrorEnvelope,
  ListMeta,
  PermissionSummary,
  RoleSummary,
  TenantConfigSummary,
  UpdateBranchRequest,
  UpdateRoleRequest,
  UpdateTenantConfigRequest,
  UpdateUserRequest,
  UserEffectiveGrants,
  UserRoleAssignmentSummary,
  UserSummary,
  listResponse,
} from '@dsa/contracts';
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';
import { z } from 'zod';
import {
  ListQuery,
  Organisation,
  OrganisationPatch,
  TeamCreate,
  TeamDetail,
  TeamList,
  TeamMembersPut,
  TeamPatch,
  Tenant,
  WorkQueueCreate,
  WorkQueueDetail,
  WorkQueueList,
  WorkQueueMembersPut,
  WorkQueuePatch,
} from './schemas';

export const tags = [
  { name: 'Platform', description: 'Platform identity and branch management' },
  { name: 'Access Control', description: 'Roles and permission grants' },
  { name: 'Users', description: 'User management' },
  { name: 'Configuration', description: 'Tenant configuration' },
];

export function registerOpenApi(registry: OpenAPIRegistry): void {
  // GET /v1/tenant
  registry.registerPath({
    method: 'get',
    path: '/v1/tenant',
    operationId: 'API-TEN-001',
    summary: 'Get current tenant details',
    tags: ['Platform'],
    responses: {
      200: {
        description: 'Current tenant details',
        content: {
          'application/json': {
            schema: Tenant,
          },
        },
      },
      401: {
        description: 'Unauthenticated',
        content: { 'application/json': { schema: ErrorEnvelope } },
      },
      404: {
        description: 'Tenant not found',
        content: { 'application/json': { schema: ErrorEnvelope } },
      },
    },
  });
  // GET /v1/me
  registry.registerPath({
    method: 'get',
    path: '/v1/me',
    operationId: 'API-ORG-000',
    summary: 'Get current authenticated user identity and permission grants',
    tags: ['Platform'],
    responses: {
      200: {
        description: 'Current user context',
        content: {
          'application/json': {
            schema: z.object({
              data: z.object({
                id: z.string(),
                kind: z.enum(['USER', 'SERVICE']),
                tenantId: z.string(),
                primaryBranchId: z.string().nullable(),
                grants: z.array(
                  z.object({
                    code: z.string(),
                    scope: z.enum(['OWN', 'TEAM', 'BRANCH', 'TENANT']),
                    branchIds: z.array(z.string()),
                  }),
                ),
                authTime: z.string().nullable(),
              }),
            }),
          },
        },
      },
      401: {
        description: 'Unauthenticated',
        content: { 'application/json': { schema: ErrorEnvelope } },
      },
    },
  });

  // GET /v1/branches
  registry.registerPath({
    method: 'get',
    path: '/v1/branches',
    operationId: 'API-ORG-004',
    summary: 'List branches in caller tenant',
    tags: ['Platform'],
    responses: {
      200: {
        description: 'List of branches',
        content: {
          'application/json': {
            schema: z.object({
              data: z.array(
                z.object({
                  id: z.string(),
                  organisationId: z.string(),
                  code: z.string(),
                  name: z.string(),
                  pincode: z.string().nullable(),
                  status: z.string(),
                }),
              ),
            }),
          },
        },
      },
    },
  });

  // GET /v1/roles
  registry.registerPath({
    method: 'get',
    path: '/v1/roles',
    operationId: 'API-ROL-001',
    summary: 'List roles and permissions in caller tenant',
    tags: ['Access Control'],
    responses: {
      200: {
        description: 'List of roles',
        content: {
          'application/json': {
            schema: z.object({
              data: z.array(RoleSummary),
            }),
          },
        },
      },
    },
  });

  // GET /v1/permissions
  registry.registerPath({
    method: 'get',
    path: '/v1/permissions',
    operationId: 'API-ROL-002',
    summary: 'List permission catalog',
    tags: ['Access Control'],
    responses: {
      200: {
        description: 'List of catalog permissions',
        content: {
          'application/json': {
            schema: z.object({
              data: z.array(PermissionSummary),
            }),
          },
        },
      },
      401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
      403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  });

  // GET /v1/roles/{id}
  registry.registerPath({
    method: 'get',
    path: '/v1/roles/{id}',
    operationId: 'API-ROL-003',
    summary: 'Get role details by ID',
    tags: ['Access Control'],
    request: {
      params: z.object({ id: z.string() }),
    },
    responses: {
      200: {
        description: 'Role details with permissions',
        content: {
          'application/json': {
            schema: RoleSummary,
          },
        },
      },
      401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
      403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorEnvelope } } },
      404: { description: 'Role not found', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  });

  // POST /v1/roles
  registry.registerPath({
    method: 'post',
    path: '/v1/roles',
    operationId: 'API-ROL-004',
    summary: 'Create custom role',
    tags: ['Access Control'],
    request: {
      body: {
        content: {
          'application/json': {
            schema: CreateRoleRequest,
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Created role',
        content: {
          'application/json': {
            schema: RoleSummary,
          },
        },
      },
      400: { description: 'Validation error', content: { 'application/json': { schema: ErrorEnvelope } } },
      401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
      403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  });

  // PATCH /v1/roles/{id}
  registry.registerPath({
    method: 'patch',
    path: '/v1/roles/{id}',
    operationId: 'API-ROL-005',
    summary: 'Update role name or permissions',
    tags: ['Access Control'],
    request: {
      params: z.object({ id: z.string() }),
      body: {
        content: {
          'application/json': {
            schema: UpdateRoleRequest,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Updated role',
        content: {
          'application/json': {
            schema: RoleSummary,
          },
        },
      },
      400: { description: 'Validation error', content: { 'application/json': { schema: ErrorEnvelope } } },
      401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
      403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorEnvelope } } },
      404: { description: 'Role not found', content: { 'application/json': { schema: ErrorEnvelope } } },
      409: { description: 'Version conflict', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  });

  // DELETE /v1/roles/{id}
  registry.registerPath({
    method: 'delete',
    path: '/v1/roles/{id}',
    operationId: 'API-ROL-006',
    summary: 'Delete custom role',
    tags: ['Access Control'],
    request: {
      params: z.object({ id: z.string() }),
    },
    responses: {
      200: {
        description: 'Role deleted',
        content: {
          'application/json': {
            schema: z.object({ status: z.literal('ok') }),
          },
        },
      },
      400: { description: 'Validation error', content: { 'application/json': { schema: ErrorEnvelope } } },
      401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
      403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorEnvelope } } },
      404: { description: 'Role not found', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  });

  // GET /v1/users
  registry.registerPath({
    method: 'get',
    path: '/v1/users',
    operationId: 'API-USR-001',
    summary: 'List users in caller tenant with pagination and search',
    tags: ['Users'],
    request: {
      query: z.object({
        limit: z.coerce.number().int().min(1).max(200).optional(),
        cursor: z.string().optional(),
        status: z.enum(['INVITED', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED']).optional(),
        search: z.string().optional(),
      }),
    },
    responses: {
      200: {
        description: 'Paginated user list',
        content: {
          'application/json': {
            schema: z.object({
              data: z.array(UserSummary),
              meta: ListMeta,
            }),
          },
        },
      },
      401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
      403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  });

  // GET /v1/users/{id}
  registry.registerPath({
    method: 'get',
    path: '/v1/users/{id}',
    operationId: 'API-USR-002',
    summary: 'Get details of a specific user',
    tags: ['Users'],
    request: {
      params: z.object({ id: z.string() }),
    },
    responses: {
      200: {
        description: 'User details',
        headers: {
          ETag: { schema: { type: 'string' }, description: 'User lock_version' },
        },
        content: {
          'application/json': {
            schema: UserSummary,
          },
        },
      },
      404: { description: 'User not found', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  });

  // POST /v1/users
  registry.registerPath({
    method: 'post',
    path: '/v1/users',
    operationId: 'API-USR-003',
    summary: 'Create a new staff user',
    tags: ['Users'],
    request: {
      body: {
        content: {
          'application/json': {
            schema: CreateUserRequest,
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Created user',
        content: {
          'application/json': {
            schema: UserSummary,
          },
        },
      },
      422: { description: 'Validation error', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  });

  // PATCH /v1/users/{id}
  registry.registerPath({
    method: 'patch',
    path: '/v1/users/{id}',
    operationId: 'API-USR-004',
    summary: 'Update user profile, status, or branch',
    tags: ['Users'],
    request: {
      params: z.object({ id: z.string() }),
      body: {
        content: {
          'application/json': {
            schema: UpdateUserRequest,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Updated user',
        content: {
          'application/json': {
            schema: UserSummary,
          },
        },
      },
      404: { description: 'User not found', content: { 'application/json': { schema: ErrorEnvelope } } },
      409: { description: 'Version conflict', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  });

  // POST /v1/users/{id}/roles
  registry.registerPath({
    method: 'post',
    path: '/v1/users/{id}/roles',
    operationId: 'API-USR-005',
    summary: 'Assign a role to a user (SOD-05)',
    tags: ['Users'],
    request: {
      params: z.object({ id: z.string() }),
      body: {
        content: {
          'application/json': {
            schema: AssignRoleRequest,
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Role assigned',
        content: {
          'application/json': {
            schema: z.object({
              id: z.string(),
              alreadyAssigned: z.boolean(),
            }),
          },
        },
      },
      403: { description: 'SOD violation', content: { 'application/json': { schema: ErrorEnvelope } } },
      404: {
        description: 'User or role not found',
        content: { 'application/json': { schema: ErrorEnvelope } },
      },
    },
  });

  // DELETE /v1/users/{id}/roles/{roleId}
  registry.registerPath({
    method: 'delete',
    path: '/v1/users/{id}/roles/{roleId}',
    operationId: 'API-USR-006',
    summary: 'Remove a role assignment from a user (SOD-05)',
    tags: ['Users'],
    request: {
      params: z.object({ id: z.string(), roleId: z.string() }),
    },
    responses: {
      200: {
        description: 'Role removed',
        content: {
          'application/json': {
            schema: z.object({ status: z.literal('ok') }),
          },
        },
      },
      403: { description: 'SOD violation', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  });

  // GET /v1/users/{id}/roles
  registry.registerPath({
    method: 'get',
    path: '/v1/users/{id}/roles',
    operationId: 'API-USR-007',
    summary: 'List role assignments for user',
    tags: ['Access Control'],
    request: {
      params: z.object({ id: z.string() }),
    },
    responses: {
      200: {
        description: 'User role assignments',
        content: {
          'application/json': {
            schema: z.object({
              data: z.array(UserRoleAssignmentSummary),
            }),
          },
        },
      },
      401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
      403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorEnvelope } } },
      404: { description: 'User not found', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  });

  // GET /v1/users/{id}/permissions
  registry.registerPath({
    method: 'get',
    path: '/v1/users/{id}/permissions',
    operationId: 'API-USR-008',
    summary: 'Get effective permissions for user',
    tags: ['Access Control'],
    request: {
      params: z.object({ id: z.string() }),
    },
    responses: {
      200: {
        description: 'User effective permissions',
        content: {
          'application/json': {
            schema: UserEffectiveGrants,
          },
        },
      },
      401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
      403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorEnvelope } } },
      404: { description: 'User not found', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  });

  // GET /v1/branches/{id}
  registry.registerPath({
    method: 'get',
    path: '/v1/branches/{id}',
    operationId: 'API-ORG-005a',
    summary: 'Get branch details by ID',
    tags: ['Platform'],
    request: {
      params: z.object({ id: z.string() }),
    },
    responses: {
      200: {
        description: 'Branch details',
        content: {
          'application/json': {
            schema: BranchConfigSummary,
          },
        },
      },
      401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
      404: { description: 'Branch not found', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  });

  // POST /v1/branches
  registry.registerPath({
    method: 'post',
    path: '/v1/branches',
    operationId: 'API-ORG-003',
    summary: 'Create a new branch in tenant',
    tags: ['Platform'],
    request: {
      body: {
        content: {
          'application/json': {
            schema: CreateBranchRequest,
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Branch created',
        content: {
          'application/json': {
            schema: BranchConfigSummary,
          },
        },
      },
      401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
      403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorEnvelope } } },
      422: { description: 'Validation error', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  });

  // PATCH /v1/branches/{id}
  registry.registerPath({
    method: 'patch',
    path: '/v1/branches/{id}',
    operationId: 'API-ORG-005',
    summary: 'Update branch configuration',
    tags: ['Platform'],
    request: {
      params: z.object({ id: z.string() }),
      body: {
        content: {
          'application/json': {
            schema: UpdateBranchRequest,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Branch updated',
        content: {
          'application/json': {
            schema: BranchConfigSummary,
          },
        },
      },
      401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
      403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorEnvelope } } },
      404: { description: 'Branch not found', content: { 'application/json': { schema: ErrorEnvelope } } },
      409: { description: 'Version conflict', content: { 'application/json': { schema: ErrorEnvelope } } },
      422: { description: 'Validation error', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  });

  // GET /v1/config
  registry.registerPath({
    method: 'get',
    path: '/v1/config',
    operationId: 'API-CFG-001',
    summary: 'Get tenant and organisation configuration summary',
    tags: ['Configuration'],
    responses: {
      200: {
        description: 'Tenant configuration summary',
        content: {
          'application/json': {
            schema: TenantConfigSummary,
          },
        },
      },
      401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
      403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorEnvelope } } },
      404: { description: 'Config not found', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  });

  // PATCH /v1/config
  registry.registerPath({
    method: 'patch',
    path: '/v1/config',
    operationId: 'API-CFG-002',
    summary: 'Update tenant and organisation configuration',
    tags: ['Configuration'],
    request: {
      body: {
        content: {
          'application/json': {
            schema: UpdateTenantConfigRequest,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Tenant configuration updated',
        content: {
          'application/json': {
            schema: TenantConfigSummary,
          },
        },
      },
      401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
      403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorEnvelope } } },
      409: { description: 'Version conflict', content: { 'application/json': { schema: ErrorEnvelope } } },
      422: { description: 'Validation error', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  });

  // GET /v1/organisations
  registry.registerPath({
    method: 'get',
    path: '/v1/organisations',
    operationId: 'API-ORG-001',
    summary: 'List organisations of the tenant',
    tags: ['Platform'],
    responses: {
      200: {
        description: 'Organisation list',
        content: { 'application/json': { schema: listResponse(Organisation) } },
      },
      401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
      403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  });

  // GET /v1/organisations/{id}
  registry.registerPath({
    method: 'get',
    path: '/v1/organisations/{id}',
    operationId: 'API-ORG-001-GET',
    summary: 'Get organisation details by ID',
    tags: ['Platform'],
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: {
        description: 'Organisation details',
        content: { 'application/json': { schema: Organisation } },
      },
      401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
      403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorEnvelope } } },
      404: { description: 'Organisation not found', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  });

  // PATCH /v1/organisations/{id}
  registry.registerPath({
    method: 'patch',
    path: '/v1/organisations/{id}',
    operationId: 'API-ORG-002',
    summary: 'Update organisation profile',
    tags: ['Platform'],
    request: {
      params: z.object({ id: z.string() }),
      body: { content: { 'application/json': { schema: OrganisationPatch } } },
    },
    responses: {
      200: {
        description: 'Organisation updated',
        content: { 'application/json': { schema: Organisation } },
      },
      401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
      403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorEnvelope } } },
      404: { description: 'Organisation not found', content: { 'application/json': { schema: ErrorEnvelope } } },
      409: { description: 'Version conflict', content: { 'application/json': { schema: ErrorEnvelope } } },
      422: { description: 'Validation error', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  });

  // GET /v1/teams
  registry.registerPath({
    method: 'get',
    path: '/v1/teams',
    operationId: 'API-ORG-007-LIST',
    summary: 'List teams',
    tags: ['Platform'],
    request: { query: ListQuery },
    responses: {
      200: {
        description: 'Team list',
        content: { 'application/json': { schema: TeamList } },
      },
      401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  });

  // GET /v1/teams/{id}
  registry.registerPath({
    method: 'get',
    path: '/v1/teams/{id}',
    operationId: 'API-ORG-007-GET',
    summary: 'Get team details by ID',
    tags: ['Platform'],
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: {
        description: 'Team details with members',
        content: { 'application/json': { schema: TeamDetail } },
      },
      401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
      404: { description: 'Team not found', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  });

  // POST /v1/teams
  registry.registerPath({
    method: 'post',
    path: '/v1/teams',
    operationId: 'API-ORG-007',
    summary: 'Create a team',
    tags: ['Platform'],
    request: {
      body: { content: { 'application/json': { schema: TeamCreate } } },
    },
    responses: {
      201: {
        description: 'Team created',
        content: { 'application/json': { schema: TeamDetail } },
      },
      401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
      403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorEnvelope } } },
      422: { description: 'Validation error', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  });

  // PATCH /v1/teams/{id}
  registry.registerPath({
    method: 'patch',
    path: '/v1/teams/{id}',
    operationId: 'API-ORG-008',
    summary: 'Update team details',
    tags: ['Platform'],
    request: {
      params: z.object({ id: z.string() }),
      body: { content: { 'application/json': { schema: TeamPatch } } },
    },
    responses: {
      200: {
        description: 'Team updated',
        content: { 'application/json': { schema: TeamDetail } },
      },
      401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
      403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorEnvelope } } },
      404: { description: 'Team not found', content: { 'application/json': { schema: ErrorEnvelope } } },
      409: { description: 'Version conflict', content: { 'application/json': { schema: ErrorEnvelope } } },
      422: { description: 'Validation error', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  });

  // PUT /v1/teams/{id}/members
  registry.registerPath({
    method: 'put',
    path: '/v1/teams/{id}/members',
    operationId: 'API-ORG-009',
    summary: 'Replace team members',
    tags: ['Platform'],
    request: {
      params: z.object({ id: z.string() }),
      body: { content: { 'application/json': { schema: TeamMembersPut } } },
    },
    responses: {
      200: {
        description: 'Team members replaced',
        content: { 'application/json': { schema: TeamDetail } },
      },
      401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
      403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorEnvelope } } },
      404: { description: 'Team not found', content: { 'application/json': { schema: ErrorEnvelope } } },
      409: { description: 'Version conflict', content: { 'application/json': { schema: ErrorEnvelope } } },
      422: { description: 'Validation error', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  });

  // GET /v1/work-queues
  registry.registerPath({
    method: 'get',
    path: '/v1/work-queues',
    operationId: 'API-ORG-012',
    summary: 'List work queues',
    tags: ['Platform'],
    request: { query: ListQuery },
    responses: {
      200: {
        description: 'Work queue list',
        content: { 'application/json': { schema: WorkQueueList } },
      },
      401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  });

  // GET /v1/work-queues/{id}
  registry.registerPath({
    method: 'get',
    path: '/v1/work-queues/{id}',
    operationId: 'API-ORG-012-GET',
    summary: 'Get work queue details by ID',
    tags: ['Platform'],
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: {
        description: 'Work queue details with members',
        content: { 'application/json': { schema: WorkQueueDetail } },
      },
      401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
      404: { description: 'Work queue not found', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  });

  // POST /v1/work-queues
  registry.registerPath({
    method: 'post',
    path: '/v1/work-queues',
    operationId: 'API-ORG-011',
    summary: 'Create a work queue',
    tags: ['Platform'],
    request: {
      body: { content: { 'application/json': { schema: WorkQueueCreate } } },
    },
    responses: {
      201: {
        description: 'Work queue created',
        content: { 'application/json': { schema: WorkQueueDetail } },
      },
      401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
      403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorEnvelope } } },
      422: { description: 'Validation error', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  });

  // PATCH /v1/work-queues/{id}
  registry.registerPath({
    method: 'patch',
    path: '/v1/work-queues/{id}',
    operationId: 'API-ORG-013',
    summary: 'Update work queue details',
    tags: ['Platform'],
    request: {
      params: z.object({ id: z.string() }),
      body: { content: { 'application/json': { schema: WorkQueuePatch } } },
    },
    responses: {
      200: {
        description: 'Work queue updated',
        content: { 'application/json': { schema: WorkQueueDetail } },
      },
      401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
      403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorEnvelope } } },
      404: { description: 'Work queue not found', content: { 'application/json': { schema: ErrorEnvelope } } },
      409: { description: 'Version conflict', content: { 'application/json': { schema: ErrorEnvelope } } },
      422: { description: 'Validation error', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  });

  // PUT /v1/work-queues/{id}/members
  registry.registerPath({
    method: 'put',
    path: '/v1/work-queues/{id}/members',
    operationId: 'API-ORG-014',
    summary: 'Replace work queue members',
    tags: ['Platform'],
    request: {
      params: z.object({ id: z.string() }),
      body: { content: { 'application/json': { schema: WorkQueueMembersPut } } },
    },
    responses: {
      200: {
        description: 'Work queue members replaced',
        content: { 'application/json': { schema: WorkQueueDetail } },
      },
      401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
      403: { description: 'Forbidden', content: { 'application/json': { schema: ErrorEnvelope } } },
      404: { description: 'Work queue not found', content: { 'application/json': { schema: ErrorEnvelope } } },
      409: { description: 'Version conflict', content: { 'application/json': { schema: ErrorEnvelope } } },
      422: { description: 'Validation error', content: { 'application/json': { schema: ErrorEnvelope } } },
    },
  });
}
