// apps/api/test/support/mock-rules-db.ts — owner: Developer 2 & 6 (Module 23: Business Rule Engine)
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
import type {
  RawDecisionDefinitionRow,
  RawRuleSetRow,
  RawRuleSetVersionRow,
} from '../../src/modules/rules/db';

export function createMockRulesStore() {
  const decisionDefinitions: RawDecisionDefinitionRow[] = [
    {
      key: 'DK-lead.duplicate',
      registry_version: '1-mvp',
      tier: 'T2',
      input_schema: { type: 'object' },
      output_schema: { type: 'object' },
      allowed_hit_policies: ['UNIQUE', 'FIRST', 'PRIORITY'],
      binding_mode: 'EVAL',
      fallback_policy: 'DEFAULT_OUTPUT',
      fallback_output: { classification: 'NONE', action: 'NONE', reasons: [] },
      unknown_policy: 'IGNORE',
      recording_level: 'ALWAYS',
      scope_chain: ['BRANCH', 'TENANT_DEFAULT'],
      overridable: true,
      enabled: true,
    },
    {
      key: 'DK-customer.duplicate',
      registry_version: '1-mvp',
      tier: 'T2',
      input_schema: { type: 'object' },
      output_schema: { type: 'object' },
      allowed_hit_policies: ['UNIQUE', 'FIRST', 'PRIORITY'],
      binding_mode: 'EVAL',
      fallback_policy: 'DEFAULT_OUTPUT',
      fallback_output: { classification: 'NONE', action: 'NONE', reasons: [] },
      unknown_policy: 'IGNORE',
      recording_level: 'ALWAYS',
      scope_chain: ['BRANCH', 'TENANT_DEFAULT'],
      overridable: true,
      enabled: true,
    },
    {
      key: 'DK-lead.assignment',
      registry_version: '1-mvp',
      tier: 'T2',
      input_schema: { type: 'object' },
      output_schema: { type: 'object' },
      allowed_hit_policies: ['UNIQUE', 'FIRST', 'PRIORITY'],
      binding_mode: 'EVAL',
      fallback_policy: 'DEFAULT_OUTPUT',
      fallback_output: { pool: { queueKind: 'UNASSIGNED' }, strategy: 'QUEUE_ONLY', reasonText: 'Default' },
      unknown_policy: 'IGNORE',
      recording_level: 'ALWAYS',
      scope_chain: ['BRANCH', 'TENANT_DEFAULT'],
      overridable: true,
      enabled: true,
    },
    {
      key: 'DK-sla.target',
      registry_version: '1-mvp',
      tier: 'T3',
      input_schema: { type: 'object' },
      output_schema: { type: 'object' },
      allowed_hit_policies: ['FIRST', 'PRIORITY'],
      binding_mode: 'EVAL',
      fallback_policy: 'DEFAULT_OUTPUT',
      fallback_output: { target_business_minutes: 1440, warning_pct: 80, calendar: 'ALWAYS' },
      unknown_policy: 'IGNORE',
      recording_level: 'ALWAYS',
      scope_chain: ['BRANCH', 'TENANT_DEFAULT'],
      overridable: true,
      enabled: true,
    },
    {
      key: 'DK-document.requirements',
      registry_version: '1-mvp',
      tier: 'T2',
      input_schema: { type: 'object' },
      output_schema: { type: 'object' },
      allowed_hit_policies: ['COLLECT', 'RULE_ORDER'],
      binding_mode: 'EVAL',
      fallback_policy: 'DEFAULT_OUTPUT',
      fallback_output: { documents: [{ typeCode: 'PAN_CARD', mandatory: true, count: 1, periodMonths: 0 }] },
      unknown_policy: 'IGNORE',
      recording_level: 'ALWAYS',
      scope_chain: ['LENDER', 'PRODUCT_VERSION', 'TENANT_DEFAULT'],
      overridable: true,
      enabled: true,
    },
    {
      key: 'DK-application.completeness',
      registry_version: '1-mvp',
      tier: 'T1',
      input_schema: { type: 'object' },
      output_schema: { type: 'object' },
      allowed_hit_policies: ['FIRST', 'UNIQUE'],
      binding_mode: 'EVAL',
      fallback_policy: 'DEFAULT_OUTPUT',
      fallback_output: { result: 'INCOMPLETE', reasons: [{ code: 'INITIAL', text: 'Incomplete' }] },
      unknown_policy: 'UNDETERMINED',
      recording_level: 'ALWAYS',
      scope_chain: ['PRODUCT_VERSION', 'TENANT_DEFAULT'],
      overridable: false,
      enabled: true,
    },
    {
      key: 'DK-application.eligibility',
      registry_version: '1-mvp',
      tier: 'T1',
      input_schema: { type: 'object' },
      output_schema: { type: 'object' },
      allowed_hit_policies: ['FIRST', 'PRIORITY', 'UNIQUE'],
      binding_mode: 'EVAL',
      fallback_policy: 'DEFAULT_OUTPUT',
      fallback_output: {
        result: 'REFER',
        maxEligibleAmount: null,
        reasons: [{ code: 'MANUAL_REVIEW', text: 'Application referred for underwriter review' }],
      },
      unknown_policy: 'UNDETERMINED',
      recording_level: 'ALWAYS',
      scope_chain: ['PRODUCT_VERSION', 'TENANT_DEFAULT'],
      overridable: true,
      enabled: true,
    },
  ];

  const decisionDependencies = [
    { decision_key: 'DK-application.completeness', depends_on_key: 'DK-document.requirements' },
    { decision_key: 'DK-application.completeness', depends_on_key: 'DK-application.eligibility' },
  ];

  const ruleSets: RawRuleSetRow[] = [];
  const ruleSetVersions: RawRuleSetVersionRow[] = [];
  const ruleSetRules: unknown[] = [];
  const ruleValidationRuns: Record<string, unknown>[] = [];
  const ruleSimulations: Record<string, unknown>[] = [];
  const ruleTestCases: Record<string, unknown>[] = [];
  const ruleApprovals: unknown[] = [];
  const rulePublications: unknown[] = [];
  const decisionRecords: Record<string, unknown>[] = [];

  let activeTenantId = 'ten_01JTESTTENANT00000000000000';

  const connection: DatabaseConnection = {
    async executeQuery<R>(compiledQuery: {
      sql: string;
      parameters: readonly unknown[];
    }): Promise<QueryResult<R>> {
      const sqlLower = compiledQuery.sql.toLowerCase();
      const params = compiledQuery.parameters;

      // set_config tenant_id
      if (sqlLower.includes('set_config') && sqlLower.includes('app.tenant_id')) {
        activeTenantId = String(params[0]);
        return { rows: [] };
      }

      // SELECT * FROM app.decision_definition WHERE key = ...
      if (sqlLower.includes('from app.decision_definition') && sqlLower.includes('where key =')) {
        const key = String(params[0]);
        const found = decisionDefinitions.find((d) => d.key === key);
        return { rows: (found ? [found] : []) as unknown as R[] };
      }

      // SELECT * FROM app.decision_definition
      if (sqlLower.includes('from app.decision_definition')) {
        return { rows: decisionDefinitions as unknown as R[] };
      }

      // SELECT depends_on_key FROM app.decision_dependency
      if (sqlLower.includes('from app.decision_dependency')) {
        if (sqlLower.includes('where decision_key =')) {
          const key = String(params[0]);
          const found = decisionDependencies.filter((d) => d.decision_key === key);
          return { rows: found as unknown as R[] };
        }
        return { rows: decisionDependencies as unknown as R[] };
      }

      // SELECT * FROM app.rule_set WHERE decision_key = ... AND scope_type = ...
      if (
        sqlLower.includes('from app.rule_set') &&
        !sqlLower.includes('rule_set_version') &&
        sqlLower.includes('decision_key =') &&
        sqlLower.includes('scope_type =')
      ) {
        const dKey = String(params[0]);
        const sType = String(params[1]);
        const sRef = params[2] === '-' ? null : String(params[2]);
        const found = ruleSets.find(
          (rs) =>
            rs.tenant_id === activeTenantId &&
            rs.decision_key === dKey &&
            rs.scope_type === sType &&
            (rs.scope_ref ?? null) === sRef,
        );
        return { rows: (found ? [found] : []) as unknown as R[] };
      }

      // SELECT * FROM app.rule_set WHERE id = ...
      if (
        sqlLower.includes('from app.rule_set') &&
        !sqlLower.includes('rule_set_version') &&
        sqlLower.includes('where id =')
      ) {
        const id = String(params[0]);
        const found = ruleSets.find((rs) => rs.id === id && rs.tenant_id === activeTenantId);
        return { rows: (found ? [found] : []) as unknown as R[] };
      }

      // SELECT rs.* FROM app.rule_set rs
      if (sqlLower.includes('from app.rule_set rs')) {
        let list = ruleSets.filter((rs) => rs.tenant_id === activeTenantId);
        if (sqlLower.includes('rs.decision_key =')) {
          const dKey = params.find((p) => typeof p === 'string' && p.startsWith('DK-'));
          if (dKey) list = list.filter((rs) => rs.decision_key === dKey);
        }
        if (sqlLower.includes('rs.status =')) {
          const st = params.find((p) => p === 'ACTIVE' || p === 'ARCHIVED');
          if (st) list = list.filter((rs) => rs.status === st);
        }
        list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        return { rows: list as unknown as R[] };
      }

      // INSERT INTO app.rule_set
      if (
        sqlLower.includes('insert into app.rule_set') &&
        !sqlLower.includes('rule_set_version') &&
        !sqlLower.includes('rule_set_rule')
      ) {
        const [id, tId, dKey, sType, sRef, name, owner, actor1, actor2] = params;
        const newRs: RawRuleSetRow = {
          id: String(id),
          tenant_id: String(tId),
          decision_key: String(dKey),
          scope_type: String(sType),
          scope_ref: (sRef as string) ?? null,
          name: String(name),
          owner_user_id: (owner as string) ?? null,
          origin: 'TENANT',
          status: 'ACTIVE',
          lock_version: 0,
          created_at: new Date(),
          created_by: String(actor1),
          updated_at: new Date(),
          updated_by: String(actor2),
        };
        ruleSets.push(newRs);
        return { rows: [newRs] as unknown as R[] };
      }

      // SELECT count(*) as count FROM app.rule_set_version WHERE rule_set_id = ... AND status = 'DRAFT'
      if (sqlLower.includes('from app.rule_set_version') && sqlLower.includes("status = 'draft'")) {
        const rsId = String(params[0]);
        const count = ruleSetVersions.filter((v) => v.rule_set_id === rsId && v.status === 'DRAFT').length;
        return { rows: [{ count: String(count) }] as unknown as R[] };
      }

      // SELECT coalesce(max(version_no), 0) as max_ver FROM app.rule_set_version
      if (sqlLower.includes('from app.rule_set_version') && sqlLower.includes('max(version_no)')) {
        const rsId = String(params[0]);
        const versions = ruleSetVersions.filter((v) => v.rule_set_id === rsId);
        const maxVer = versions.length > 0 ? Math.max(...versions.map((v) => v.version_no)) : 0;
        return { rows: [{ max_ver: maxVer }] as unknown as R[] };
      }

      // SELECT id, status FROM app.rule_set_version WHERE rule_set_id = ...
      if (sqlLower.includes('select id, status from app.rule_set_version where rule_set_id =')) {
        const rsId = String(params[0]);
        const versions = ruleSetVersions.filter((v) => v.rule_set_id === rsId);
        return { rows: versions.map((v) => ({ id: v.id, status: v.status })) as unknown as R[] };
      }

      // SELECT * FROM app.rule_set_version WHERE rule_set_id = ...
      if (sqlLower.includes('from app.rule_set_version') && sqlLower.includes('where rule_set_id =')) {
        const rsId = String(params[0]);
        const versions = ruleSetVersions
          .filter((v) => v.rule_set_id === rsId && v.tenant_id === activeTenantId)
          .sort((a, b) => b.version_no - a.version_no);
        return { rows: versions as unknown as R[] };
      }

      // SELECT * FROM app.rule_set_version WHERE id = ...
      if (sqlLower.includes('from app.rule_set_version') && sqlLower.includes('where id =')) {
        const id = String(params[0]);
        const found = ruleSetVersions.find((v) => v.id === id && v.tenant_id === activeTenantId);
        return { rows: (found ? [found] : []) as unknown as R[] };
      }

      // SELECT rsv.id, rsv.rule_set_id ... FROM app.rule_set rs JOIN app.rule_set_version rsv
      if (sqlLower.includes('from app.rule_set rs') && sqlLower.includes('join app.rule_set_version rsv')) {
        const dKey = String(params[0]);
        const sType = String(params[1]);
        const sRef = params[2] === '-' ? null : String(params[2]);

        for (const rs of ruleSets) {
          if (
            rs.tenant_id === activeTenantId &&
            rs.decision_key === dKey &&
            rs.scope_type === sType &&
            (rs.scope_ref ?? null) === sRef
          ) {
            const activeVer = ruleSetVersions.find((v) => v.rule_set_id === rs.id && v.status === 'ACTIVE');
            if (activeVer) {
              return {
                rows: [
                  {
                    id: activeVer.id,
                    rule_set_id: activeVer.rule_set_id,
                    definition: activeVer.definition,
                    hit_policy: activeVer.hit_policy,
                    content_hash: activeVer.content_hash,
                  },
                ] as unknown as R[],
              };
            }
          }
        }
        return { rows: [] };
      }

      // INSERT INTO app.rule_set_version
      if (sqlLower.includes('insert into app.rule_set_version')) {
        let newVer: RawRuleSetVersionRow;
        if (sqlLower.includes('authoring_form')) {
          // Initial draft version from createRuleSet: [initialVersionId, tenantId, id, def, hash, editors, actor]
          const [id, tId, rsId, def, hash, editors, createdBy] = params;
          newVer = {
            id: String(id),
            tenant_id: String(tId),
            rule_set_id: String(rsId),
            version_no: 1,
            status: 'DRAFT',
            hit_policy: 'FIRST',
            aggregator: null,
            authoring_form: 'RULES',
            definition:
              typeof def === 'string'
                ? JSON.parse(def)
                : (def as unknown as RawRuleSetVersionRow['definition']),
            default_output: null,
            content_hash: String(hash),
            effective_range: null,
            change_reason: null,
            lineage_version_id: null,
            editors: Array.isArray(editors) ? editors : [String(createdBy)],
            created_by: String(createdBy),
            created_at: new Date(),
            submitted_by: null,
            submitted_at: null,
            published_by: null,
            published_at: null,
            suspended_by: null,
            suspended_at: null,
            suspend_reason: null,
            last_validation_id: null,
            lock_version: 0,
          };
        } else {
          // New draft from createRuleSetVersion: [versionId, tenantId, ruleSetId, nextVerNo, hitPolicy, agg, def, hash, changeReason, lineageId, editors, actor]
          const [id, tId, rsId, verNo, hitPolicy, agg, def, hash, reason, lineageId, editors, createdBy] =
            params;
          newVer = {
            id: String(id),
            tenant_id: String(tId),
            rule_set_id: String(rsId),
            version_no: Number(verNo),
            status: 'DRAFT',
            hit_policy: String(hitPolicy ?? 'FIRST'),
            aggregator: (agg as string) ?? null,
            authoring_form: 'RULES',
            definition:
              typeof def === 'string'
                ? JSON.parse(def)
                : (def as unknown as RawRuleSetVersionRow['definition']),
            default_output: null,
            content_hash: String(hash),
            effective_range: null,
            change_reason: (reason as string) ?? null,
            lineage_version_id: (lineageId as string) ?? null,
            editors: Array.isArray(editors) ? editors : [String(createdBy)],
            created_by: String(createdBy),
            created_at: new Date(),
            submitted_by: null,
            submitted_at: null,
            published_by: null,
            published_at: null,
            suspended_by: null,
            suspended_at: null,
            suspend_reason: null,
            last_validation_id: null,
            lock_version: 0,
          };
        }
        ruleSetVersions.push(newVer);
        return { rows: [newVer] as unknown as R[] };
      }

      // UPDATE app.rule_set_version
      if (sqlLower.includes('update app.rule_set_version')) {
        if (sqlLower.includes('where rule_set_id =')) {
          const rsId = String(params[0]);
          const toUpdate = ruleSetVersions.filter(
            (v) => v.rule_set_id === rsId && v.tenant_id === activeTenantId,
          );
          if (sqlLower.includes("status = 'superseded'")) {
            toUpdate
              .filter((v) => v.status === 'ACTIVE')
              .forEach((v) => {
                v.status = 'SUPERSEDED';
              });
          }
          return { rows: [] };
        }

        const id = String(params[params.length - 1]);
        const found = ruleSetVersions.find((v) => v.id === id && v.tenant_id === activeTenantId);
        if (!found) return { rows: [] };

        if (sqlLower.includes('definition =')) {
          const [def, hitPolicy, agg, defOut, hash, reason, editors] = params;
          found.definition = typeof def === 'string' ? JSON.parse(def) : def;
          if (hitPolicy) found.hit_policy = String(hitPolicy);
          if (agg !== undefined) found.aggregator = (agg as string) ?? null;
          if (defOut !== undefined)
            found.default_output = defOut ? (typeof defOut === 'string' ? JSON.parse(defOut) : defOut) : null;
          found.content_hash = String(hash);
          if (reason !== undefined) found.change_reason = (reason as string) ?? null;
          if (Array.isArray(editors)) found.editors = editors;
          found.last_validation_id = null;
          found.lock_version += 1;
        } else if (sqlLower.includes('last_validation_id =')) {
          found.last_validation_id = String(params[0]);
        } else if (sqlLower.includes("status = 'in_review'")) {
          const [reason, actor, now] = params;
          found.status = 'IN_REVIEW';
          found.change_reason = String(reason);
          found.submitted_by = String(actor);
          found.submitted_at = now as Date;
        } else if (sqlLower.includes('published_by =')) {
          if (sqlLower.includes("status = 'active'")) {
            const [actor, now] = params;
            found.status = 'ACTIVE';
            found.published_by = String(actor);
            found.published_at = now as Date;
          } else {
            const [status, actor, now, _effFrom, _effTo] = params;
            found.status = String(status);
            found.published_by = String(actor);
            found.published_at = now as Date;
          }
        } else if (sqlLower.includes("status = 'suspended'")) {
          const [actor, now, reason] = params;
          found.status = 'SUSPENDED';
          found.suspended_by = String(actor);
          found.suspended_at = now as Date;
          found.suspend_reason = String(reason);
        } else if (sqlLower.includes('suspended_by = null')) {
          found.status = 'ACTIVE';
          found.suspended_by = null;
          found.suspended_at = null;
          found.suspend_reason = null;
        } else if (sqlLower.includes("status = 'retired'")) {
          const [reason] = params;
          found.status = 'RETIRED';
          found.change_reason = String(reason);
        } else if (sqlLower.includes("status = 'superseded'")) {
          found.status = 'SUPERSEDED';
        } else if (sqlLower.includes('status =')) {
          const nextStatus = String(params[0]);
          found.status = nextStatus;
          if (nextStatus === 'ACTIVE') {
            found.suspended_by = null;
            found.suspended_at = null;
            found.suspend_reason = null;
          }
        }

        return { rows: [found] as unknown as R[] };
      }

      // INSERT INTO app.rule_set_rule
      if (sqlLower.includes('insert into app.rule_set_rule')) {
        ruleSetRules.push(params);
        return { rows: [] };
      }

      // INSERT INTO app.rule_validation_run
      if (sqlLower.includes('insert into app.rule_validation_run')) {
        const [id, tId, vId, hash, res, issues, summary, actor] = params;
        ruleValidationRuns.push({
          id: String(id),
          tenant_id: String(tId),
          version_id: String(vId),
          content_hash: String(hash),
          result: String(res),
          issues: typeof issues === 'string' ? JSON.parse(issues) : issues,
          tests_summary: typeof summary === 'string' ? JSON.parse(summary) : summary,
          run_by: String(actor),
          run_at: new Date(),
        });
        return { rows: [] };
      }

      // SELECT * FROM app.rule_validation_run
      if (sqlLower.includes('from app.rule_validation_run')) {
        const vId = String(params[0]);
        const runs = ruleValidationRuns.filter((r) => r.version_id === vId);
        runs.sort(
          (a, b) =>
            new Date(b.run_at as string | number | Date).getTime() -
            new Date(a.run_at as string | number | Date).getTime(),
        );
        return { rows: (runs[0] ? [runs[0]] : []) as unknown as R[] };
      }

      // INSERT INTO app.rule_simulation
      if (sqlLower.includes('insert into app.rule_simulation')) {
        const [id, tId, vId, hash, pars, st, sum, actor] = params;
        const sim = {
          id: String(id),
          tenant_id: String(tId),
          kind: 'MANUAL',
          version_id: String(vId),
          content_hash: String(hash),
          params: typeof pars === 'string' ? JSON.parse(pars) : pars,
          status: String(st),
          summary: typeof sum === 'string' ? JSON.parse(sum) : sum,
          requested_by: String(actor),
          created_at: new Date(),
        };
        ruleSimulations.push(sim);
        return { rows: [sim] as unknown as R[] };
      }

      // SELECT * FROM app.rule_simulation WHERE id = ...
      if (sqlLower.includes('from app.rule_simulation where id =')) {
        const id = String(params[0]);
        const found = ruleSimulations.find((s) => s.id === id && s.tenant_id === activeTenantId);
        return { rows: (found ? [found] : []) as unknown as R[] };
      }

      // INSERT INTO app.rule_approval
      if (sqlLower.includes('insert into app.rule_approval')) {
        ruleApprovals.push(params);
        return { rows: [] };
      }

      // INSERT INTO app.rule_publication
      if (sqlLower.includes('insert into app.rule_publication')) {
        rulePublications.push(params);
        return { rows: [] };
      }

      // SELECT * FROM app.rule_test_case WHERE rule_set_id = ...
      if (sqlLower.includes('from app.rule_test_case where rule_set_id =')) {
        const rsId = String(params[0]);
        const list = ruleTestCases.filter((tc) => tc.rule_set_id === rsId && tc.tenant_id === activeTenantId);
        return { rows: list as unknown as R[] };
      }

      // SELECT * FROM app.rule_test_case WHERE id = ...
      if (sqlLower.includes('from app.rule_test_case where id =')) {
        const id = String(params[0]);
        const found = ruleTestCases.find((tc) => tc.id === id && tc.tenant_id === activeTenantId);
        return { rows: (found ? [found] : []) as unknown as R[] };
      }

      // INSERT INTO app.rule_test_case
      if (sqlLower.includes('insert into app.rule_test_case')) {
        const [id, tId, rsId, name, evalTime, scope, input, st, out, active, actor1, actor2] = params;
        const newTc = {
          id: String(id),
          tenant_id: String(tId),
          rule_set_id: String(rsId),
          name: String(name),
          evaluation_time: evalTime as Date,
          scope: typeof scope === 'string' ? JSON.parse(scope) : scope,
          input: typeof input === 'string' ? JSON.parse(input) : input,
          expected_status: String(st),
          expected_output: typeof out === 'string' ? JSON.parse(out) : out,
          active: Boolean(active),
          lock_version: 0,
          created_at: new Date(),
          created_by: String(actor1),
          updated_at: new Date(),
          updated_by: String(actor2),
        };
        ruleTestCases.push(newTc);
        return { rows: [newTc] as unknown as R[] };
      }

      // UPDATE app.rule_test_case
      if (sqlLower.includes('update app.rule_test_case')) {
        const id = String(params[params.length - 1]);
        const found = ruleTestCases.find((tc) => tc.id === id && tc.tenant_id === activeTenantId);
        if (!found) return { rows: [] };
        if (params[0]) found.name = String(params[0]);
        (found.lock_version as number) += 1;
        found.updated_at = new Date();
        return { rows: [found] as unknown as R[] };
      }

      // SELECT * FROM app.decision_record WHERE decision_key = ... AND idempotency_key = ...
      if (sqlLower.includes('from app.decision_record') && sqlLower.includes('idempotency_key =')) {
        const dKey = String(params[0]);
        const iKey = String(params[1]);
        const found = decisionRecords.find(
          (dr) => dr.tenant_id === activeTenantId && dr.decision_key === dKey && dr.idempotency_key === iKey,
        );
        return { rows: (found ? [found] : []) as unknown as R[] };
      }

      // INSERT INTO app.decision_record
      if (sqlLower.includes('insert into app.decision_record')) {
        const [
          id,
          tId,
          dKey,
          vId,
          subType,
          subId,
          evalTime,
          iKey,
          inHash,
          snap,
          out,
          matched,
          missing,
          st,
          fallApplied,
          fallPol,
          errCode,
          trace,
          dur,
          corrId,
        ] = params;

        const rec = {
          id: String(id),
          tenant_id: String(tId),
          decision_key: String(dKey),
          rule_set_version_id: (vId as string) ?? null,
          subject_type: String(subType),
          subject_id: String(subId),
          evaluation_time: evalTime as Date,
          idempotency_key: String(iKey),
          input_hash: String(inHash),
          input_snapshot: typeof snap === 'string' ? JSON.parse(snap) : snap,
          outputs: out ? (typeof out === 'string' ? JSON.parse(out) : out) : null,
          matched_rule_uids: Array.isArray(matched) ? matched : [],
          missing_fields: Array.isArray(missing) ? missing : [],
          status: String(st),
          fallback_applied: Boolean(fallApplied),
          fallback_policy: (fallPol as string) ?? null,
          error_code: (errCode as string) ?? null,
          trace: typeof trace === 'string' ? JSON.parse(trace) : trace,
          duration_us: Number(dur),
          correlation_id: String(corrId),
          created_at: new Date(),
        };
        decisionRecords.push(rec);
        return { rows: [rec] as unknown as R[] };
      }

      // SELECT * FROM app.decision_record WHERE id = ...
      if (sqlLower.includes('from app.decision_record where id =')) {
        const id = String(params[0]);
        const found = decisionRecords.find((dr) => dr.id === id && dr.tenant_id === activeTenantId);
        return { rows: (found ? [found] : []) as unknown as R[] };
      }

      // SELECT * FROM app.decision_record (list)
      if (sqlLower.includes('from app.decision_record')) {
        let list = decisionRecords.filter((dr) => dr.tenant_id === activeTenantId);
        if (sqlLower.includes('decision_key =')) {
          const dKey = params.find((p) => typeof p === 'string' && p.startsWith('DK-'));
          if (dKey) list = list.filter((dr) => dr.decision_key === dKey);
        }
        list.sort(
          (a, b) =>
            new Date(b.created_at as string | number | Date).getTime() -
            new Date(a.created_at as string | number | Date).getTime(),
        );
        return { rows: list as unknown as R[] };
      }

      return { rows: [] };
    },
    async *streamQuery() {
      yield { rows: [] };
    },
  };

  const driver: Driver = {
    async init() {},
    async acquireConnection() {
      return connection;
    },
    async releaseConnection() {},
    async destroy() {},
    async beginTransaction() {},
    async commitTransaction() {},
    async rollbackTransaction() {},
  };

  const db = new Kysely<Database>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });

  const runner: TxRunner = {
    async withTenantTx<T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
      activeTenantId = ctx.principal.tenantId;
      return fn(db as unknown as Tx);
    },
  };

  return {
    db,
    runner,
    decisionDefinitions,
    ruleSets,
    ruleSetVersions,
    ruleTestCases,
    ruleValidationRuns,
    ruleSimulations,
    decisionRecords,
  };
}
