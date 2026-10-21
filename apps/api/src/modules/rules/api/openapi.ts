// apps/api/src/modules/rules/api/openapi.ts — owner: Developer 6 & 2 (Module 23: Business Rule Engine)
import {
  CreateRuleSetRequestSchema,
  CreateRuleSetVersionRequestSchema,
  CreateSimulationRequestSchema,
  CreateTestCaseRequestSchema,
  DecisionDefinitionResponseSchema,
  DecisionEvaluationResponseSchema,
  DecisionRecordListResponseSchema,
  DecisionRecordResponseSchema,
  EvaluateDecisionRequestSchema,
  ImpactAnalysisRequestSchema,
  ImpactAnalysisResponseSchema,
  PublishVersionRequestSchema,
  ReinstateVersionRequestSchema,
  RetireVersionRequestSchema,
  ReviewVersionRequestSchema,
  RollbackRequestSchema,
  RuleSetListResponseSchema,
  RuleSetResponseSchema,
  RuleSetVersionResponseSchema,
  SimulationResponseSchema,
  SubmitVersionRequestSchema,
  SuspendVersionRequestSchema,
  TestCaseResponseSchema,
  UpdateRuleSetVersionRequestSchema,
  UpdateTestCaseRequestSchema,
  ValidationReportResponseSchema,
  VersionComparisonRequestSchema,
  VersionComparisonResponseSchema,
} from '@dsa/contracts';
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';
import { registerOperation } from '../../../http/openapi-op';
import { ReferenceListVersionCreate } from './reference-lists';
import { z } from 'zod';

export const tags = [
  {
    name: 'MOD-BRE Rules',
    description: 'Business Rule Engine, decision definitions, authoring, and lifecycle (MOD-BRE).',
  },
];

