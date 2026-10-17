// packages/contracts/src/rules.ts — owner: Developer 2 & 6 (Module 23: Business Rule Engine)
import { z } from 'zod';
import { IdSchema } from './ids';

export const DECISION_KEYS = [
  'DK-lead.duplicate',
  'DK-customer.duplicate',
  'DK-lead.assignment',
  'DK-sla.target',
  'DK-document.requirements',
  'DK-application.completeness',
  'DK-application.eligibility',
] as const;

export const DECISION_TIERS = ['T1', 'T2', 'T3'] as const;
export type DecisionTier = (typeof DECISION_TIERS)[number];

export const HIT_POLICIES = ['UNIQUE', 'FIRST', 'PRIORITY', 'COLLECT', 'RULE_ORDER'] as const;
export type HitPolicy = (typeof HIT_POLICIES)[number];

export const AGGREGATORS = ['SUM', 'MIN', 'MAX', 'COUNT'] as const;
export type Aggregator = (typeof AGGREGATORS)[number];

export const RULE_SCOPE_TYPES = ['TENANT_DEFAULT', 'BRANCH', 'LENDER', 'PRODUCT_VERSION'] as const;
export type RuleScopeType = (typeof RULE_SCOPE_TYPES)[number];

export const RULE_SET_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;
export type RuleSetStatus = (typeof RULE_SET_STATUSES)[number];

export const RULE_SET_VERSION_STATUSES = [
  'DRAFT',
  'IN_REVIEW',
  'APPROVED',
  'SCHEDULED',
  'ACTIVE',
  'SUSPENDED',
  'SUPERSEDED',
  'RETIRED',
  'REJECTED',
  'ABANDONED',
] as const;
export type RuleSetVersionStatus = (typeof RULE_SET_VERSION_STATUSES)[number];

export const FALLBACK_POLICIES = ['DEFAULT_OUTPUT', 'FAIL_CLOSED', 'MANUAL_REVIEW'] as const;
export type FallbackPolicy = (typeof FALLBACK_POLICIES)[number];

export const UNKNOWN_POLICIES = ['IGNORE', 'UNDETERMINED'] as const;
export type UnknownPolicy = (typeof UNKNOWN_POLICIES)[number];

export const CONDITION_OPERATORS = [
  '==',
  '!=',
  '>',
  '<',
  '>=',
  '<=',
  'in',
  'not_in',
  'contains',
  'matches',
  'is_null',
  'is_not_null',
] as const;
export type RuleConditionOperator = (typeof CONDITION_OPERATORS)[number];

export const APPROVAL_SEATS = ['RULE_APPROVER', 'COMMISSION_APPROVER', 'COMPLIANCE', 'PLATFORM'] as const;
export type ApprovalSeat = (typeof APPROVAL_SEATS)[number];

export const APPROVAL_ACTIONS = ['APPROVE', 'REQUEST_CHANGES', 'REJECT'] as const;
export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number];

// AST Schemas
export const RuleConditionSchema = z.object({
  field: z.string().min(1, 'Condition field is required'),
  operator: z.enum(CONDITION_OPERATORS),
  value: z.unknown().optional(),
});
export type RuleCondition = z.infer<typeof RuleConditionSchema>;

export const RuleDefinitionSchema = z.object({
  uid: z.string().regex(/^RUL-[A-Z0-9-]{2,30}$/, 'UID must match pattern ^RUL-[A-Z0-9-]{2,30}$'),
  name: z.string().min(1, 'Rule name is required'),
  description: z.string().optional(),
  orderNo: z.number().int().nonnegative().optional(),
  priority: z.number().int().nonnegative().optional(),
  enabled: z.boolean().default(true),
  conditions: z.array(RuleConditionSchema).max(25, 'Maximum 25 conditions allowed per rule'),
  output: z.record(z.unknown()),
  explanation: z.string().optional(),
});
export type RuleDefinition = z.infer<typeof RuleDefinitionSchema>;

export const RuleSetDefinitionSchema = z.object({
  schemaVersion: z.literal(1),
  hitPolicy: z.enum(HIT_POLICIES).optional(),
  aggregator: z.enum(AGGREGATORS).optional(),
  defaultOutput: z.record(z.unknown()).nullable().optional(),
  rules: z.array(RuleDefinitionSchema).max(200, 'Maximum 200 rules allowed per rule set'),
});
export type RuleSetDefinition = z.infer<typeof RuleSetDefinitionSchema>;

