// Governance flow for the demo seed: decisions and rule versions with their approvals and publication trail, audit,
// security and incident records, privacy requests, legal holds, retention, support access and data sharing.
// Synthetic data only (ASM-4D-06). Global catalogue rows (decision definitions, feature flags, releases) are
// written once by buildGlobal.
import type { Tables} from './types';
import { ANCHOR, at, ix, onDate, pad, sha256Hex } from './types';
import { type Tenant, idOf } from './tenant-core';
import { type Origination } from './origination';

/** Decision keys already in the migration catalogue (the MVP decision keys). The seed reuses them, never adds new keys. */
export const DECISION_KEYS = [
  'DK-application.completeness',
  'DK-application.eligibility',
  'DK-customer.duplicate',
  'DK-document.requirements',
  'DK-lead.assignment',
  'DK-lead.duplicate',
  'DK-sla.target',
] as const;
/** Eight rule sets per tenant: one per decision key, plus a branch-scoped override of lead assignment. */
const RULE_KEYS = [...DECISION_KEYS, 'DK-lead.assignment'] as const;

/**
 * Global rows the migrations do not already seed: dependencies between decision keys, the tenant-scoped feature
 * flags (tenant overrides reference (key, 'TENANT')) and platform releases. Decision definitions, master data and
 * worker queue state are already seeded by the migrations and are read, not written.
 */
export function buildGlobal(out: Tables): void {
  const d = ANCHOR;
  [
    ['DK-application.eligibility', 'DK-document.requirements'],
    ['DK-customer.duplicate', 'DK-lead.duplicate'],
    ['DK-lead.assignment', 'DK-lead.duplicate'],
    ['DK-lead.assignment', 'DK-sla.target'],
    ['DK-sla.target', 'DK-document.requirements'],
    ['DK-customer.duplicate', 'DK-application.eligibility'],
  ].forEach(([key, dependsOn]) =>
    out.add('decision_dependency', { decision_key: key, depends_on_key: dependsOn, required: true }),
  );

  const FLAGS: [string, string][] = [
    ['lead.duplicate_detection', 'Duplicate detection on lead intake'],
    ['lender.api_submission', 'Submit cases to lenders over API'],
    ['ledger.manual_posting', 'Manual journal posting (finance only)'],
    ['partner.api', 'Partner API endpoints'],
    ['automation.engine', 'Workflow automation engine'],
    ['eligibility.screen', 'Eligibility screen (decision D1 pending)'],
    ['connector.portal', 'Connector portal (deferred R3)'],
  ];
  FLAGS.forEach(([key, description], i) =>
    out.add('feature_flag', {
      key,
      scope: 'TENANT',
      value: true,
      owner: 'product',
      remove_by: i >= 5 ? onDate('2026-12-31') : null,
      description,
      lock_version: 1,
      updated_at: at(d, 2, i),
      updated_by: 'platform-operator-ops',
    }),
  );

  const RELEASES = ['v0.1.0', 'v0.2.0', 'v0.3.0', 'v0.4.0', 'v0.5.0', 'v0.6.0', 'v0.7.0', 'v0.8.0'] as const;
  RELEASES.forEach((version, i) =>
    out.add('platform_release', {
      version,
      status: i < 4 ? 'ARCHIVED' : i < 6 ? 'PUBLISHED' : i === 6 ? 'STAGING' : 'CANDIDATE',
      target_date: onDate('2026-08-01', i * 14),
      git_tag: i < 6 ? version : null,
      release_notes_ref: `notes/${version}.md`,
      rule_pack_version: `rules-${pad(i + 1)}`,
      migration_version: `2026101${pad(i + 1, 1)}`,
      gates: { rel001: i >= 2, rel002: i >= 3, rel003: i >= 4, rel004: i >= 5 },
      notes_summary: `Release ${version} (synthetic notes).`,
      lock_version: 1,
      updated_by: 'platform-operator-ops',
    }),
  );
}

