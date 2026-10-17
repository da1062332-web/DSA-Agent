// apps/api/src/modules/rules/db.ts — owner: Developer 2 & 6 (Module 23: Business Rule Engine)
import {
  AppError,
  type CreateRuleSetRequest,
  type CreateRuleSetVersionRequest,
  type CreateSimulationRequest,
  type CreateTestCaseRequest,
  type DecisionDefinitionResponse,
  type DecisionRecordListQuery,
  type DecisionRecordResponse,
  type PublishVersionRequest,
  type ReinstateVersionRequest,
  type RequestContext,
  type RetireVersionRequest,
  type ReviewVersionRequest,
  type RollbackRequest,
  type RuleSetListQuery,
  type RuleSetResponse,
  type RuleSetVersionResponse,
  type SubmitVersionRequest,
  type SuspendVersionRequest,
  type TestCaseResponse,
  type Tx,
  type UpdateRuleSetVersionRequest,
  type UpdateTestCaseRequest,
  type ValidationReportResponse,
  type SimulationResponse,
} from '@dsa/contracts';
import {
  computeContentHash,
  type EvaluationResult,
  type RuleSetDefinition,
  type ValidationReport,
} from '@dsa/bre-core';
import { sql } from 'kysely';

export interface RawDecisionDefinitionRow {
  key: string;
  registry_version: string;
  tier: string;
  input_schema: unknown;
  output_schema: unknown;
  allowed_hit_policies: string[];
  binding_mode: string;
  fallback_policy: string;
  fallback_output: unknown;
  unknown_policy: string;
  recording_level: string;
  scope_chain: string[];
  overridable: boolean;
  enabled: boolean;
}

export interface RawRuleSetRow {
  id: string;
  tenant_id: string;
  decision_key: string;
  scope_type: string;
  scope_ref: string | null;
  name: string;
  owner_user_id: string | null;
  origin: string;
  status: string;
  lock_version: number;
  created_at: string | Date;
  created_by: string;
  updated_at: string | Date;
  updated_by: string;
}

export interface RawRuleSetVersionRow {
  id: string;
  tenant_id: string;
  rule_set_id: string;
  version_no: number;
  status: string;
  hit_policy: string;
  aggregator: string | null;
  authoring_form: string;
  definition: unknown;
  default_output: unknown;
  content_hash: string;
  effective_range: unknown;
  change_reason: string | null;
  lineage_version_id: string | null;
  editors: string[];
  created_by: string;
  created_at: string | Date;
  submitted_by: string | null;
  submitted_at: string | Date | null;
  published_by: string | null;
  published_at: string | Date | null;
  suspended_by: string | null;
  suspended_at: string | Date | null;
  suspend_reason: string | null;
  last_validation_id: string | null;
  lock_version: number;
}

export function formatDecisionDefinition(
  row: RawDecisionDefinitionRow,
  dependencies: string[] = [],
): DecisionDefinitionResponse {
  return {
    key: row.key,
    registryVersion: row.registry_version,
    tier: row.tier as 'T1' | 'T2' | 'T3',
    inputSchema: (row.input_schema as Record<string, unknown>) ?? {},
    outputSchema: (row.output_schema as Record<string, unknown>) ?? {},
    allowedHitPolicies:
      (row.allowed_hit_policies as ('UNIQUE' | 'FIRST' | 'PRIORITY' | 'COLLECT' | 'RULE_ORDER')[]) ?? [],
    bindingMode: row.binding_mode as 'EVAL' | 'EVENT' | 'PIN',
    fallbackPolicy: row.fallback_policy as 'DEFAULT_OUTPUT' | 'FAIL_CLOSED' | 'MANUAL_REVIEW',
    fallbackOutput: (row.fallback_output as Record<string, unknown>) ?? null,
    unknownPolicy: row.unknown_policy as 'IGNORE' | 'UNDETERMINED',
    recordingLevel: row.recording_level as 'ALWAYS' | 'SAMPLED',
    scopeChain: row.scope_chain ?? [],
    overridable: Boolean(row.overridable),
    enabled: Boolean(row.enabled),
    dependencies,
  };
}

export function formatRuleSet(
  row: RawRuleSetRow,
  extras?: {
    activeVersionId?: string | null;
    scheduledVersionId?: string | null;
    draftVersionCount?: number;
  },
): RuleSetResponse {
  return {
    id: row.id as RuleSetResponse['id'],
    tenantId: row.tenant_id,
    decisionKey: row.decision_key,
    scopeType: row.scope_type as 'TENANT_DEFAULT' | 'BRANCH' | 'LENDER' | 'PRODUCT_VERSION',
    scopeRef: row.scope_ref ?? null,
    name: row.name,
    ownerUserId: row.owner_user_id ?? null,
    origin: row.origin as 'PLATFORM_SEED' | 'TENANT',
    status: row.status as 'ACTIVE' | 'ARCHIVED',
    activeVersionId: extras?.activeVersionId ?? null,
    scheduledVersionId: extras?.scheduledVersionId ?? null,
    draftVersionCount: extras?.draftVersionCount ?? 0,
    lockVersion: Number(row.lock_version ?? 0),
    createdAt: new Date(row.created_at).toISOString(),
    createdBy: row.created_by,
    updatedAt: new Date(row.updated_at).toISOString(),
    updatedBy: row.updated_by,
  };
}

export function formatRuleSetVersion(row: RawRuleSetVersionRow): RuleSetVersionResponse {
  return {
    id: row.id as RuleSetVersionResponse['id'],
    tenantId: row.tenant_id,
    ruleSetId: row.rule_set_id,
    versionNo: Number(row.version_no),
    status: row.status as RuleSetVersionResponse['status'],
    hitPolicy: row.hit_policy as RuleSetVersionResponse['hitPolicy'],
    aggregator: (row.aggregator as RuleSetVersionResponse['aggregator']) ?? null,
    authoringForm: (row.authoring_form as 'RULES' | 'DECISION_TABLE') ?? 'RULES',
    definition: (row.definition as RuleSetDefinition) ?? { schemaVersion: 1, rules: [] },
    defaultOutput: (row.default_output as Record<string, unknown>) ?? null,
    contentHash: row.content_hash,
    effectiveFrom: null,
    effectiveTo: null,
    changeReason: row.change_reason ?? null,
    lineageVersionId: row.lineage_version_id ?? null,
    editors: Array.isArray(row.editors) ? row.editors : [],
    createdBy: row.created_by,
    createdAt: new Date(row.created_at).toISOString(),
    submittedBy: row.submitted_by ?? null,
    submittedAt: row.submitted_at ? new Date(row.submitted_at).toISOString() : null,
    publishedBy: row.published_by ?? null,
    publishedAt: row.published_at ? new Date(row.published_at).toISOString() : null,
    suspendedBy: row.suspended_by ?? null,
    suspendedAt: row.suspended_at ? new Date(row.suspended_at).toISOString() : null,
    suspendReason: row.suspend_reason ?? null,
    lastValidationId: row.last_validation_id ?? null,
    lockVersion: Number(row.lock_version ?? 0),
  };
}