export function registerOpenApi(registry: OpenAPIRegistry): void {
  const TAG = 'MOD-BRE Rules';

  registry.registerPath({
    method: 'get',
    path: '/v1/decision-definitions',
    operationId: 'API-BRE-001',
    summary: 'List supported decision definitions and schemas',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'List of decision definitions',
        content: {
          'application/json': { schema: z.object({ data: z.array(DecisionDefinitionResponseSchema) }) },
        },
      },
      401: { description: 'Unauthenticated' },
      403: { description: 'Forbidden' },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/decision-definitions/{key}',
    operationId: 'API-BRE-002',
    summary: 'Get decision definition by key',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ key: z.string() }),
    },
    responses: {
      200: {
        description: 'Decision definition details',
        content: { 'application/json': { schema: DecisionDefinitionResponseSchema } },
      },
      401: { description: 'Unauthenticated' },
      404: { description: 'Decision definition not found' },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/rule-sets',
    operationId: 'API-BRE-003',
    summary: 'Create a new rule set with initial draft version',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      body: { content: { 'application/json': { schema: CreateRuleSetRequestSchema } } },
    },
    responses: {
      201: {
        description: 'Rule set created',
        content: { 'application/json': { schema: RuleSetResponseSchema } },
      },
      400: { description: 'Validation error' },
      401: { description: 'Unauthenticated' },
      403: { description: 'Forbidden' },
      409: { description: 'Rule set already exists' },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/rule-sets',
    operationId: 'API-BRE-004',
    summary: 'List rule sets with filtering',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      query: z.object({
        decisionKey: z.string().optional(),
        scopeType: z.string().optional(),
        status: z.string().optional(),
        ownerUserId: z.string().optional(),
        limit: z.coerce.number().optional(),
        cursor: z.string().optional(),
      }),
    },
    responses: {
      200: {
        description: 'Page of rule sets',
        content: { 'application/json': { schema: RuleSetListResponseSchema } },
      },
      401: { description: 'Unauthenticated' },
      403: { description: 'Forbidden' },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/rule-sets/{ruleSetId}',
    operationId: 'API-BRE-005',
    summary: 'Get rule set details',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ ruleSetId: z.string() }),
    },
    responses: {
      200: {
        description: 'Rule set details',
        content: { 'application/json': { schema: RuleSetResponseSchema } },
      },
      401: { description: 'Unauthenticated' },
      404: { description: 'Rule set not found' },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/rule-sets/{ruleSetId}/versions',
    operationId: 'API-BRE-006',
    summary: 'List versions of a rule set',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ ruleSetId: z.string() }),
    },
    responses: {
      200: {
        description: 'List of rule set versions',
        content: {
          'application/json': { schema: z.object({ data: z.array(RuleSetVersionResponseSchema) }) },
        },
      },
      401: { description: 'Unauthenticated' },
      404: { description: 'Rule set not found' },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/rule-sets/{ruleSetId}/versions',
    operationId: 'API-BRE-007',
    summary: 'Create a new draft version for a rule set',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ ruleSetId: z.string() }),
      body: { content: { 'application/json': { schema: CreateRuleSetVersionRequestSchema } } },
    },
    responses: {
      201: {
        description: 'Draft version created',
        content: { 'application/json': { schema: RuleSetVersionResponseSchema } },
      },
      401: { description: 'Unauthenticated' },
      403: { description: 'Forbidden' },
      409: { description: 'Draft limit reached' },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/rule-set-versions/{versionId}',
    operationId: 'API-BRE-008',
    summary: 'Get rule set version details and definition',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ versionId: z.string() }),
    },
    responses: {
      200: {
        description: 'Version details and AST definition',
        content: { 'application/json': { schema: RuleSetVersionResponseSchema } },
      },
      401: { description: 'Unauthenticated' },
      404: { description: 'Version not found' },
    },
  });

  registry.registerPath({
    method: 'put',
    path: '/v1/rule-set-versions/{versionId}',
    operationId: 'API-BRE-009',
    summary: 'Update draft rule set definition with optimistic concurrency',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ versionId: z.string() }),
      headers: z.object({ 'if-match': z.string() }),
      body: { content: { 'application/json': { schema: UpdateRuleSetVersionRequestSchema } } },
    },
    responses: {
      200: {
        description: 'Draft version updated',
        content: { 'application/json': { schema: RuleSetVersionResponseSchema } },
      },
      400: { description: 'Validation error / If-Match required' },
      401: { description: 'Unauthenticated' },
      403: { description: 'Forbidden' },
      409: { description: 'Version conflict or non-DRAFT version' },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/rule-set-versions/{versionId}/validate',
    operationId: 'API-BRE-010',
    summary: 'Validate rule definition against schemas, operators, and conflicts',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ versionId: z.string() }),
    },
    responses: {
      200: {
        description: 'Validation report',
        content: { 'application/json': { schema: ValidationReportResponseSchema } },
      },
      401: { description: 'Unauthenticated' },
      404: { description: 'Version not found' },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/rule-set-versions/{versionId}/simulations',
    operationId: 'API-BRE-011',
    summary: 'Simulate rule evaluation against synthetic inputs',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ versionId: z.string() }),
      body: { content: { 'application/json': { schema: CreateSimulationRequestSchema } } },
    },
    responses: {
      201: {
        description: 'Simulation completed',
        content: { 'application/json': { schema: SimulationResponseSchema } },
      },
      401: { description: 'Unauthenticated' },
      403: { description: 'Forbidden' },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/rule-simulations/{simulationId}',
    operationId: 'API-BRE-012',
    summary: 'Get simulation results and trace',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ simulationId: z.string() }),
    },
    responses: {
      200: {
        description: 'Simulation result',
        content: { 'application/json': { schema: SimulationResponseSchema } },
      },
      401: { description: 'Unauthenticated' },
      404: { description: 'Simulation not found' },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/rule-sets/{ruleSetId}/comparisons',
    operationId: 'API-BRE-013',
    summary: 'Compare two rule versions and diff evaluation outputs',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ ruleSetId: z.string() }),
      body: { content: { 'application/json': { schema: VersionComparisonRequestSchema } } },
    },
    responses: {
      200: {
        description: 'Comparison diff and sample evaluation report',
        content: { 'application/json': { schema: VersionComparisonResponseSchema } },
      },
      401: { description: 'Unauthenticated' },
      404: { description: 'Version not found' },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/rule-set-versions/{versionId}/impact-analyses',
    operationId: 'API-BRE-014',
    summary: 'Execute impact analysis and test suite execution summary',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ versionId: z.string() }),
      body: { content: { 'application/json': { schema: ImpactAnalysisRequestSchema } } },
    },
    responses: {
      200: {
        description: 'Impact analysis report',
        content: { 'application/json': { schema: ImpactAnalysisResponseSchema } },
      },
      401: { description: 'Unauthenticated' },
      404: { description: 'Version not found' },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/rule-sets/{ruleSetId}/test-cases',
    operationId: 'API-BRE-015',
    summary: 'List synthetic test cases for rule set',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ ruleSetId: z.string() }),
    },
    responses: {
      200: {
        description: 'List of test cases',
        content: {
          'application/json': { schema: z.object({ data: z.array(TestCaseResponseSchema) }) },
        },
      },
      401: { description: 'Unauthenticated' },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/rule-sets/{ruleSetId}/test-cases',
    operationId: 'API-BRE-016',
    summary: 'Create test case for rule set',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ ruleSetId: z.string() }),
      body: { content: { 'application/json': { schema: CreateTestCaseRequestSchema } } },
    },
    responses: {
      201: {
        description: 'Test case created',
        content: { 'application/json': { schema: TestCaseResponseSchema } },
      },
      401: { description: 'Unauthenticated' },
      403: { description: 'Forbidden' },
    },
  });

  registry.registerPath({
    method: 'put',
    path: '/v1/rule-test-cases/{testCaseId}',
    operationId: 'API-BRE-017',
    summary: 'Update test case',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ testCaseId: z.string() }),
      headers: z.object({ 'if-match': z.string() }),
      body: { content: { 'application/json': { schema: UpdateTestCaseRequestSchema } } },
    },
    responses: {
      200: {
        description: 'Test case updated',
        content: { 'application/json': { schema: TestCaseResponseSchema } },
      },
      401: { description: 'Unauthenticated' },
      404: { description: 'Test case not found' },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/rule-set-versions/{versionId}/submit',
    operationId: 'API-BRE-018',
    summary: 'Submit rule version for review',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ versionId: z.string() }),
      body: { content: { 'application/json': { schema: SubmitVersionRequestSchema } } },
    },
    responses: {
      200: {
        description: 'Version transitioned to IN_REVIEW',
        content: { 'application/json': { schema: RuleSetVersionResponseSchema } },
      },
      401: { description: 'Unauthenticated' },
      409: { description: 'Invalid transition' },
      422: { description: 'Validation evidence missing or stale' },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/rule-set-versions/{versionId}/reviews',
    operationId: 'API-BRE-019',
    summary: 'Submit maker-checker review decision (Approve / Reject / Changes)',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ versionId: z.string() }),
      body: { content: { 'application/json': { schema: ReviewVersionRequestSchema } } },
    },
    responses: {
      200: {
        description: 'Review decision recorded',
        content: { 'application/json': { schema: RuleSetVersionResponseSchema } },
      },
      401: { description: 'Unauthenticated or step-up required' },
      403: { description: 'SOD-01 Maker-checker violation' },
      409: { description: 'Hash mismatch or invalid state' },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/rule-set-versions/{versionId}/publish',
    operationId: 'API-BRE-020',
    summary: 'Publish approved rule version to ACTIVE or SCHEDULED',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ versionId: z.string() }),
      body: { content: { 'application/json': { schema: PublishVersionRequestSchema } } },
    },
    responses: {
      200: {
        description: 'Version published',
        content: { 'application/json': { schema: RuleSetVersionResponseSchema } },
      },
      401: { description: 'Unauthenticated or step-up required' },
      409: { description: 'Effective range conflict or invalid state' },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/rule-set-versions/{versionId}/suspend',
    operationId: 'API-BRE-021',
    summary: 'Emergency suspend an active rule set version',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ versionId: z.string() }),
      body: { content: { 'application/json': { schema: SuspendVersionRequestSchema } } },
    },
    responses: {
      200: {
        description: 'Version suspended',
        content: { 'application/json': { schema: RuleSetVersionResponseSchema } },
      },
      401: { description: 'Unauthenticated or step-up required' },
      409: { description: 'Invalid transition' },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/rule-set-versions/{versionId}/reinstate',
    operationId: 'API-BRE-022',
    summary: 'Reinstate a suspended rule set version to ACTIVE',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ versionId: z.string() }),
      body: { content: { 'application/json': { schema: ReinstateVersionRequestSchema } } },
    },
    responses: {
      200: {
        description: 'Version reinstated',
        content: { 'application/json': { schema: RuleSetVersionResponseSchema } },
      },
      401: { description: 'Unauthenticated or step-up required' },
      403: { description: 'Separation of duties violation' },
      409: { description: 'Invalid transition' },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/rule-set-versions/{versionId}/retire',
    operationId: 'API-BRE-023',
    summary: 'Retire rule set version',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ versionId: z.string() }),
      body: { content: { 'application/json': { schema: RetireVersionRequestSchema } } },
    },
    responses: {
      200: {
        description: 'Version retired',
        content: { 'application/json': { schema: RuleSetVersionResponseSchema } },
      },
      401: { description: 'Unauthenticated' },
      409: { description: 'Invalid transition' },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/rule-sets/{ruleSetId}/rollbacks',
    operationId: 'API-BRE-024',
    summary: 'Rollback rule set to a previously active version',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ ruleSetId: z.string() }),
      body: { content: { 'application/json': { schema: RollbackRequestSchema } } },
    },
    responses: {
      200: {
        description: 'Rule set rolled back',
        content: { 'application/json': { schema: RuleSetVersionResponseSchema } },
      },
      401: { description: 'Unauthenticated or step-up required' },
      409: { description: 'Target version not eligible' },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/decisions/{decisionKey}/evaluations',
    operationId: 'API-BRE-025',
    summary: 'Evaluate decision against facts (live or simulation mode)',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ decisionKey: z.string() }),
      headers: z.object({ 'idempotency-key': z.string().optional() }),
      body: { content: { 'application/json': { schema: EvaluateDecisionRequestSchema } } },
    },
    responses: {
      200: {
        description: 'Decision evaluation result',
        content: { 'application/json': { schema: DecisionEvaluationResponseSchema } },
      },
      400: { description: 'Validation error' },
      401: { description: 'Unauthenticated' },
      404: { description: 'Decision key unknown' },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/decision-records',
    operationId: 'API-BRE-026',
    summary: 'List decision execution records with filtering',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      query: z.object({
        decisionKey: z.string().optional(),
        subjectType: z.string().optional(),
        subjectId: z.string().optional(),
        ruleSetVersionId: z.string().optional(),
        status: z.string().optional(),
        limit: z.coerce.number().optional(),
        cursor: z.string().optional(),
      }),
    },
    responses: {
      200: {
        description: 'Page of decision records',
        content: { 'application/json': { schema: DecisionRecordListResponseSchema } },
      },
      401: { description: 'Unauthenticated' },
      403: { description: 'Forbidden' },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/decision-records/{id}',
    operationId: 'API-BRE-027',
    summary: 'Get decision record details and execution trace',
    tags: [TAG],
    security: [{ bearerAuth: [] }],
    request: {
      params: z.object({ id: z.string() }),
    },
    responses: {
      200: {
        description: 'Decision record details',
        content: { 'application/json': { schema: DecisionRecordResponseSchema } },
      },
      401: { description: 'Unauthenticated' },
      404: { description: 'Decision record not found' },
    },
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/reference-lists',
    operationId: 'API-BRE-028',
    summary: 'Reference lists and their versions (rule.author)',
    tag: 'MOD-BRE Rules',
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/reference-lists/:listId/versions',
    operationId: 'API-BRE-029',
    summary:
      'Publish the next version of a list (a new list: its code in the path, name and valueType in the body); up to 1,000 typed values (config.manage)',
    tag: 'MOD-BRE Rules',
    body: ReferenceListVersionCreate,
    status: 201,
    idempotent: true,
  });
}