// Decision Definition Schemas
export const DecisionDefinitionResponseSchema = z.object({
  key: z.string(),
  registryVersion: z.string(),
  tier: z.enum(DECISION_TIERS),
  inputSchema: z.record(z.unknown()),
  outputSchema: z.record(z.unknown()),
  allowedHitPolicies: z.array(z.enum(HIT_POLICIES)),
  bindingMode: z.enum(['EVAL', 'EVENT', 'PIN']),
  fallbackPolicy: z.enum(FALLBACK_POLICIES),
  fallbackOutput: z.record(z.unknown()).nullable(),
  unknownPolicy: z.enum(UNKNOWN_POLICIES),
  recordingLevel: z.enum(['ALWAYS', 'SAMPLED']),
  scopeChain: z.array(z.string()),
  overridable: z.boolean(),
  enabled: z.boolean(),
  dependencies: z.array(z.string()).default([]),
});
export type DecisionDefinitionResponse = z.infer<typeof DecisionDefinitionResponseSchema>;

// Rule Set Request / Response Schemas
export const CreateRuleSetRequestSchema = z
  .object({
    decisionKey: z.enum(DECISION_KEYS),
    scopeType: z.enum(RULE_SCOPE_TYPES).default('TENANT_DEFAULT'),
    scopeRef: z.string().nullable().optional(),
    name: z.string().min(1, 'Rule set name is required').max(100),
    description: z.string().max(500).optional(),
  })
  .refine((data) => (data.scopeType === 'TENANT_DEFAULT' ? !data.scopeRef : !!data.scopeRef), {
    message: 'scopeRef must be null if and only if scopeType is TENANT_DEFAULT',
    path: ['scopeRef'],
  });
export type CreateRuleSetRequest = z.infer<typeof CreateRuleSetRequestSchema>;

export const RuleSetResponseSchema = z.object({
  id: IdSchema('rs'),
  tenantId: z.string(),
  decisionKey: z.string(),
  scopeType: z.enum(RULE_SCOPE_TYPES),
  scopeRef: z.string().nullable(),
  name: z.string(),
  ownerUserId: z.string().nullable(),
  origin: z.enum(['PLATFORM_SEED', 'TENANT']),
  status: z.enum(RULE_SET_STATUSES),
  activeVersionId: z.string().nullable().optional(),
  scheduledVersionId: z.string().nullable().optional(),
  draftVersionCount: z.number().int().default(0),
  lockVersion: z.number().int(),
  createdAt: z.string(),
  createdBy: z.string(),
  updatedAt: z.string(),
  updatedBy: z.string(),
});
export type RuleSetResponse = z.infer<typeof RuleSetResponseSchema>;

export const RuleSetListQuerySchema = z.object({
  decisionKey: z.string().optional(),
  scopeType: z.enum(RULE_SCOPE_TYPES).optional(),
  status: z.enum(RULE_SET_STATUSES).optional(),
  ownerUserId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});
export type RuleSetListQuery = z.infer<typeof RuleSetListQuerySchema>;

export const RuleSetListResponseSchema = z.object({
  data: z.array(RuleSetResponseSchema),
  meta: z.object({
    nextCursor: z.string().nullable().optional(),
    limit: z.number(),
    totalCount: z.number().optional(),
  }),
});
export type RuleSetListResponse = z.infer<typeof RuleSetListResponseSchema>;

// Rule Set Version Schemas
export const CreateRuleSetVersionRequestSchema = z.object({
  cloneFromVersionId: z.string().optional(),
  changeReason: z.string().max(500).optional(),
  hitPolicy: z.enum(HIT_POLICIES).default('FIRST'),
  aggregator: z.enum(AGGREGATORS).optional(),
});
export type CreateRuleSetVersionRequest = z.infer<typeof CreateRuleSetVersionRequestSchema>;

export const UpdateRuleSetVersionRequestSchema = z.object({
  definition: RuleSetDefinitionSchema,
  hitPolicy: z.enum(HIT_POLICIES).optional(),
  aggregator: z.enum(AGGREGATORS).optional(),
  defaultOutput: z.record(z.unknown()).nullable().optional(),
  changeReason: z.string().max(500).optional(),
});
export type UpdateRuleSetVersionRequest = z.infer<typeof UpdateRuleSetVersionRequestSchema>;