// ---------------- Decision Definitions ----------------
export async function getDecisionDefinition(tx: Tx, key: string): Promise<DecisionDefinitionResponse> {
  const result = await sql<RawDecisionDefinitionRow>`
    SELECT * FROM app.decision_definition WHERE key = ${key}
  `.execute(tx);

  const row = result.rows[0];
  if (!row) {
    throw AppError.of('DECISION_KEY_UNKNOWN', `Decision definition for key '${key}' not found.`);
  }

  const depResult = await sql<{ depends_on_key: string }>`
    SELECT depends_on_key FROM app.decision_dependency WHERE decision_key = ${key}
  `.execute(tx);

  const deps = depResult.rows.map((r) => r.depends_on_key);
  return formatDecisionDefinition(row, deps);
}

export async function listDecisionDefinitions(tx: Tx): Promise<DecisionDefinitionResponse[]> {
  const result = await sql<RawDecisionDefinitionRow>`
    SELECT * FROM app.decision_definition ORDER BY key ASC
  `.execute(tx);

  const depResult = await sql<{ decision_key: string; depends_on_key: string }>`
    SELECT decision_key, depends_on_key FROM app.decision_dependency
  `.execute(tx);

  const depMap = new Map<string, string[]>();
  for (const r of depResult.rows) {
    const list = depMap.get(r.decision_key) || [];
    list.push(r.depends_on_key);
    depMap.set(r.decision_key, list);
  }

  return result.rows.map((row) => formatDecisionDefinition(row, depMap.get(row.key) || []));
}

export function getApprovedDefaultRuleSet(decisionKey: string): RuleSetDefinition {
  switch (decisionKey) {
    case 'DK-application.eligibility':
      return {
        schemaVersion: 1,
        hitPolicy: 'FIRST',
        defaultOutput: {
          result: 'REFER',
          maxEligibleAmount: null,
          reasons: [{ code: 'MANUAL_REVIEW', text: 'Application referred for underwriter review' }],
        },
        rules: [
          {
            uid: 'RUL-ELG-001',
            name: 'Low Credit Score Rejection',
            description: 'Reject applicant if credit bureau score is below 600',
            orderNo: 0,
            priority: 100,
            enabled: true,
            conditions: [{ field: 'applicant.credit_score', operator: '<', value: 600 }],
            output: {
              result: 'INELIGIBLE',
              maxEligibleAmount: null,
              reasons: [
                {
                  code: 'CREDIT_SCORE_LOW',
                  text: 'Credit bureau score below acceptable threshold (min 600)',
                },
              ],
            },
            explanation: 'Bureau score of applicant is below credit risk cutoff',
          },
          {
            uid: 'RUL-ELG-002',
            name: 'Minimum Net Monthly Income Rejection',
            description: 'Reject applicant if monthly net income is below 25,000 INR',
            orderNo: 1,
            priority: 90,
            enabled: true,
            conditions: [{ field: 'applicant.monthly_income.amount', operator: '<', value: 25000 }],
            output: {
              result: 'INELIGIBLE',
              maxEligibleAmount: null,
              reasons: [
                {
                  code: 'INCOME_BELOW_MINIMUM',
                  text: 'Monthly net income is below minimum requirement of 25,000 INR',
                },
              ],
            },
            explanation: 'Net take-home income does not meet minimum retail borrowing cutoff',
          },
          {
            uid: 'RUL-ELG-003',
            name: 'Prime Borrower High Eligibility Pass',
            description:
              'Applicant with credit score >= 750 and income >= 75,000 qualifies for prime sanction',
            orderNo: 2,
            priority: 80,
            enabled: true,
            conditions: [
              { field: 'applicant.credit_score', operator: '>=', value: 750 },
              { field: 'applicant.monthly_income.amount', operator: '>=', value: 75000 },
            ],
            output: {
              result: 'ELIGIBLE',
              maxEligibleAmount: { amount: '2500000.00', currency: 'INR' },
              reasons: [
                {
                  code: 'PRIME_BORROWER_ELIGIBLE',
                  text: 'Applicant meets prime credit and income benchmarks',
                },
              ],
            },
            explanation: 'High credit score and strong income qualification',
          },
          {
            uid: 'RUL-ELG-004',
            name: 'Standard Salaried Borrower Pass',
            description:
              'Applicant with credit score >= 650 and income >= 25,000 qualifies for standard sanction',
            orderNo: 3,
            priority: 70,
            enabled: true,
            conditions: [
              { field: 'applicant.credit_score', operator: '>=', value: 650 },
              { field: 'applicant.monthly_income.amount', operator: '>=', value: 25000 },
            ],
            output: {
              result: 'ELIGIBLE',
              maxEligibleAmount: { amount: '1000000.00', currency: 'INR' },
              reasons: [
                { code: 'STANDARD_ELIGIBLE', text: 'Applicant satisfies standard eligibility criteria' },
              ],
            },
            explanation: 'Satisfies baseline credit and income requirements',
          },
        ],
      };

    case 'DK-document.requirements':
      return {
        schemaVersion: 1,
        hitPolicy: 'COLLECT',
        defaultOutput: {
          documents: [
            { typeCode: 'PAN_CARD', mandatory: true, count: 1, periodMonths: 0 },
            { typeCode: 'AADHAAR_MASKED', mandatory: true, count: 1, periodMonths: 0 },
          ],
        },
        rules: [
          {
            uid: 'RUL-DOC-001',
            name: 'Salaried Income Verification Documents',
            orderNo: 0,
            enabled: true,
            conditions: [{ field: 'party.applicant_type', operator: '==', value: 'SALARIED' }],
            output: {
              documents: [
                { typeCode: 'PAN_CARD', mandatory: true, count: 1, periodMonths: 0 },
                { typeCode: 'AADHAAR_MASKED', mandatory: true, count: 1, periodMonths: 0 },
                { typeCode: 'SALARY_SLIP', mandatory: true, count: 3, periodMonths: 3 },
                { typeCode: 'BANK_STATEMENT', mandatory: true, count: 1, periodMonths: 6 },
              ],
            },
          },
        ],
      };

    case 'DK-application.completeness':
      return {
        schemaVersion: 1,
        hitPolicy: 'FIRST',
        defaultOutput: {
          result: 'INCOMPLETE',
          reasons: [{ code: 'INITIAL_ASSESSMENT', text: 'Application completeness evaluation pending' }],
        },
        rules: [
          {
            uid: 'RUL-CMP-001',
            name: 'Missing Consent Check',
            orderNo: 0,
            enabled: true,
            conditions: [{ field: 'parties.all_processing_consent', operator: '==', value: false }],
            output: {
              result: 'INCOMPLETE',
              reasons: [
                {
                  code: 'NO_PROCESSING_CONSENT',
                  text: 'All parties must execute active data processing consent',
                },
              ],
            },
          },
          {
            uid: 'RUL-CMP-002',
            name: 'Mandatory Documents Missing Check',
            orderNo: 1,
            enabled: true,
            conditions: [{ field: 'application.mandatory_pending_count', operator: '>', value: 0 }],
            output: {
              result: 'INCOMPLETE',
              reasons: [
                {
                  code: 'MANDATORY_DOCUMENTS_PENDING',
                  text: 'Required mandatory KYC and income documents are missing',
                },
              ],
            },
          },
        ],
      };

    default:
      return {
        schemaVersion: 1,
        hitPolicy: 'FIRST',
        rules: [],
      };
  }
}

