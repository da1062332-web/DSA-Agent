// OpenAPI registration for module platform (owner: see router.ts). Register this module's paths with zod schemas;
// tools/gen-openapi.ts writes openapi/openapi.yaml (never hand-edited; CI fails on a diff).
import { listResponse } from '@dsa/contracts';
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';
import type { ZodTypeAny } from 'zod';
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

type Method = 'get' | 'post' | 'patch' | 'put';

/** Swagger groups, one per module area (DSA Notion: MOD-USR, MOD-TEN, MOD-ORG). Order = order in Swagger UI. */
export const tags = [
  { name: 'MOD-USR Users', description: 'The signed-in user and the user picker list (MOD-USR, PA-01).' },
  { name: 'MOD-TEN Tenant', description: "The caller's tenant (MOD-TEN, read only in the MVP)." },
  {
    name: 'MOD-ORG Organisation profile',
    description: 'Legal entity of the tenant (SUB-ORG.01). config.manage.',
  },
  { name: 'MOD-ORG Branches', description: 'Branches and their status (SUB-ORG.02).' },
  { name: 'MOD-ORG Teams', description: 'Teams, managers and effective-dated members (SUB-ORG.03).' },
  {
    name: 'MOD-ORG Work queues',
    description: 'Intake, unassigned and team queues with round-robin members (SUB-ORG.05).',
  },
];

/** Each path belongs to exactly one tag, so a path never shows up under two modules. */
export function tagFor(path: string): string {
  if (path === '/v1/me' || path === '/v1/users') return 'MOD-USR Users';
  if (path === '/v1/tenant') return 'MOD-TEN Tenant';
  if (path.startsWith('/v1/organisations')) return 'MOD-ORG Organisation profile';
  if (path.startsWith('/v1/branches')) return 'MOD-ORG Branches';
  if (path.startsWith('/v1/teams')) return 'MOD-ORG Teams';
  if (path.startsWith('/v1/work-queues')) return 'MOD-ORG Work queues';
  throw new Error(`no Swagger tag for ${path}`);
}
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
    },
    {
      method: 'get',
      path: '/v1/users',
      id: 'API-USR-LIST',
      summary: 'Users of the tenant (no contact data)',
      response: UserList,
      query: UserListQuery,
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
      tags: [tagFor(op.path)],
      operationId: op.id,
      summary: op.summary,
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