export const RuleSetVersionResponseSchema = z.object({
  id: IdSchema('rsv'),
  tenantId: z.string(),
  ruleSetId: z.string(),
  versionNo: z.number().int(),
  status: z.enum(RULE_SET_VERSION_STATUSES),
  hitPolicy: z.enum(HIT_POLICIES),
  aggregator: z.enum(AGGREGATORS).nullable().optional(),
  authoringForm: z.enum(['RULES', 'DECISION_TABLE']).default('RULES'),
  definition: RuleSetDefinitionSchema,
  defaultOutput: z.record(z.unknown()).nullable().optional(),
  contentHash: z.string(),
  effectiveFrom: z.string().nullable().optional(),
  effectiveTo: z.string().nullable().optional(),
  changeReason: z.string().nullable().optional(),
  lineageVersionId: z.string().nullable().optional(),
  editors: z.array(z.string()),
  createdBy: z.string(),
  createdAt: z.string(),
  submittedBy: z.string().nullable().optional(),
  submittedAt: z.string().nullable().optional(),
  publishedBy: z.string().nullable().optional(),
  publishedAt: z.string().nullable().optional(),
  suspendedBy: z.string().nullable().optional(),
  suspendedAt: z.string().nullable().optional(),
  suspendReason: z.string().nullable().optional(),
  lastValidationId: z.string().nullable().optional(),
  lockVersion: z.number().int(),
});
export type RuleSetVersionResponse = z.infer<typeof RuleSetVersionResponseSchema>;

// Validation Schemas
export const ValidationReportResponseSchema = z.object({
  id: IdSchema('val'),
  versionId: z.string(),
  contentHash: z.string(),
  result: z.enum(['PASS', 'FAIL']),
  issues: z.array(
    z.object({
      code: z.string(),
      severity: z.enum(['ERROR', 'WARNING']),
      message: z.string(),
      ruleUid: z.string().optional(),
      path: z.string().optional(),
    }),
  ),
  testsSummary: z
    .object({
      total: z.number(),
      passed: z.number(),
      failed: z.number(),
    })
    .default({ total: 0, passed: 0, failed: 0 }),
  runBy: z.string(),
  runAt: z.string(),
});
export type ValidationReportResponse = z.infer<typeof ValidationReportResponseSchema>;

// Simulation Schemas
export const CreateSimulationRequestSchema = z.object({
  facts: z.record(z.unknown()),
  scope: z
    .object({
      branchId: z.string().optional(),
      lenderId: z.string().optional(),
      productVersionId: z.string().optional(),
    })
    .default({}),
  stepBudget: z.number().int().min(10).max(5000).default(1000),
});
export type CreateSimulationRequest = z.infer<typeof CreateSimulationRequestSchema>;

export const SimulationResponseSchema = z.object({
  id: IdSchema('sim'),
  tenantId: z.string(),
  versionId: z.string(),
  kind: z.enum(['MANUAL', 'TEST_SUITE']),
  contentHash: z.string(),
  status: z.enum(['COMPLETED', 'FAILED']),
  summary: z.object({
    status: z.enum(['OK', 'NO_MATCH', 'UNKNOWN', 'ERROR', 'TIMEOUT']),
    outputs: z.record(z.unknown()).nullable(),
    matchedRuleUids: z.array(z.string()),
    fallbackApplied: z.boolean(),
    fallbackPolicy: z.enum(FALLBACK_POLICIES).nullable().optional(),
    errorCode: z.string().nullable().optional(),
    durationUs: z.number(),
    trace: z.record(z.unknown()).optional(),
  }),
  requestedBy: z.string(),
  createdAt: z.string(),
});
export type SimulationResponse = z.infer<typeof SimulationResponseSchema>;

// Version Comparison & Impact Analysis
export const VersionComparisonRequestSchema = z.object({
  baseVersionId: z.string().min(1, 'baseVersionId is required'),
  targetVersionId: z.string().min(1, 'targetVersionId is required'),
  sampleFacts: z.array(z.record(z.unknown())).optional().default([]),
});
export type VersionComparisonRequest = z.infer<typeof VersionComparisonRequestSchema>;