// ---------------- Rule Sets ----------------
export async function createRuleSet(
  tx: Tx,
  ctx: RequestContext,
  id: string,
  initialVersionId: string,
  input: CreateRuleSetRequest,
): Promise<RuleSetResponse> {
  const actor = ctx.principal.id;
  const tenantId = ctx.principal.tenantId;

  // Verify decision definition exists
  await getDecisionDefinition(tx, input.decisionKey);

  // Check unique index on (tenant_id, decision_key, scope_type, coalesce(scope_ref, '-'))
  const existing = await sql<RawRuleSetRow>`
    SELECT * FROM app.rule_set
    WHERE decision_key = ${input.decisionKey}
      AND scope_type = ${input.scopeType}
      AND coalesce(scope_ref, '-') = ${input.scopeRef ?? '-'}
  `.execute(tx);

  if (existing.rows[0]) {
    throw AppError.of('RULE_SET_EXISTS', 'Rule set for this decision key and scope already exists.');
  }

  // Create rule_set
  const result = await sql<RawRuleSetRow>`
    INSERT INTO app.rule_set (
      id, tenant_id, decision_key, scope_type, scope_ref, name, owner_user_id, origin, status, created_by, updated_by
    ) VALUES (
      ${id}, ${tenantId}, ${input.decisionKey}, ${input.scopeType}, ${input.scopeRef ?? null},
      ${input.name}, ${actor}, 'TENANT', 'ACTIVE', ${actor}, ${actor}
    ) RETURNING *
  `.execute(tx);

  const row = result.rows[0]!;

  // Create initial approved default draft version v1
  const initialDef: RuleSetDefinition = getApprovedDefaultRuleSet(input.decisionKey);
  const hash = computeContentHash(initialDef);

  await sql`
    INSERT INTO app.rule_set_version (
      id, tenant_id, rule_set_id, version_no, status, hit_policy, authoring_form, definition,
      content_hash, editors, created_by
    ) VALUES (
      ${initialVersionId}, ${tenantId}, ${id}, 1, 'DRAFT', 'FIRST', 'RULES', ${JSON.stringify(initialDef)}::jsonb,
      ${hash}, ${[actor]}, ${actor}
    )
  `.execute(tx);

  return formatRuleSet(row, { draftVersionCount: 1 });
}

export async function listRuleSets(
  tx: Tx,
  _ctx: RequestContext,
  query: RuleSetListQuery,
): Promise<{
  data: RuleSetResponse[];
  meta: { nextCursor: string | null; limit: number; totalCount?: number };
}> {
  const conditions = [sql`1=1`];

  if (query.decisionKey) conditions.push(sql`rs.decision_key = ${query.decisionKey}`);
  if (query.scopeType) conditions.push(sql`rs.scope_type = ${query.scopeType}`);
  if (query.status) conditions.push(sql`rs.status = ${query.status}`);
  if (query.ownerUserId) conditions.push(sql`rs.owner_user_id = ${query.ownerUserId}`);
  if (query.cursor) conditions.push(sql`rs.id < ${query.cursor}`);

  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);

  const result = await sql<RawRuleSetRow>`
    SELECT rs.* FROM app.rule_set rs
    WHERE ${sql.join(conditions, sql` AND `)}
    ORDER BY rs.created_at DESC, rs.id DESC
    LIMIT ${limit + 1}
  `.execute(tx);

  const rows = result.rows;
  const hasMore = rows.length > limit;
  const dataRows = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore && dataRows.length > 0 ? dataRows[dataRows.length - 1]!.id : null;

  return {
    data: dataRows.map((r) => formatRuleSet(r)),
    meta: {
      nextCursor,
      limit,
    },
  };
}

export async function getRuleSetById(
  tx: Tx,
  _ctx: RequestContext,
  ruleSetId: string,
): Promise<RuleSetResponse> {
  const result = await sql<RawRuleSetRow>`
    SELECT * FROM app.rule_set WHERE id = ${ruleSetId}
  `.execute(tx);

  const row = result.rows[0];
  if (!row) {
    throw AppError.of('NOT_FOUND', `Rule set '${ruleSetId}' not found.`);
  }

  // Get active version & draft count
  const versionsRes = await sql<{ id: string; status: string }>`
    SELECT id, status FROM app.rule_set_version WHERE rule_set_id = ${ruleSetId}
  `.execute(tx);

  const active = versionsRes.rows.find((v) => v.status === 'ACTIVE');
  const scheduled = versionsRes.rows.find((v) => v.status === 'SCHEDULED');
  const draftCount = versionsRes.rows.filter((v) => v.status === 'DRAFT').length;

  return formatRuleSet(row, {
    activeVersionId: active?.id ?? null,
    scheduledVersionId: scheduled?.id ?? null,
    draftVersionCount: draftCount,
  });
}

// ---------------- Rule Set Versions ----------------
export async function listRuleSetVersions(
  tx: Tx,
  ctx: RequestContext,
  ruleSetId: string,
): Promise<RuleSetVersionResponse[]> {
  await getRuleSetById(tx, ctx, ruleSetId);

  const result = await sql<RawRuleSetVersionRow>`
    SELECT * FROM app.rule_set_version
    WHERE rule_set_id = ${ruleSetId}
    ORDER BY version_no DESC
  `.execute(tx);

  return result.rows.map(formatRuleSetVersion);
}

export async function getRuleSetVersionById(
  tx: Tx,
  _ctx: RequestContext,
  versionId: string,
): Promise<RuleSetVersionResponse> {
  const result = await sql<RawRuleSetVersionRow>`
    SELECT * FROM app.rule_set_version WHERE id = ${versionId}
  `.execute(tx);

  const row = result.rows[0];
  if (!row) {
    throw AppError.of('NOT_FOUND', `Rule set version '${versionId}' not found.`);
  }
  return formatRuleSetVersion(row);
}

