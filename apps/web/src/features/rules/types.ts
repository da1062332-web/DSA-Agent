import type {
  DecisionKey,
  HitPolicy,
  RuleScopeType,
  RuleSetVersionStatus as VersionStatus,
  RuleSetDefinition,
  ValidationReportResponse,
  SimulationResponse,
  TestCaseResponse,
  RuleSetResponse,
  RuleSetVersionResponse,
  DecisionDefinitionResponse,
  DecisionRecordResponse,
} from '@dsa/contracts';

export type ScopeType = RuleScopeType;
export type ValidationIssue = ValidationReportResponse['issues'][number];

export type {
  DecisionKey,
  HitPolicy,
  RuleScopeType,
  VersionStatus,
  RuleSetDefinition,
  ValidationReportResponse,
  SimulationResponse,
  TestCaseResponse,
  RuleSetResponse,
  RuleSetVersionResponse,
  DecisionDefinitionResponse,
  DecisionRecordResponse,
};

export interface CreateRuleSetInput {
  decisionKey: DecisionKey;
  scopeType: ScopeType;
  scopeRef?: string | null;
  name: string;
}

export interface CreateRuleSetVersionInput {
  hitPolicy?: HitPolicy;
  changeReason?: string;
  cloneFromVersionId?: string;
}

export interface UpdateRuleSetVersionInput {
  definition: RuleSetDefinition;
  hitPolicy?: HitPolicy;
  aggregator?: 'COUNT' | 'SUM' | 'MIN' | 'MAX' | null;
  defaultOutput?: Record<string, unknown> | null;
  changeReason?: string;
}

export interface SubmitVersionInput {
  changeReason: string;
}

export interface ReviewVersionInput {
  seat?: 'RULE_APPROVER' | 'RISK_OFFICER' | 'COMPLIANCE' | 'SUPER_ADMIN';
  action: 'APPROVE' | 'REJECT' | 'REQUEST_CHANGES';
  comment: string;
  reviewedContentHash: string;
}

export interface PublishVersionInput {
  effectiveFrom?: string;
  effectiveTo?: string | null;
  reason: string;
}

export interface SuspendVersionInput {
  suspendReason: string;
}

export interface ReinstateVersionInput {
  reason: string;
}

export interface SimulateVersionInput {
  facts: Record<string, unknown>;
  stepBudget?: number;
}

export interface CreateTestCaseInput {
  name: string;
  evaluationTime?: string;
  scope?: Record<string, unknown>;
  input: Record<string, unknown>;
  expectedStatus: 'MATCHED' | 'NO_MATCH' | 'ERROR';
  expectedOutput: Record<string, unknown>;
}