export const VersionComparisonResponseSchema = z.object({
  baseVersionId: z.string(),
  targetVersionId: z.string(),
  ruleDiffs: z.object({
    addedRuleUids: z.array(z.string()),
    removedRuleUids: z.array(z.string()),
    modifiedRuleUids: z.array(z.string()),
    unchangedRuleUids: z.array(z.string()),
  }),
  sampleEvaluationDifferences: z.array(
    z.object({
      sampleIndex: z.number(),
      baseOutput: z.record(z.unknown()).nullable(),
      targetOutput: z.record(z.unknown()).nullable(),
      different: z.boolean(),
    }),
  ),
});
export type VersionComparisonResponse = z.infer<typeof VersionComparisonResponseSchema>;

export const ImpactAnalysisRequestSchema = z.object({
  testSuiteRun: z.boolean().default(true),
});
export type ImpactAnalysisRequest = z.infer<typeof ImpactAnalysisRequestSchema>;

export const ImpactAnalysisResponseSchema = z.object({
  versionId: z.string(),
  contentHash: z.string(),
  testCasesTotal: z.number(),
  testCasesPassed: z.number(),
  testCasesFailed: z.number(),
  readyForReview: z.boolean(),
  notes: z.array(z.string()),
});
export type ImpactAnalysisResponse = z.infer<typeof ImpactAnalysisResponseSchema>;

// Test Cases Schemas
export const CreateTestCaseRequestSchema = z.object({
  name: z.string().min(1, 'Test case name is required').max(100),
  evaluationTime: z.string().datetime().optional(),
  scope: z.record(z.unknown()).default({}),
  input: z.record(z.unknown()),
  expectedStatus: z.enum(['OK', 'NO_MATCH', 'UNKNOWN']).default('OK'),
  expectedOutput: z.record(z.unknown()),
  active: z.boolean().default(true),
});
export type CreateTestCaseRequest = z.infer<typeof CreateTestCaseRequestSchema>;

export const UpdateTestCaseRequestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  input: z.record(z.unknown()).optional(),
  expectedStatus: z.enum(['OK', 'NO_MATCH', 'UNKNOWN']).optional(),
  expectedOutput: z.record(z.unknown()).optional(),
  active: z.boolean().optional(),
});
export type UpdateTestCaseRequest = z.infer<typeof UpdateTestCaseRequestSchema>;

export const TestCaseResponseSchema = z.object({
  id: IdSchema('tc'),
  tenantId: z.string(),
  ruleSetId: z.string(),
  name: z.string(),
  evaluationTime: z.string(),
  scope: z.record(z.unknown()),
  input: z.record(z.unknown()),
  expectedStatus: z.enum(['OK', 'NO_MATCH', 'UNKNOWN']),
  expectedOutput: z.record(z.unknown()),
  active: z.boolean(),
  lockVersion: z.number().int(),
  createdAt: z.string(),
  createdBy: z.string(),
  updatedAt: z.string(),
  updatedBy: z.string(),
});
export type TestCaseResponse = z.infer<typeof TestCaseResponseSchema>;

// Lifecycle Transition Schemas
export const SubmitVersionRequestSchema = z.object({
  changeReason: z.string().min(3, 'changeReason must be at least 3 characters').max(500),
});
export type SubmitVersionRequest = z.infer<typeof SubmitVersionRequestSchema>;

export const ReviewVersionRequestSchema = z.object({
  seat: z.enum(APPROVAL_SEATS).default('RULE_APPROVER'),
  action: z.enum(APPROVAL_ACTIONS),
  comment: z.string().min(3, 'Comment must be between 3 and 2000 characters').max(2000),
  reviewedContentHash: z.string().regex(/^sha256:[0-9a-f]{64}$/, 'Valid sha256 content hash required'),
});
export type ReviewVersionRequest = z.infer<typeof ReviewVersionRequestSchema>;

export const PublishVersionRequestSchema = z.object({
  effectiveFrom: z.string().datetime().optional(),
  effectiveTo: z.string().datetime().optional(),
  reason: z.string().min(3, 'Publish reason required').max(500),
});
export type PublishVersionRequest = z.infer<typeof PublishVersionRequestSchema>;