export async function createRuleSetVersion(
  tx: Tx,
  ctx: RequestContext,
  ruleSetId: string,
  versionId: string,
  input: CreateRuleSetVersionRequest,
): Promise<RuleSetVersionResponse> {
  const tenantId = ctx.principal.tenantId;
  const actor = ctx.principal.id;

  await getRuleSetById(tx, ctx, ruleSetId);

  // Enforce maximum 5 open drafts
  const draftsRes = await sql<{ count: string }>`
    SELECT count(*) as count FROM app.rule_set_version
    WHERE rule_set_id = ${ruleSetId} AND status = 'DRAFT'
  `.execute(tx);

  if (Number(draftsRes.rows[0]?.count ?? 0) >= 5) {
    throw AppError.of(
      'DRAFT_LIMIT_REACHED',
      'Maximum limit of 5 open drafts reached for this rule set. Publish, abandon, or delete existing drafts before creating a new one.',
    );
  }

  // Get next version_no
  const maxVerRes = await sql<{ max_ver: number }>`
    SELECT coalesce(max(version_no), 0) as max_ver FROM app.rule_set_version
    WHERE rule_set_id = ${ruleSetId}
  `.execute(tx);
  const nextVerNo = Number(maxVerRes.rows[0]?.max_ver ?? 0) + 1;

  let baseDefinition: RuleSetDefinition = {
    schemaVersion: 1,
    hitPolicy: input.hitPolicy ?? 'FIRST',
    rules: [],
  };
  let lineageId: string | null = null;

  if (input.cloneFromVersionId) {
    const parent = await getRuleSetVersionById(tx, ctx, input.cloneFromVersionId);
    baseDefinition = parent.definition;
    lineageId = parent.id;
  }

  const hash = computeContentHash(baseDefinition);

  const result = await sql<RawRuleSetVersionRow>`
    INSERT INTO app.rule_set_version (
      id, tenant_id, rule_set_id, version_no, status, hit_policy, aggregator, definition,
      content_hash, change_reason, lineage_version_id, editors, created_by
    ) VALUES (
      ${versionId}, ${tenantId}, ${ruleSetId}, ${nextVerNo}, 'DRAFT', ${input.hitPolicy ?? 'FIRST'},
      ${input.aggregator ?? null}, ${JSON.stringify(baseDefinition)}::jsonb, ${hash},
      ${input.changeReason ?? null}, ${lineageId}, ${[actor]}, ${actor}
    ) RETURNING *
  `.execute(tx);

  return formatRuleSetVersion(result.rows[0]!);
}

export async function updateRuleSetVersion(
  tx: Tx,
  ctx: RequestContext,
  versionId: string,
  ifMatch: number,
  input: UpdateRuleSetVersionRequest,
): Promise<RuleSetVersionResponse> {
  const actor = ctx.principal.id;

  const existingRes = await sql<RawRuleSetVersionRow>`
    SELECT * FROM app.rule_set_version WHERE id = ${versionId} FOR UPDATE
  `.execute(tx);

  const current = existingRes.rows[0];
  if (!current) {
    throw AppError.of('NOT_FOUND', `Rule set version '${versionId}' not found.`);
  }

  if (current.status !== 'DRAFT') {
    throw AppError.of(
      'INVALID_STATE',
      `Rule set version '${versionId}' is in status '${current.status}' and is immutable. Only DRAFT versions can be edited.`,
    );
  }

  if (Number(current.lock_version) !== ifMatch) {
    throw AppError.of('VERSION_CONFLICT', 'Record was modified by another user.', [
      { field: 'If-Match', issue: 'STALE', meta: { currentVersion: current.lock_version } },
    ]);
  }

  const hash = computeContentHash(input.definition);
  const editors = Array.from(new Set([...(current.editors || []), actor]));

  const result = await sql<RawRuleSetVersionRow>`
    UPDATE app.rule_set_version
    SET
      definition = ${JSON.stringify(input.definition)}::jsonb,
      hit_policy = ${input.hitPolicy ?? current.hit_policy},
      aggregator = ${input.aggregator ?? current.aggregator},
      default_output = ${input.defaultOutput ? JSON.stringify(input.defaultOutput) : null}::jsonb,
      content_hash = ${hash},
      change_reason = ${input.changeReason ?? current.change_reason},
      editors = ${editors},
      last_validation_id = NULL
    WHERE id = ${versionId}
    RETURNING *
  `.execute(tx);

  return formatRuleSetVersion(result.rows[0]!);
}

// ---------------- Validation Runs ----------------
export async function recordValidationRun(
  tx: Tx,
  ctx: RequestContext,
  runId: string,
  versionId: string,
  report: ValidationReport,
): Promise<ValidationReportResponse> {
  const tenantId = ctx.principal.tenantId;
  const actor = ctx.principal.id;

  const testSummary = report.testsSummary ?? { total: 0, passed: 0, failed: 0 };

  await sql`
    INSERT INTO app.rule_validation_run (
      id, tenant_id, version_id, content_hash, result, issues, tests_summary, run_by
    ) VALUES (
      ${runId}, ${tenantId}, ${versionId}, ${report.contentHash}, ${report.result},
      ${JSON.stringify(report.issues)}::jsonb, ${JSON.stringify(testSummary)}::jsonb, ${actor}
    )
  `.execute(tx);

  // If PASS, update last_validation_id on version
  if (report.result === 'PASS') {
    await sql`
      UPDATE app.rule_set_version
      SET last_validation_id = ${runId}
      WHERE id = ${versionId}
    `.execute(tx);
  }

  return {
    id: runId as ValidationReportResponse['id'],
    versionId,
    contentHash: report.contentHash,
    result: report.result,
    issues: report.issues.map((i) => ({
      code: i.code,
      severity: i.severity,
      message: i.message,
      ruleUid: i.ruleUid,
      path: i.path,
    })),
    testsSummary: testSummary,
    runBy: actor,
    runAt: new Date().toISOString(),
  };
}

export async function getLatestValidationReport(
  tx: Tx,
  _ctx: RequestContext,
  versionId: string,
): Promise<ValidationReportResponse | null> {
  const result = await sql<{
    id: string;
    version_id: string;
    content_hash: string;
    result: string;
    issues: unknown;
    tests_summary: unknown;
    run_by: string;
    run_at: string | Date;
  }>`
    SELECT * FROM app.rule_validation_run
    WHERE version_id = ${versionId}
    ORDER BY run_at DESC LIMIT 1
  `.execute(tx);

  const row = result.rows[0];
  if (!row) return null;

  return {
    id: row.id as ValidationReportResponse['id'],
    versionId: row.version_id,
    contentHash: row.content_hash,
    result: row.result as 'PASS' | 'FAIL',
    issues: Array.isArray(row.issues) ? (row.issues as ValidationReportResponse['issues']) : [],
    testsSummary: (row.tests_summary as ValidationReportResponse['testsSummary']) ?? {
      total: 0,
      passed: 0,
      failed: 0,
    },
    runBy: row.run_by,
    runAt: new Date(row.run_at).toISOString(),
  };
}

