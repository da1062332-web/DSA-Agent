// packages/bre-core/src/ast/types.ts — owner: Dev 2 (pure functions, no I/O)

export const HIT_POLICIES = ['UNIQUE', 'FIRST', 'PRIORITY', 'COLLECT', 'RULE_ORDER'] as const;
export type HitPolicy = (typeof HIT_POLICIES)[number];

export const AGGREGATORS = ['SUM', 'MIN', 'MAX', 'COUNT'] as const;
export type Aggregator = (typeof AGGREGATORS)[number];

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

export interface RuleCondition {
  field: string;
  operator: RuleConditionOperator;
  value?: unknown;
}

export interface RuleDefinition {
  uid: string; // ^RUL-[A-Z0-9-]{2,30}$
  name: string;
  description?: string;
  orderNo?: number;
  priority?: number;
  enabled: boolean;
  conditions: RuleCondition[];
  output: Record<string, unknown>;
  explanation?: string;
}

export interface RuleSetDefinition {
  schemaVersion: 1;
  hitPolicy?: HitPolicy;
  aggregator?: Aggregator;
  defaultOutput?: Record<string, unknown> | null;
  rules: RuleDefinition[];
}

export interface ValidationIssue {
  code: string;
  severity: 'ERROR' | 'WARNING';
  message: string;
  ruleUid?: string;
  path?: string;
}

export interface ValidationReport {
  result: 'PASS' | 'FAIL';
  contentHash: string;
  issues: ValidationIssue[];
  testsSummary?: {
    total: number;
    passed: number;
    failed: number;
  };
}

export interface MatchedRuleOutput {
  ruleUid: string;
  output: Record<string, unknown>;
  orderNo?: number;
  priority?: number;
  explanation?: string;
}

export interface EvaluationResult {
  status: 'OK' | 'NO_MATCH' | 'UNKNOWN' | 'ERROR' | 'TIMEOUT';
  outputs: Record<string, unknown> | null;
  fallbackApplied: boolean;
  fallbackPolicy: 'DEFAULT_OUTPUT' | 'FAIL_CLOSED' | 'MANUAL_REVIEW' | null;
  errorCode: 'INVALID_INPUT' | 'MULTIPLE_MATCH' | 'STEP_BUDGET_EXCEEDED' | 'EVALUATION_ERROR' | null;
  missingFields: string[];
  matchedRuleUids: string[];
  durationUs: number;
  trace: {
    evaluatedRuleUids: string[];
    hitPolicy: HitPolicy;
    conditionsEvaluatedCount: number;
  };
}