export const SuspendVersionRequestSchema = z.object({
  suspendReason: z.string().min(3, 'Suspend reason is required').max(500),
});
export type SuspendVersionRequest = z.infer<typeof SuspendVersionRequestSchema>;

export const ReinstateVersionRequestSchema = z.object({
  reason: z.string().min(3, 'Reinstate reason is required').max(500),
});
export type ReinstateVersionRequest = z.infer<typeof ReinstateVersionRequestSchema>;

export const RetireVersionRequestSchema = z.object({
  reason: z.string().min(3, 'Retire reason is required').max(500),
});
export type RetireVersionRequest = z.infer<typeof RetireVersionRequestSchema>;

export const RollbackRequestSchema = z.object({
  targetVersionId: z.string().min(1, 'Target version ID required'),
  reason: z.string().min(3, 'Rollback reason required').max(500),
});
export type RollbackRequest = z.infer<typeof RollbackRequestSchema>;

// Decision Evaluations & Records
export const EvaluateDecisionRequestSchema = z.object({
  subject: z.object({
    type: z.enum(['LEAD', 'CUSTOMER', 'LOAN_APPLICATION', 'TASK']),
    id: z.string(),
  }),
  facts: z.record(z.unknown()),
  scope: z
    .object({
      branchId: z.string().optional(),
      lenderId: z.string().optional(),
      productVersionId: z.string().optional(),
    })
    .default({}),
  evaluationTime: z.string().datetime().optional(),
  mode: z.enum(['LIVE', 'SIMULATION']).default('LIVE'),
});
export type EvaluateDecisionRequest = z.infer<typeof EvaluateDecisionRequestSchema>;

export const DecisionEvaluationResponseSchema = z.object({
  decisionRecordId: z.string(),
  decisionKey: z.string(),
  ruleSetVersionId: z.string().nullable(),
  status: z.enum(['OK', 'NO_MATCH', 'UNKNOWN', 'ERROR', 'TIMEOUT', 'NO_VERSION']),
  outputs: z.record(z.unknown()).nullable(),
  fallbackApplied: z.boolean(),
  fallbackPolicy: z.enum(FALLBACK_POLICIES).nullable().optional(),
  errorCode: z.string().nullable().optional(),
  matchedRuleUids: z.array(z.string()),
  inputHash: z.string(),
  replayed: z.boolean(),
  durationUs: z.number(),
});
export type DecisionEvaluationResponse = z.infer<typeof DecisionEvaluationResponseSchema>;

export const DecisionRecordResponseSchema = z.object({
  id: IdSchema('dr'),
  tenantId: z.string(),
  decisionKey: z.string(),
  ruleSetVersionId: z.string().nullable(),
  subjectType: z.string(),
  subjectId: z.string(),
  evaluationTime: z.string(),
  idempotencyKey: z.string(),
  inputHash: z.string(),
  inputSnapshot: z.record(z.unknown()),
  outputs: z.record(z.unknown()).nullable(),
  matchedRuleUids: z.array(z.string()),
  missingFields: z.array(z.string()),
  status: z.enum(['OK', 'NO_MATCH', 'UNKNOWN', 'ERROR', 'TIMEOUT', 'NO_VERSION']),
  fallbackApplied: z.boolean(),
  fallbackPolicy: z.enum(FALLBACK_POLICIES).nullable().optional(),
  errorCode: z.string().nullable().optional(),
  durationUs: z.number(),
  correlationId: z.string(),
  createdAt: z.string(),
});
export type DecisionRecordResponse = z.infer<typeof DecisionRecordResponseSchema>;

export const DecisionRecordListQuerySchema = z.object({
  decisionKey: z.string().optional(),
  subjectType: z.string().optional(),
  subjectId: z.string().optional(),
  ruleSetVersionId: z.string().optional(),
  status: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});
export type DecisionRecordListQuery = z.infer<typeof DecisionRecordListQuerySchema>;

export const DecisionRecordListResponseSchema = z.object({
  data: z.array(DecisionRecordResponseSchema),
  meta: z.object({
    nextCursor: z.string().nullable().optional(),
    limit: z.number(),
    totalCount: z.number().optional(),
  }),
});
export type DecisionRecordListResponse = z.infer<typeof DecisionRecordListResponseSchema>;