// ---------------- Simulations ----------------
export async function recordSimulation(
  tx: Tx,
  ctx: RequestContext,
  simId: string,
  versionId: string,
  input: CreateSimulationRequest,
  result: EvaluationResult,
): Promise<SimulationResponse> {
  const tenantId = ctx.principal.tenantId;
  const actor = ctx.principal.id;
  const version = await getRuleSetVersionById(tx, ctx, versionId);

  const status = result.status === 'ERROR' ? 'FAILED' : 'COMPLETED';
  const summary = {
    status: result.status,
    outputs: result.outputs,
    matchedRuleUids: result.matchedRuleUids,
    fallbackApplied: result.fallbackApplied,
    fallbackPolicy: result.fallbackPolicy,
    errorCode: result.errorCode,
    durationUs: result.durationUs,
    trace: result.trace,
  };

  await sql`
    INSERT INTO app.rule_simulation (
      id, tenant_id, kind, version_id, content_hash, params, status, summary, requested_by
    ) VALUES (
      ${simId}, ${tenantId}, 'MANUAL', ${versionId}, ${version.contentHash},
      ${JSON.stringify(input)}::jsonb, ${status}, ${JSON.stringify(summary)}::jsonb, ${actor}
    )
  `.execute(tx);

  return {
    id: simId as SimulationResponse['id'],
    tenantId,
    versionId,
    kind: 'MANUAL',
    contentHash: version.contentHash,
    status,
    summary,
    requestedBy: actor,
    createdAt: new Date().toISOString(),
  };
}

