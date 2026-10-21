// TEST-SEC-001 sweep map (owner: Dev 1). How the isolation sweep (cases/sweep.spec.ts) fills each path parameter of a /v1
// operation: with the id of a real tenant A row from the named table, or with a fixed literal when the parameter is not a
// record id (a code, a key, a period). The inventory (inventory.spec.ts INV-02) fails when an operation has a parameter
// this map cannot fill, so a new endpoint is swept from the day it is added.

/** `<segment>/{param}` → the table whose tenant A rows fill it. */
export const SEGMENT_TABLE: Record<string, string> = {
  'access-reviews': 'access_review',
  accounts: 'ledger_account',
  activities: 'activity',
  adjustments: 'adjustment',
  agents: 'app_user',
  'api-clients': 'api_client',
  applications: 'loan_application',
  'attribution-change-requests': 'attribution_change_request',
  'attribution-disputes': 'attribution_dispute',
  'audit-events': 'audit_event',
  automations: 'automation_definition',
  'automation-executions': 'automation_execution',
  'automation-versions': 'automation_version',
  'bank-accounts': 'connector_bank_account',
  branches: 'branch',
  calendars: 'business_calendar',
  clawbacks: 'adjustment',
  'commission-calculations': 'commission_calculation',
  'commission-plans': 'commission_plan',
  complaints: 'complaint',
  connectors: 'connector',
  consents: 'consent_record',
  contacts: 'customer_contact_point',
  customers: 'customer',
  'data-corrections': 'data_correction_request',
  'data-subject-requests': 'data_subject_request',
  'dead-letters': 'wfa_dead_letter',
  'decision-records': 'decision_record',
  delegations: 'delegation',
  disputes: 'dispute',
  'duplicate-reviews': 'duplicate_review',
  'document-archives': 'document_archive',
  'document-versions': 'document_version',
  documents: 'document',
  'eligibility-assessments': 'eligibility_assessment',
  empanelments: 'empanelment',
  'evidence-packs': 'evidence_pack',
  executions: 'automation_execution',
  exports: 'export_job',
  imports: 'import_batch',
  incidents: 'incident_record',
  invoices: 'invoice',
  leads: 'lead',
  'lender-cases': 'lender_case',
  'lender-queries': 'lender_query',
  'lender-statements': 'lender_statement',
  lenders: 'lender',
  organisations: 'organisation',
  'payout-batches': 'payout_batch',
  'payout-requests': 'payout_request',
  payouts: 'payout_request',
  'product-versions': 'loan_product_version',
  products: 'loan_product',
  'recalculation-proposals': 'recalculation_proposal',
  'reconciliation-exceptions': 'reconciliation_exception',
  'reference-lists': 'reference_list',
  'report-runs': 'report_run',
  'report-schedules': 'report_schedule',
  roles: 'role',
  'rule-set-versions': 'rule_set_version',
  'rule-sets': 'rule_set',
  'rule-simulations': 'rule_simulation',
  'rule-test-cases': 'rule_test_case',
  sanctions: 'sanction',
  shares: 'external_share',
  subscriptions: 'webhook_subscription',
  'support-access-requests': 'support_access_grant',
  targets: 'target',
  tasks: 'task',
  teams: 'team',
  tranches: 'disbursement_tranche',
  'upload-intents': 'upload_intent',
  'upload-links': 'upload_link',
  users: 'app_user',
  'verification-requests': 'verification_request',
  verifications: 'verification',
  versions: 'automation_version',
  'work-queues': 'work_queue',
};

/** Parameters that are not record ids: filled with a fixed value that is the same in every tenant. */
export const LITERAL_PARAMS: Record<string, string> = {
  code: 'pipeline',
  key: 'DK-lead.routing',
  decisionKey: 'DK-lead.routing',
  provider: 'whatsapp',
  class: 'R-LOAN',
  scope: 'TENANT',
  category: 'CALL_OUTCOME',
  period: '2026-10',
  stepIndex: '0',
};

export interface PathParam {
  segment: string;
  name: string;
}

export const pathParams = (p: string): PathParam[] =>
  [...p.matchAll(/\/([^/{}]+)\/\{([^}]+)\}/g)].map((m) => ({ segment: m[1]!, name: m[2]! }));

/** Why a parameter cannot be filled, or null when the map covers it. */
export function unmapped(param: PathParam): string | null {
  if (param.name in LITERAL_PARAMS) return null;
  if (param.segment in SEGMENT_TABLE) return null;
  return `${param.segment}/{${param.name}}`;
}