export function buildGovernance(
  t: Tenant,
  out: Tables,
  o: Origination,
  staff: {
    owner: string;
    loanops: string;
    branchmgr: string;
    compliance: string;
    rm1: string;
    rm2: string;
    sales1: string;
    teammgr: string;
    ruleauthor: string;
  },
): void {
  const d = ANCHOR;
  const rm = [staff.rm1, staff.rm2];

  // Rule sets (one per decision key) and their versions. Version 1 is ACTIVE for every set; two drafts follow.
  RULE_KEYS.forEach((key, i) => {
    const branchScoped = i === RULE_KEYS.length - 1;
    out.add('rule_set', {
      id: idOf(t, 'rls', i + 1),
      tenant_id: t.id,
      decision_key: key,
      scope_type: branchScoped ? 'BRANCH' : 'TENANT_DEFAULT',
      scope_ref: branchScoped ? ix(t.branches, 'MUM01') : null,
      name: `${key.replace('DK-', '')} rules${branchScoped ? ' (MUM01 override)' : ' (tenant default)'}`,
      owner_user_id: staff.owner,
      origin: branchScoped ? 'TENANT' : 'PLATFORM_SEED',
      status: 'ACTIVE',
      lock_version: 0,
      created_by: staff.owner,
      updated_by: staff.owner,
    });
  });
  const versionRows: { id: string; set: number; no: number; status: string }[] = [];
  RULE_KEYS.forEach((_, i) =>
    versionRows.push({ id: idOf(t, 'rsv', i + 1), set: i, no: 1, status: 'ACTIVE' }),
  );
  versionRows.push(
    { id: idOf(t, 'rsv', 9), set: 0, no: 2, status: 'DRAFT' },
    { id: idOf(t, 'rsv', 10), set: 1, no: 2, status: 'DRAFT' },
  );
  versionRows.forEach((v) => {
    const active = v.status === 'ACTIVE';
    const hash = `sha256:${sha256Hex(`rsv-${t.tag}-${v.id}`)}`;
    out.add('rule_set_version', {
      id: v.id,
      tenant_id: t.id,
      rule_set_id: idOf(t, 'rls', v.set + 1),
      version_no: v.no,
      status: v.status,
      hit_policy: v.set % 2 === 0 ? 'FIRST' : 'UNIQUE',
      aggregator: null,
      authoring_form: v.set % 3 === 0 ? 'DECISION_TABLE' : 'RULES',
      definition: {
        rules: [
          { uid: `RUL-${pad(v.set + 1, 2)}-01`, when: { band: 'A' }, then: { outcome: 'PASS' } },
          { uid: `RUL-${pad(v.set + 1, 2)}-02`, when: { band: 'B' }, then: { outcome: 'REVIEW' } },
        ],
      },
      default_output: { outcome: 'UNDETERMINED' },
      content_hash: hash,
      effective_range: active ? `[${onDate('2026-04-01')}T00:00:00+05:30,)` : null,
      change_reason: active
        ? 'Initial published version (synthetic)'
        : v.status === 'DRAFT'
          ? null
          : 'Draft refinement (synthetic)',
      lineage_version_id: v.no > 1 ? idOf(t, 'rsv', v.set + 1) : null,
      editors: [staff.ruleauthor ?? staff.owner],
      created_by: staff.owner,
      submitted_by: active ? staff.owner : null,
      submitted_at: active ? at(d, 2, v.set) : null,
      published_by: active ? staff.owner : null,
      published_at: active ? at(d, 3, v.set) : null,
      suspended_by: null,
      suspended_at: null,
      suspend_reason: null,
      last_validation_id: null,
      lock_version: 0,
    });
  });
  RULE_KEYS.forEach((_, i) =>
    out.add('rule_set_rule', {
      tenant_id: t.id,
      version_id: idOf(t, 'rsv', i + 1),
      rule_uid: `RUL-${pad(i + 1, 2)}-01`,
      name: `Band A passes (${i + 1})`,
      order_no: 1,
      priority: null,
      enabled: true,
    }),
  );
  RULE_KEYS.forEach((key, i) =>
    out.add('rule_test_case', {
      id: idOf(t, 'rtc', i + 1),
      tenant_id: t.id,
      rule_set_id: idOf(t, 'rls', i + 1),
      name: `Band A case ${i + 1}`,
      evaluation_time: at(d, 5, i),
      scope: { tenant: t.id },
      input: { band: 'A', subjectKey: key },
      expected_status: 'OK',
      expected_output: { outcome: 'PASS' },
      active: true,
      created_by: staff.ruleauthor ?? staff.owner,
      updated_by: staff.ruleauthor ?? staff.owner,
    }),
  );
  for (let i = 0; i < 8; i += 1) {
    out.add('rule_simulation', {
      id: idOf(t, 'rsm', i + 1),
      tenant_id: t.id,
      kind: i % 2 === 0 ? 'MANUAL' : 'TEST_SUITE',
      version_id: idOf(t, 'rsv', i + 1),
      content_hash: `sha256:${sha256Hex(`sim-${t.tag}-${i}`)}`,
      params: { sampleSize: 25 },
      status: i === 5 ? 'FAILED' : 'COMPLETED',
      summary: { evaluated: 25, passed: i === 5 ? 20 : 25 },
      requested_by: staff.ruleauthor ?? staff.owner,
      created_at: at(d, 6, i),
    });
    out.add('rule_validation_run', {
      id: idOf(t, 'rvr', i + 1),
      tenant_id: t.id,
      version_id: idOf(t, 'rsv', i + 1),
      content_hash: `sha256:${sha256Hex(`val-${t.tag}-${i}`)}`,
      result: i === 5 ? 'FAIL' : 'PASS',
      issues: i === 5 ? [{ rule: 'RUL-06-02', message: 'overlapping band (synthetic)' }] : [],
      tests_summary: { total: 1, passed: i === 5 ? 0 : 1 },
      run_by: staff.ruleauthor ?? staff.owner,
      run_at: at(d, 6, i),
    });
    out.add('rule_approval', {
      id: idOf(t, 'rap', i + 1),
      tenant_id: t.id,
      version_id: idOf(t, 'rsv', i + 1),
      seat: ['RULE_APPROVER', 'COMMISSION_APPROVER', 'COMPLIANCE', 'PLATFORM'][i % 4],
      approver_id: staff.owner,
      action: i === 5 ? 'REQUEST_CHANGES' : 'APPROVE',
      comment:
        i === 5
          ? 'Band overlap must be fixed before approval (synthetic)'
          : 'Reviewed the simulation results (synthetic)',
      content_hash: `sha256:${sha256Hex(`val-${t.tag}-${i}`)}`,
      reviewed_simulation_ids: [idOf(t, 'rsm', i + 1)],
      created_at: at(d, 7, i),
    });
    out.add('rule_publication', {
      id: idOf(t, 'rpb', i + 1),
      tenant_id: t.id,
      version_id: idOf(t, 'rsv', i + 1),
      action: i < 6 ? 'PUBLISH' : i === 6 ? 'SCHEDULE' : 'SUPERSEDE',
      actor_id: staff.owner,
      reason: 'Published after approval (synthetic)',
      effective_from: at(d, 3, i),
      created_at: at(d, 3, i),
    });
  }

  // Decision records: the ids are the same ones the lead, applicant, checklist and reconciliation rows point at.
  for (let i = 0; i < 10; i += 1) {
    const status = i === 8 ? 'NO_MATCH' : i === 9 ? 'UNKNOWN' : 'OK';
    const subjectIsLead = i < 4;
    out.add('decision_record', {
      id: idOf(t, 'dr', 400 + i),
      tenant_id: t.id,
      decision_key: ix(RULE_KEYS, i % RULE_KEYS.length),
      rule_set_version_id: idOf(t, 'rsv', (i % RULE_KEYS.length) + 1),
      subject_type: subjectIsLead ? 'LEAD' : 'LOAN_APPLICATION',
      subject_id: subjectIsLead ? ix(o.leads, i) : ix(o.apps, i),
      evaluation_time: at(d, 10, i),
      idempotency_key: `dec-${t.tag}-${pad(400 + i)}`,
      input_hash: `sha256:${sha256Hex(`input-${t.tag}-${i}`)}`,
      input_snapshot: { band: i % 2 === 0 ? 'A' : 'B', subjectKey: i },
      outputs: status === 'OK' ? { outcome: i % 2 === 0 ? 'PASS' : 'REVIEW' } : null,
      matched_rule_uids: status === 'OK' ? [`RUL-${pad((i % 8) + 1, 2)}-01`] : [],
      missing_fields: status === 'UNKNOWN' ? ['bureauScore'] : [],
      status,
      fallback_applied: status === 'UNKNOWN',
      fallback_policy: status === 'UNKNOWN' ? 'DEFAULT_OUTPUT' : null,
      error_code: null,
      trace: { steps: 2, durationHint: 'synthetic' },
      duration_us: 900 + i * 40,
      correlation_id: `corr-dec-${t.tag}-${pad(i + 1)}`,
    });
  }

  // Audit trail. Rows are left unsealed (hash null); the sealing job fills prev_hash/hash in production.
  const auditRows: [string, string, string, string, string, string][] = [
    ['lead.created', 'lead', 'lead_create', 'USER', ix(rm, 0), ix(o.leads, 0)],
    ['lead.converted', 'lead', 'lead_convert', 'USER', ix(rm, 0), ix(o.leads, 0)],
    ['application.submitted', 'loan_application', 'application_submit', 'USER', staff.loanops, ix(o.apps, 4)],
    [
      'lender_case.status_changed',
      'lender_case',
      'lender_case_update',
      'USER',
      staff.loanops,
      ix(o.lenderCases, 0),
    ],
    [
      'disbursement.verified',
      'disbursement_tranche',
      'disbursement_verify',
      'USER',
      staff.owner,
      ix(o.tranches, 0).id,
    ],
    ['payout.approved', 'payout_request', 'payout_approve', 'USER', staff.owner, idOf(t, 'pay', 1)],
    ['user.role_granted', 'user_role_assignment', 'user_manage', 'USER', staff.owner, idOf(t, 'ura', 2)],
    ['config.updated', 'setting', 'config_manage', 'USER', staff.owner, idOf(t, 'set', 1)],
    [
      'automation.executed',
      'automation_execution',
      'automation_operate',
      'SERVICE',
      'SYSTEM:automation',
      idOf(t, 'aex', 1),
    ],
    ['report.generated', 'report_run', 'report_read', 'SERVICE', 'SYSTEM:reports', idOf(t, 'rpr', 1)],
  ];
  auditRows.forEach(([action, entity, perm, actorType, actor, entityId], i) =>
    out.add('audit_event', {
      id: idOf(t, 'aud', i + 1),
      tenant_id: t.id,
      occurred_at: at(d, 15, i),
      actor_type: actorType,
      actor_id: actor,
      action,
      entity_type: entity,
      entity_id: entityId,
      permission_used: perm,
      approval_ref:
        action.includes('approved') || action.includes('verified') ? `APR-${t.tag}-${pad(i + 1)}` : null,
      reason: 'Recorded during the demo cohort run (synthetic)',
      decision_record_id: null,
      before: { status: 'DRAFT' },
      after: { status: 'ACTIVE' },
      external_side_effect: action === 'report.generated',
      correlation_id: `corr-aud-${t.tag}-${pad(i + 1)}`,
      ip: '203.0.113.10',
      user_agent: 'dsa-web/demo (synthetic)',
      prev_hash: null,
      hash: null,
    }),
  );

  // Security events and incidents (the incident row is the one that needs a post-mortem reference).
  const secEvents: [string, string, string][] = [
    ['LOGIN_FAILED', 'rmpune', 'HIGH'],
    ['MFA_ENROLLED', 'owner', 'LOW'],
    ['ROLE_CHANGED', 'admin', 'MEDIUM'],
    ['EXPORT_DOWNLOADED', 'loanops', 'MEDIUM'],
    ['SUSPICIOUS_ACCESS', 'sales1', 'HIGH'],
    ['API_KEY_ROTATED', 'admin', 'LOW'],
    ['PERMISSION_DENIED', 'rm1', 'LOW'],
    ['SESSION_REVOKED', 'branchmgr', 'MEDIUM'],
  ];
  secEvents.forEach(([type, principal, severity], i) =>
    out.add('security_event', {
      id: idOf(t, 'sec', i + 1),
      tenant_id: t.id,
      type,
      principal,
      ip: `203.0.113.${20 + i}`,
      severity,
      details: { attempt: i + 1, channel: 'web' },
      created_at: at(d, 16, i),
    }),
  );
  const incidents: [string, string, string, boolean][] = [
    ['CREDENTIAL_EXPOSURE_SUSPECTED', 'HIGH', 'RESOLVED', false],
    ['ACCESS_REVIEW_OVERDUE', 'MEDIUM', 'CLOSED', false],
    ['BREACH_SUSPECTED_DOCUMENT_LINK', 'CRITICAL', 'CONTAINED', true],
    ['WEBHOOK_SIGNATURE_MISMATCH', 'LOW', 'OPEN', false],
    ['EXPORT_EXCESS_ROWS', 'MEDIUM', 'INVESTIGATING', true],
    ['DATA_CORRECTION_FAILED', 'LOW', 'RESOLVED', false],
    ['PARTNER_RATE_LIMIT_ABUSE', 'MEDIUM', 'OPEN', false],
    ['BACKUP_RESTORE_DRILL', 'LOW', 'CLOSED', false],
  ];
  incidents.forEach(([type, severity, status, personal], i) =>
    out.add('incident_record', {
      id: idOf(t, 'inc', i + 1),
      tenant_id: t.id,
      type,
      severity,
      detected_at: at(d, 17, i),
      personal_data_involved: personal,
      affected_tenants: [t.id],
      notifications: { dpo: status !== 'OPEN', regulator: false },
      status,
      post_mortem_ref:
        status === 'RESOLVED' || status === 'CLOSED' ? `PM-${t.tag.toUpperCase()}-${pad(i + 1)}` : null,
      lock_version: 0,
      created_by: staff.compliance,
      updated_by: staff.compliance,
    }),
  );

  // Support access: time-boxed (at most four hours) grants for platform support staff.
  const grants: [string, string, string, number][] = [
    ['support-agent-1', 'Investigate failing lender sync (synthetic)', 'ACTIVE', 0],
    ['support-agent-2', 'Review import errors (synthetic)', 'PENDING', 1],
    ['support-agent-3', 'Check webhook delivery (synthetic)', 'DENIED', 2],
    ['support-agent-1', 'Follow-up on exports (synthetic)', 'REVOKED', 3],
    ['support-agent-4', 'Verify rule publication (synthetic)', 'EXPIRED', 4],
    ['support-agent-2', 'Read-only audit query (synthetic)', 'ACTIVE', 5],
    ['support-agent-5', 'Investigate job backlog (synthetic)', 'PENDING', 6],
    ['support-agent-3', 'Config comparison (synthetic)', 'REVOKED', 7],
  ];
  grants.forEach(([support, reason, status, n], i) => {
    const start = at(d, 18, n);
    out.add('support_access_grant', {
      id: idOf(t, 'sag', i + 1),
      tenant_id: t.id,
      support_user_id: support,
      reason,
      expires_at: at(d, 18, n + 3),
      starts_at: start,
      status,
      approved_by: status === 'PENDING' ? null : staff.owner,
      approved_at: status === 'PENDING' ? null : at(d, 18, n),
      revoked_by: status === 'REVOKED' ? staff.owner : null,
      revoked_at: status === 'REVOKED' ? at(d, 18, n + 1) : null,
      scope: 'READ_METADATA_AND_CONFIG',
      incident_ref: `INC-${pad(n + 1, 4)}`,
      created_by: staff.owner,
    });
  });

  // Privacy: legal holds, retention rules, data subject requests, corrections, data sharing and external shares.
  const holdSubjects: [string, string][] = [
    ['LOAN_APPLICATION', ix(o.apps, 0)],
    ['CUSTOMER', ix(o.customers, 1)],
    ['LEAD', ix(o.leads, 3)],
    ['DOCUMENT', ix(o.documents, 0)],
    ['LOAN_APPLICATION', ix(o.apps, 2)],
    ['CUSTOMER', ix(o.customers, 2)],
    ['LEAD', ix(o.leads, 1)],
    ['LOAN_APPLICATION', ix(o.apps, 9)],
  ];
  holdSubjects.forEach(([subjectType, subjectId], i) =>
    out.add('legal_hold', {
      id: idOf(t, 'lhd', i + 1),
      tenant_id: t.id,
      subject_type: subjectType,
      subject_id: subjectId,
      reason: 'Litigation hold for the lender dispute (synthetic)',
      reference: `CASE-${pad(i + 1, 4)}`,
      placed_by: staff.compliance,
      placed_at: at(d, 14, i),
      released_by: i < 2 ? staff.owner : null,
      released_at: i < 2 ? at(d, 22, i) : null,
      release_reason: i < 2 ? 'Matter closed (synthetic)' : null,
      lock_version: 0,
    }),
  );
  const retention: [string, number, string, string][] = [
    ['R-LOAN', 96, 'LOAN_CLOSED', 'PURGE'],
    ['R-FIN', 84, 'RECORD_CLOSED', 'PURGE'],
    ['R-AUD', 120, 'RECORD_CREATED', 'ANONYMISE'],
    ['R-OPS', 36, 'RECORD_CREATED', 'PURGE'],
    ['R-SHORT', 6, 'RECORD_CREATED', 'PURGE'],
    ['R-CFG', 240, 'RELATIONSHIP_ENDED', 'ANONYMISE'],
  ];
  // One policy per data class per tenant (unique key), so six rows per tenant.
  retention.forEach(([dataClass, months, trigger, action], i) =>
    out.add('retention_policy', {
      id: idOf(t, 'rtp', i + 1),
      tenant_id: t.id,
      data_class: dataClass,
      retention_months: months,
      trigger_event: trigger,
      action,
      reason: 'Retention schedule approved by compliance (synthetic)',
      approved_by: staff.owner,
      approved_at: at(d, 1, i),
      lock_version: 0,
      created_by: staff.compliance,
      updated_by: staff.compliance,
    }),
  );
  const dsrTypes = [
    'ACCESS',
    'CORRECTION',
    'ERASURE',
    'GRIEVANCE',
    'CONSENT_WITHDRAWAL',
    'ACCESS',
    'CORRECTION',
    'ERASURE',
  ] as const;
  dsrTypes.forEach((type, i) => {
    const completed = i < 3;
    out.add('data_subject_request', {
      id: idOf(t, 'dsr', i + 1),
      tenant_id: t.id,
      subject_type: i % 2 === 0 ? 'CUSTOMER' : 'LEAD',
      subject_id: i % 2 === 0 ? ix(o.customers, i) : ix(o.leads, i),
      request_type: type,
      channel: ['EMAIL', 'PORTAL', 'PHONE', 'LETTER', 'IN_PERSON', 'EMAIL', 'PORTAL', 'PHONE'][i] as string,
      received_at: at(d, 12, i),
      due_at: at(d, 42, i),
      status: completed ? 'COMPLETED' : i === 5 ? 'REJECTED' : i === 6 ? 'IN_PROGRESS' : 'RECEIVED',
      decision: completed ? 'FULFILLED' : i === 5 ? 'DECLINED' : null,
      decision_reason: completed
        ? 'Copy of data provided (synthetic)'
        : i === 5
          ? 'Retention obligation applies (synthetic)'
          : null,
      response_package_key: completed ? `dsr/${t.tag}/pkg-${pad(i + 1)}.zip` : null,
      handled_by: staff.compliance,
      notes: null,
      completed_at: completed || i === 5 ? at(d, 16, i) : null,
      lock_version: 0,
      created_by: staff.compliance,
      updated_by: staff.compliance,
    });
  });
  for (let i = 0; i < 8; i += 1) {
    const status = [
      'APPROVED',
      'EXECUTED',
      'PENDING',
      'REJECTED',
      'FAILED',
      'APPROVED',
      'PENDING',
      'EXECUTED',
    ][i];
    out.add('data_correction_request', {
      id: idOf(t, 'dcr', i + 1),
      tenant_id: t.id,
      entity_type: 'customer',
      entity_id: ix(o.customers, i),
      field_name: i % 2 === 0 ? 'home_branch_id' : 'full_name',
      old_value: i % 2 === 0 ? 'old-branch' : 'Old Name',
      new_value: i % 2 === 0 ? 'new-branch' : 'New Name',
      reason: 'Customer asked to correct a typo (synthetic)',
      status,
      submitted_by: staff.compliance,
      approved_by: status === 'APPROVED' || status === 'EXECUTED' ? staff.owner : null,
      approved_at: status === 'APPROVED' || status === 'EXECUTED' ? at(d, 18, i) : null,
      lock_version: 1,
      created_by: staff.compliance,
      justification: 'Identity document shows the corrected spelling (synthetic)',
      script_ref: `scripts/correction-${pad(i + 1)}.sql`,
      target_entity: 'customer',
      change_description: 'Correct the stored value after dual approval (synthetic)',
      dry_run_diff_key: `diff/${t.tag}/${pad(i + 1)}.json`,
      dry_run_diff: '{"changes":1}',
      requested_by: staff.compliance,
      executed_at: status === 'EXECUTED' ? at(d, 19, i) : null,
      failure_reason: status === 'FAILED' ? 'Row locked by another process (synthetic)' : null,
    });
  }
  for (let i = 0; i < 8; i += 1) {
    out.add('data_sharing_record', {
      id: idOf(t, 'dsh', i + 1),
      tenant_id: t.id,
      subject_type: 'LOAN_APPLICATION',
      subject_id: ix(o.apps, i),
      recipient_type: 'LENDER',
      recipient_id: ix(o.lenders, i % o.lenders.length),
      purpose: i % 3 === 0 ? 'LENDER_SUBMISSION' : i % 3 === 1 ? 'PORTFOLIO_REVIEW' : 'AUDIT_INSPECTION',
      consent_ids: ix(o.customerConsentIds, i % o.customerConsentIds.length),
      items: { documents: 2 + (i % 3), fields: ['name', 'income', 'bank'] },
      channel: ['PORTAL', 'EMAIL', 'API', 'PHYSICAL'][i % 4],
      source_ref: `LC-SHARE-${pad(i + 1)}`,
      actor_id: ix(rm, i % 2),
      shared_at: at(d, 9, i),
    });
  }
  for (let i = 0; i < 8; i += 1) {
    out.add('external_share', {
      id: idOf(t, 'exs', i + 1),
      tenant_id: t.id,
      application_id: ix(o.apps, i),
      recipient_type: ['LENDER', 'LENDER', 'PARTNER', 'AUDITOR'][i % 4],
      recipient_id: ix(o.lenders, i % o.lenders.length),
      recipient_contact: { name: 'Credit desk (synthetic)', email: `desk${i + 1}@example.com` },
      purpose: ['LENDER_SUBMISSION', 'PORTFOLIO_REVIEW', 'AUDIT_INSPECTION'][i % 3],
      consent_ids: ix(o.customerConsentIds, i % o.customerConsentIds.length),
      manifest: { documents: 2, checksum: sha256Hex(`share-${t.tag}-${i}`) },
      expires_at: at(d, 30, i),
      revoked_at: i === 6 ? at(d, 20) : null,
      revoked_by: i === 6 ? staff.owner : null,
      access_count: i,
      data_sharing_record_id: idOf(t, 'dsh', i + 1),
      lock_version: 0,
      created_by: staff.compliance,
      updated_by: staff.compliance,
    });
  }
}