export async function getSimulationById(
  tx: Tx,
  _ctx: RequestContext,
  simId: string,
): Promise<SimulationResponse> {
  const result = await sql<{
    id: string;
    tenant_id: string;
    kind: string;
    version_id: string;
    content_hash: string;
    status: string;
    summary: unknown;
    requested_by: string;
    created_at: string | Date;
  }>`
    SELECT * FROM app.rule_simulation WHERE id = ${simId}
  `.execute(tx);

  const row = result.rows[0];
  if (!row) {
    throw AppError.of('NOT_FOUND', `Simulation '${simId}' not found.`);
  }

  return {
    id: row.id as SimulationResponse['id'],
    tenantId: row.tenant_id,
    versionId: row.version_id,
    kind: row.kind as 'MANUAL' | 'TEST_SUITE',
    contentHash: row.content_hash,
    status: row.status as 'COMPLETED' | 'FAILED',
    summary: (row.summary as SimulationResponse['summary']) ?? {
      status: 'OK',
      outputs: null,
      matchedRuleUids: [],
      fallbackApplied: false,
      durationUs: 0,
    },
    requestedBy: row.requested_by,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

// ---------------- Test Cases ----------------
export async function listTestCases(
  tx: Tx,
  _ctx: RequestContext,
  ruleSetId: string,
): Promise<TestCaseResponse[]> {
  const result = await sql<{
    id: string;
    tenant_id: string;
    rule_set_id: string;
    name: string;
    evaluation_time: string | Date;
    scope: unknown;
    input: unknown;
    expected_status: string;
    expected_output: unknown;
    active: boolean;
    lock_version: number;
    created_at: string | Date;
    created_by: string;
    updated_at: string | Date;
    updated_by: string;
  }>`
    SELECT * FROM app.rule_test_case WHERE rule_set_id = ${ruleSetId} ORDER BY created_at ASC
  `.execute(tx);

  return result.rows.map((r) => ({
    id: r.id as TestCaseResponse['id'],
    tenantId: r.tenant_id,
    ruleSetId: r.rule_set_id,
    name: r.name,
    evaluationTime: new Date(r.evaluation_time).toISOString(),
    scope: (r.scope as Record<string, unknown>) ?? {},
    input: (r.input as Record<string, unknown>) ?? {},
    expectedStatus: r.expected_status as TestCaseResponse['expectedStatus'],
    expectedOutput: (r.expected_output as Record<string, unknown>) ?? {},
    active: Boolean(r.active),
    lockVersion: Number(r.lock_version ?? 0),
    createdAt: new Date(r.created_at).toISOString(),
    createdBy: r.created_by,
    updatedAt: new Date(r.updated_at).toISOString(),
    updatedBy: r.updated_by,
  }));
}

export async function createTestCase(
  tx: Tx,
  ctx: RequestContext,
  testCaseId: string,
  ruleSetId: string,
  input: CreateTestCaseRequest,
): Promise<TestCaseResponse> {
  const tenantId = ctx.principal.tenantId;
  const actor = ctx.principal.id;
  const evalTime = input.evaluationTime ? new Date(input.evaluationTime) : new Date();

  const result = await sql<{
    id: string;
    tenant_id: string;
    rule_set_id: string;
    name: string;
    evaluation_time: string | Date;
    scope: unknown;
    input: unknown;
    expected_status: string;
    expected_output: unknown;
    active: boolean;
    lock_version: number;
    created_at: string | Date;
    created_by: string;
    updated_at: string | Date;
    updated_by: string;
  }>`
    INSERT INTO app.rule_test_case (
      id, tenant_id, rule_set_id, name, evaluation_time, scope, input, expected_status, expected_output,
      active, created_by, updated_by
    ) VALUES (
      ${testCaseId}, ${tenantId}, ${ruleSetId}, ${input.name}, ${evalTime}, ${JSON.stringify(input.scope)}::jsonb,
      ${JSON.stringify(input.input)}::jsonb, ${input.expectedStatus}, ${JSON.stringify(input.expectedOutput)}::jsonb,
      ${input.active}, ${actor}, ${actor}
    ) RETURNING *
  `.execute(tx);

  const r = result.rows[0]!;
  return {
    id: r.id as TestCaseResponse['id'],
    tenantId: r.tenant_id,
    ruleSetId: r.rule_set_id,
    name: r.name,
    evaluationTime: new Date(r.evaluation_time).toISOString(),
    scope: (r.scope as Record<string, unknown>) ?? {},
    input: (r.input as Record<string, unknown>) ?? {},
    expectedStatus: r.expected_status as TestCaseResponse['expectedStatus'],
    expectedOutput: (r.expected_output as Record<string, unknown>) ?? {},
    active: Boolean(r.active),
    lockVersion: Number(r.lock_version ?? 0),
    createdAt: new Date(r.created_at).toISOString(),
    createdBy: r.created_by,
    updatedAt: new Date(r.updated_at).toISOString(),
    updatedBy: r.updated_by,
  };
}

export async function updateTestCase(
  tx: Tx,
  ctx: RequestContext,
  testCaseId: string,
  ifMatch: number,
  input: UpdateTestCaseRequest,
): Promise<TestCaseResponse> {
  const actor = ctx.principal.id;

  const currentRes = await sql<{
    id: string;
    tenant_id: string;
    rule_set_id: string;
    name: string;
    evaluation_time: string | Date;
    scope: unknown;
    input: unknown;
    expected_status: string;
    expected_output: unknown;
    active: boolean;
    lock_version: number;
    created_at: string | Date;
    created_by: string;
    updated_at: string | Date;
    updated_by: string;
  }>`
    SELECT * FROM app.rule_test_case WHERE id = ${testCaseId} FOR UPDATE
  `.execute(tx);

  const current = currentRes.rows[0];
  if (!current) {
    throw AppError.of('NOT_FOUND', `Test case '${testCaseId}' not found.`);
  }

  if (Number(current.lock_version) !== ifMatch) {
    throw AppError.of('VERSION_CONFLICT', 'Test case modified by another user.', [
      { field: 'If-Match', issue: 'STALE', meta: { currentVersion: current.lock_version } },
    ]);
  }

  const result = await sql<{
    id: string;
    tenant_id: string;
    rule_set_id: string;
    name: string;
    evaluation_time: string | Date;
    scope: unknown;
    input: unknown;
    expected_status: string;
    expected_output: unknown;
    active: boolean;
    lock_version: number;
    created_at: string | Date;
    created_by: string;
    updated_at: string | Date;
    updated_by: string;
  }>`
    UPDATE app.rule_test_case
    SET
      name = ${input.name ?? current.name},
      input = ${input.input ? JSON.stringify(input.input) : JSON.stringify(current.input)}::jsonb,
      expected_status = ${input.expectedStatus ?? current.expected_status},
      expected_output = ${input.expectedOutput ? JSON.stringify(input.expectedOutput) : JSON.stringify(current.expected_output)}::jsonb,
      active = ${input.active ?? current.active},
      updated_by = ${actor}
    WHERE id = ${testCaseId}
    RETURNING *
  `.execute(tx);

  const r = result.rows[0]!;
  return {
    id: r.id as TestCaseResponse['id'],
    tenantId: r.tenant_id,
    ruleSetId: r.rule_set_id,
    name: r.name,
    evaluationTime: new Date(r.evaluation_time).toISOString(),
    scope: (r.scope as Record<string, unknown>) ?? {},
    input: (r.input as Record<string, unknown>) ?? {},
    expectedStatus: r.expected_status as TestCaseResponse['expectedStatus'],
    expectedOutput: (r.expected_output as Record<string, unknown>) ?? {},
    active: Boolean(r.active),
    lockVersion: Number(r.lock_version ?? 0),
    createdAt: new Date(r.created_at).toISOString(),
    createdBy: r.created_by,
    updatedAt: new Date(r.updated_at).toISOString(),
    updatedBy: r.updated_by,
  };
}

// ---------------- Lifecycle Operations ----------------
export async function submitVersion(
  tx: Tx,
  ctx: RequestContext,
  versionId: string,
  input: SubmitVersionRequest,
): Promise<RuleSetVersionResponse> {
  const actor = ctx.principal.id;
  const version = await getRuleSetVersionById(tx, ctx, versionId);

  if (version.status !== 'DRAFT') {
    throw AppError.of(
      'INVALID_TRANSITION',
      `Cannot submit version '${versionId}' in status '${version.status}'. Must be in DRAFT status.`,
    );
  }

  // Ensure validation evidence exists and matches current content_hash
  const latestValidation = await getLatestValidationReport(tx, ctx, versionId);
  if (!latestValidation) {
    throw AppError.of('EVIDENCE_MISSING', 'Version must pass validation before being submitted for review.');
  }
  if (latestValidation.result !== 'PASS' || latestValidation.contentHash !== version.contentHash) {
    throw AppError.of(
      'VALIDATION_STALE',
      'Validation report is stale or failing. Please re-run validation before submitting.',
    );
  }

  const now = new Date();
  const result = await sql<RawRuleSetVersionRow>`
    UPDATE app.rule_set_version
    SET
      status = 'IN_REVIEW',
      change_reason = ${input.changeReason},
      submitted_by = ${actor},
      submitted_at = ${now}
    WHERE id = ${versionId}
    RETURNING *
  `.execute(tx);

  // Write frozen rule rows into rule_set_rule
  for (let i = 0; i < version.definition.rules.length; i++) {
    const r = version.definition.rules[i]!;
    await sql`
      INSERT INTO app.rule_set_rule (
        tenant_id, version_id, rule_uid, name, order_no, priority, enabled
      ) VALUES (
        ${ctx.principal.tenantId}, ${versionId}, ${r.uid}, ${r.name},
        ${r.orderNo ?? (version.hitPolicy !== 'PRIORITY' ? i : null)},
        ${r.priority ?? (version.hitPolicy === 'PRIORITY' ? 0 : null)},
        ${r.enabled}
      ) ON CONFLICT (version_id, rule_uid) DO NOTHING
    `.execute(tx);
  }

  return formatRuleSetVersion(result.rows[0]!);
}

export async function reviewVersion(
  tx: Tx,
  ctx: RequestContext,
  approvalId: string,
  versionId: string,
  input: ReviewVersionRequest,
): Promise<RuleSetVersionResponse> {
  const actor = ctx.principal.id;
  const tenantId = ctx.principal.tenantId;
  const version = await getRuleSetVersionById(tx, ctx, versionId);

  if (version.status !== 'IN_REVIEW') {
    throw AppError.of(
      'INVALID_TRANSITION',
      `Cannot review version '${versionId}' in status '${version.status}'. Version must be IN_REVIEW.`,
    );
  }

  // Maker-Checker (SOD-01): User in editors array cannot approve their own version
  if (input.action === 'APPROVE' && version.editors.includes(actor)) {
    throw AppError.of(
      'SOD_VIOLATION',
      'SOD-01 Maker-checker violation: Authors and editors are prohibited from approving their own rule version.',
    );
  }

  // Hash match check: Approval decision must refer to exact content hash under review
  if (input.reviewedContentHash !== version.contentHash) {
    throw AppError.of(
      'CONTENT_HASH_MISMATCH',
      'Reviewed content hash does not match active version content hash.',
    );
  }

  // Record approval in rule_approval
  await sql`
    INSERT INTO app.rule_approval (
      id, tenant_id, version_id, seat, approver_id, action, comment, content_hash
    ) VALUES (
      ${approvalId}, ${tenantId}, ${versionId}, ${input.seat}, ${actor},
      ${input.action}, ${input.comment}, ${input.reviewedContentHash}
    )
  `.execute(tx);

  const nextStatus =
    input.action === 'APPROVE' ? 'APPROVED' : input.action === 'REJECT' ? 'REJECTED' : 'DRAFT';

  const result = await sql<RawRuleSetVersionRow>`
    UPDATE app.rule_set_version
    SET status = ${nextStatus}
    WHERE id = ${versionId}
    RETURNING *
  `.execute(tx);

  return formatRuleSetVersion(result.rows[0]!);
}

export async function publishVersion(
  tx: Tx,
  ctx: RequestContext,
  pubId: string,
  versionId: string,
  input: PublishVersionRequest,
): Promise<RuleSetVersionResponse> {
  const actor = ctx.principal.id;
  const tenantId = ctx.principal.tenantId;
  const version = await getRuleSetVersionById(tx, ctx, versionId);

  if (version.status !== 'APPROVED') {
    throw AppError.of(
      'INVALID_TRANSITION',
      `Cannot publish version '${versionId}' with status '${version.status}'. Must be in APPROVED status.`,
    );
  }

  // Reject publication if validation evidence is missing or stale
  const latestValidation = await getLatestValidationReport(tx, ctx, versionId);
  if (
    !latestValidation ||
    latestValidation.result !== 'PASS' ||
    latestValidation.contentHash !== version.contentHash
  ) {
    throw AppError.of('VALIDATION_STALE', 'Validation report is missing or stale. Re-validation required.');
  }

  const effectiveFrom = input.effectiveFrom ? new Date(input.effectiveFrom) : new Date();
  const isFuture = effectiveFrom.getTime() > Date.now() + 60000;
  const targetStatus = isFuture ? 'SCHEDULED' : 'ACTIVE';

  // Supersede existing ACTIVE version in the same rule_set
  if (targetStatus === 'ACTIVE') {
    await sql`
      UPDATE app.rule_set_version
      SET status = 'SUPERSEDED'
      WHERE rule_set_id = ${version.ruleSetId} AND status = 'ACTIVE'
    `.execute(tx);
  }

  const result = await sql<RawRuleSetVersionRow>`
    UPDATE app.rule_set_version
    SET
      status = ${targetStatus},
      published_by = ${actor},
      published_at = ${new Date()},
      effective_range = tstzrange(${effectiveFrom}, ${input.effectiveTo ? new Date(input.effectiveTo) : null}, '[)')
    WHERE id = ${versionId}
    RETURNING *
  `.execute(tx);

  // Record publication audit
  await sql`
    INSERT INTO app.rule_publication (
      id, tenant_id, version_id, action, actor_id, reason, effective_from
    ) VALUES (
      ${pubId}, ${tenantId}, ${versionId}, ${targetStatus === 'SCHEDULED' ? 'SCHEDULE' : 'PUBLISH'},
      ${actor}, ${input.reason}, ${effectiveFrom}
    )
  `.execute(tx);

  return formatRuleSetVersion(result.rows[0]!);
}

export async function suspendVersion(
  tx: Tx,
  ctx: RequestContext,
  pubId: string,
  versionId: string,
  input: SuspendVersionRequest,
): Promise<RuleSetVersionResponse> {
  const actor = ctx.principal.id;
  const tenantId = ctx.principal.tenantId;
  const version = await getRuleSetVersionById(tx, ctx, versionId);

  if (version.status !== 'ACTIVE' && version.status !== 'SCHEDULED') {
    throw AppError.of(
      'INVALID_TRANSITION',
      `Cannot suspend version '${versionId}' in status '${version.status}'. Must be ACTIVE or SCHEDULED.`,
    );
  }

  const now = new Date();
  const result = await sql<RawRuleSetVersionRow>`
    UPDATE app.rule_set_version
    SET
      status = 'SUSPENDED',
      suspended_by = ${actor},
      suspended_at = ${now},
      suspend_reason = ${input.suspendReason}
    WHERE id = ${versionId}
    RETURNING *
  `.execute(tx);

  await sql`
    INSERT INTO app.rule_publication (
      id, tenant_id, version_id, action, actor_id, reason
    ) VALUES (
      ${pubId}, ${tenantId}, ${versionId}, 'SUSPEND', ${actor}, ${input.suspendReason}
    )
  `.execute(tx);

  return formatRuleSetVersion(result.rows[0]!);
}

export async function reinstateVersion(
  tx: Tx,
  ctx: RequestContext,
  pubId: string,
  versionId: string,
  input: ReinstateVersionRequest,
): Promise<RuleSetVersionResponse> {
  const actor = ctx.principal.id;
  const tenantId = ctx.principal.tenantId;
  const version = await getRuleSetVersionById(tx, ctx, versionId);

  if (version.status !== 'SUSPENDED') {
    throw AppError.of(
      'INVALID_TRANSITION',
      `Cannot reinstate version '${versionId}' in status '${version.status}'. Must be in SUSPENDED status.`,
    );
  }

  // Separation of duties: User who suspended cannot reinstate
  if (version.suspendedBy === actor) {
    throw AppError.of(
      'SOD_VIOLATION',
      'Separation of duties: The user who suspended this rule set version cannot reinstate it.',
    );
  }

  const result = await sql<RawRuleSetVersionRow>`
    UPDATE app.rule_set_version
    SET
      status = 'ACTIVE',
      suspended_by = NULL,
      suspended_at = NULL,
      suspend_reason = NULL
    WHERE id = ${versionId}
    RETURNING *
  `.execute(tx);

  await sql`
    INSERT INTO app.rule_publication (
      id, tenant_id, version_id, action, actor_id, reason
    ) VALUES (
      ${pubId}, ${tenantId}, ${versionId}, 'PUBLISH', ${actor}, ${input.reason}
    )
  `.execute(tx);

  return formatRuleSetVersion(result.rows[0]!);
}

export async function retireVersion(
  tx: Tx,
  ctx: RequestContext,
  versionId: string,
  input: RetireVersionRequest,
): Promise<RuleSetVersionResponse> {
  const version = await getRuleSetVersionById(tx, ctx, versionId);

  if (version.status === 'RETIRED' || version.status === 'ABANDONED') {
    throw AppError.of('INVALID_TRANSITION', `Version '${versionId}' is already ${version.status}.`);
  }

  const result = await sql<RawRuleSetVersionRow>`
    UPDATE app.rule_set_version
    SET
      status = 'RETIRED',
      change_reason = ${input.reason}
    WHERE id = ${versionId}
    RETURNING *
  `.execute(tx);

  return formatRuleSetVersion(result.rows[0]!);
}

export async function rollbackRuleSet(
  tx: Tx,
  ctx: RequestContext,
  pubId: string,
  ruleSetId: string,
  input: RollbackRequest,
): Promise<RuleSetVersionResponse> {
  const actor = ctx.principal.id;
  const tenantId = ctx.principal.tenantId;

  const target = await getRuleSetVersionById(tx, ctx, input.targetVersionId);
  if (target.ruleSetId !== ruleSetId) {
    throw AppError.of(
      'NOT_FOUND',
      `Target version '${input.targetVersionId}' does not belong to rule set '${ruleSetId}'.`,
    );
  }

  // Target version must have been previously published (SUPERSEDED, RETIRED, or APPROVED)
  if (!['SUPERSEDED', 'APPROVED', 'RETIRED'].includes(target.status)) {
    throw AppError.of(
      'INVALID_TRANSITION',
      `Cannot rollback to target version with status '${target.status}'. Target must be previously approved or superseded.`,
    );
  }

  // Supersede currently ACTIVE version
  await sql`
    UPDATE app.rule_set_version
    SET status = 'SUPERSEDED'
    WHERE rule_set_id = ${ruleSetId} AND status = 'ACTIVE'
  `.execute(tx);

  // Reinstate target to ACTIVE
  const now = new Date();
  const result = await sql<RawRuleSetVersionRow>`
    UPDATE app.rule_set_version
    SET
      status = 'ACTIVE',
      published_by = ${actor},
      published_at = ${now},
      effective_range = tstzrange(${now}, NULL, '[)')
    WHERE id = ${target.id}
    RETURNING *
  `.execute(tx);

  await sql`
    INSERT INTO app.rule_publication (
      id, tenant_id, version_id, action, actor_id, reason, effective_from
    ) VALUES (
      ${pubId}, ${tenantId}, ${target.id}, 'PUBLISH', ${actor}, ${input.reason}, ${now}
    )
  `.execute(tx);

  return formatRuleSetVersion(result.rows[0]!);
}

// ---------------- Decision Records ----------------
export async function recordDecisionRecord(
  tx: Tx,
  ctx: RequestContext,
  record: DecisionRecordResponse,
): Promise<DecisionRecordResponse> {
  await sql`
    INSERT INTO app.decision_record (
      id, tenant_id, decision_key, rule_set_version_id, subject_type, subject_id,
      evaluation_time, idempotency_key, input_hash, input_snapshot, outputs,
      matched_rule_uids, missing_fields, status, fallback_applied, fallback_policy,
      error_code, trace, duration_us, correlation_id
    ) VALUES (
      ${record.id}, ${ctx.principal.tenantId}, ${record.decisionKey},
      ${record.ruleSetVersionId ?? null}, ${record.subjectType}, ${record.subjectId},
      ${new Date(record.evaluationTime)}, ${record.idempotencyKey}, ${record.inputHash},
      ${JSON.stringify(record.inputSnapshot)}::jsonb, ${record.outputs ? JSON.stringify(record.outputs) : null}::jsonb,
      ${record.matchedRuleUids}, ${record.missingFields}, ${record.status},
      ${record.fallbackApplied}, ${record.fallbackPolicy ?? null}, ${record.errorCode ?? null},
      ${JSON.stringify({})}::jsonb, ${record.durationUs}, ${record.correlationId}
    )
  `.execute(tx);

  return record;
}

export async function listDecisionRecords(
  tx: Tx,
  _ctx: RequestContext,
  query: DecisionRecordListQuery,
): Promise<{ data: DecisionRecordResponse[]; meta: { nextCursor: string | null; limit: number } }> {
  const conditions = [sql`1=1`];

  if (query.decisionKey) conditions.push(sql`decision_key = ${query.decisionKey}`);
  if (query.subjectType) conditions.push(sql`subject_type = ${query.subjectType}`);
  if (query.subjectId) conditions.push(sql`subject_id = ${query.subjectId}`);
  if (query.ruleSetVersionId) conditions.push(sql`rule_set_version_id = ${query.ruleSetVersionId}`);
  if (query.status) conditions.push(sql`status = ${query.status}`);
  if (query.cursor) conditions.push(sql`id < ${query.cursor}`);

  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);

  const result = await sql<{
    id: string;
    tenant_id: string;
    decision_key: string;
    rule_set_version_id: string | null;
    subject_type: string;
    subject_id: string;
    evaluation_time: string | Date;
    idempotency_key: string;
    input_hash: string;
    input_snapshot: unknown;
    outputs: unknown;
    matched_rule_uids: string[];
    missing_fields: string[];
    status: string;
    fallback_applied: boolean;
    fallback_policy: string | null;
    error_code: string | null;
    duration_us: number;
    correlation_id: string;
    created_at: string | Date;
  }>`
    SELECT * FROM app.decision_record
    WHERE ${sql.join(conditions, sql` AND `)}
    ORDER BY created_at DESC, id DESC
    LIMIT ${limit + 1}
  `.execute(tx);

  const rows = result.rows;
  const hasMore = rows.length > limit;
  const dataRows = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore && dataRows.length > 0 ? dataRows[dataRows.length - 1]!.id : null;

  return {
    data: dataRows.map((r) => ({
      id: r.id as DecisionRecordResponse['id'],
      tenantId: r.tenant_id,
      decisionKey: r.decision_key,
      ruleSetVersionId: r.rule_set_version_id,
      subjectType: r.subject_type,
      subjectId: r.subject_id,
      evaluationTime: new Date(r.evaluation_time).toISOString(),
      idempotencyKey: r.idempotency_key,
      inputHash: r.input_hash,
      inputSnapshot: (r.input_snapshot as Record<string, unknown>) ?? {},
      outputs: (r.outputs as Record<string, unknown>) ?? null,
      matchedRuleUids: r.matched_rule_uids ?? [],
      missingFields: r.missing_fields ?? [],
      status: r.status as DecisionRecordResponse['status'],
      fallbackApplied: Boolean(r.fallback_applied),
      fallbackPolicy: (r.fallback_policy as DecisionRecordResponse['fallbackPolicy']) ?? null,
      errorCode: r.error_code ?? null,
      durationUs: Number(r.duration_us ?? 0),
      correlationId: r.correlation_id,
      createdAt: new Date(r.created_at).toISOString(),
    })),
    meta: {
      nextCursor,
      limit,
    },
  };
}

export async function getDecisionRecordById(
  tx: Tx,
  _ctx: RequestContext,
  id: string,
): Promise<DecisionRecordResponse> {
  const result = await sql<{
    id: string;
    tenant_id: string;
    decision_key: string;
    rule_set_version_id: string | null;
    subject_type: string;
    subject_id: string;
    evaluation_time: string | Date;
    idempotency_key: string;
    input_hash: string;
    input_snapshot: unknown;
    outputs: unknown;
    matched_rule_uids: string[];
    missing_fields: string[];
    status: string;
    fallback_applied: boolean;
    fallback_policy: string | null;
    error_code: string | null;
    duration_us: number;
    correlation_id: string;
    created_at: string | Date;
  }>`
    SELECT * FROM app.decision_record WHERE id = ${id}
  `.execute(tx);

  const r = result.rows[0];
  if (!r) {
    throw AppError.of('NOT_FOUND', `Decision record '${id}' not found.`);
  }

  return {
    id: r.id as DecisionRecordResponse['id'],
    tenantId: r.tenant_id,
    decisionKey: r.decision_key,
    ruleSetVersionId: r.rule_set_version_id,
    subjectType: r.subject_type,
    subjectId: r.subject_id,
    evaluationTime: new Date(r.evaluation_time).toISOString(),
    idempotencyKey: r.idempotency_key,
    inputHash: r.input_hash,
    inputSnapshot: (r.input_snapshot as Record<string, unknown>) ?? {},
    outputs: (r.outputs as Record<string, unknown>) ?? null,
    matchedRuleUids: r.matched_rule_uids ?? [],
    missingFields: r.missing_fields ?? [],
    status: r.status as DecisionRecordResponse['status'],
    fallbackApplied: Boolean(r.fallback_applied),
    fallbackPolicy: (r.fallback_policy as DecisionRecordResponse['fallbackPolicy']) ?? null,
    errorCode: r.error_code ?? null,
    durationUs: Number(r.duration_us ?? 0),
    correlationId: r.correlation_id,
    createdAt: new Date(r.created_at).toISOString(),
  };
}
