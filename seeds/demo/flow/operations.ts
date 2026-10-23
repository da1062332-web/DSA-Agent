// Operations flow for the demo seed: tasks, activities follow-up, messages, automations, integrations, webhooks,
// partner API clients, background jobs, outbox, reports, exports, imports and dedupe keys. Synthetic data only.
import type { Tables} from './types';
import { ANCHOR, at, ix, mobileFor, onDate, pad, sha256Hex } from './types';
import { type Tenant, idOf } from './tenant-core';
import { type Origination } from './origination';

export function buildOperations(
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
  },
): void {
  const d = ANCHOR;
  const rm = [staff.rm1, staff.rm2];
  const who = (i: number) => ix(rm, i % 2);

  // Import batches: two lead imports and eight statement / customer imports (lender statements reference these).
  for (let i = 0; i < 10; i += 1) {
    const leadImport = i < 2;
    out.add('import_batch', {
      id: idOf(t, 'imp', i + 1),
      tenant_id: t.id,
      requester_id: leadImport ? staff.branchmgr : staff.loanops,
      target_entity: leadImport ? 'LEAD' : 'CUSTOMER',
      source_file_key: `imports/${t.tag}/${leadImport ? 'leads' : 'statement'}-${pad(i + 1)}.csv`,
      file_format: i % 3 === 2 ? 'XLSX' : 'CSV',
      file_size_bytes: 48000 + i * 1500,
      checksum_sha256: sha256Hex(`import-${t.tag}-${i}`),
      idempotency_key: `import-${t.tag}-${pad(i + 1, 4)}`,
      column_mapping: { name: 'Full name', mobile: 'Mobile', product: 'Product' },
      import_options: { skipDuplicates: true, dryRun: false },
      status: [
        'COMPLETED',
        'COMPLETED',
        'COMPLETED',
        'FAILED',
        'ROLLED_BACK',
        'READY',
        'PARSED',
        'MAPPED',
        'COMPLETED',
        'VALIDATING',
      ][i] as string,
      total_rows: 40 + i,
      valid_rows: 36 + i,
      invalid_rows: 4,
      imported_rows: i === 4 ? 0 : 36 + i,
      report_file_key: `imports/${t.tag}/report-${pad(i + 1)}.csv`,
      error_summary: i === 3 ? [{ row: 12, error: 'mobile number invalid (synthetic)' }] : [],
      preview_data: [{ name: 'Demo Applicant', mobile: mobileFor(t.tagDigit, 900 + i) }],
      committed_at: i < 3 || i === 8 ? at(d, 2, i) : null,
      rolled_back_at: i === 4 ? at(d, 3) : null,
      expires_at: at(d, 9, i),
      lock_version: 0,
    });
  }

  // Tasks: one per linked record type and status. Completed follow-up or call tasks carry an outcome code (DB rule).
  const taskRows: {
    type: string;
    title: string;
    linked: string;
    linkedId: string;
    status: string;
    owner: 'user' | 'queue';
    priority: string;
    sla: string | null;
  }[] = [
    {
      type: 'CALL',
      title: 'Call back on consent confirmation',
      linked: 'LEAD',
      linkedId: ix(o.leads, 3),
      status: 'COMPLETED',
      owner: 'user',
      priority: 'HIGH',
      sla: 'CUSTOMER_FIRST_CONTACT',
    },
    {
      type: 'FOLLOW_UP',
      title: 'Follow up on bank statement',
      linked: 'LEAD',
      linkedId: ix(o.leads, 4),
      status: 'OPEN',
      owner: 'user',
      priority: 'MEDIUM',
      sla: 'CUSTOMER_FOLLOW_UP',
    },
    {
      type: 'DOCUMENT_COLLECTION',
      title: 'Collect salary slips for application',
      linked: 'LOAN_APPLICATION',
      linkedId: ix(o.apps, 6),
      status: 'IN_PROGRESS',
      owner: 'queue',
      priority: 'HIGH',
      sla: 'CUSTOMER_FOLLOW_UP',
    },
    {
      type: 'LENDER_QUERY',
      title: 'Answer lender query on salary history',
      linked: 'LENDER_CASE',
      linkedId: ix(o.lenderCases, 5),
      status: 'OPEN',
      owner: 'user',
      priority: 'HIGH',
      sla: 'LENDER_QUERY',
    },
    {
      type: 'REVIEW',
      title: 'Review eligibility override',
      linked: 'LOAN_APPLICATION',
      linkedId: ix(o.apps, 6),
      status: 'OPEN',
      owner: 'queue',
      priority: 'MEDIUM',
      sla: 'INTERNAL_REVIEW',
    },
    {
      type: 'MEETING',
      title: 'Branch sales review meeting',
      linked: 'LEAD',
      linkedId: ix(o.leads, 0),
      status: 'SNOOZED',
      owner: 'user',
      priority: 'LOW',
      sla: null,
    },
    {
      type: 'GENERAL',
      title: 'Refresh KYC document for renewal',
      linked: 'LOAN_APPLICATION',
      linkedId: ix(o.apps, 1),
      status: 'CANCELLED',
      owner: 'user',
      priority: 'LOW',
      sla: null,
    },
    {
      type: 'LENDER_QUERY',
      title: 'Chase lender decision on submitted case',
      linked: 'LENDER_CASE',
      linkedId: ix(o.lenderCases, 4),
      status: 'IN_PROGRESS',
      owner: 'user',
      priority: 'MEDIUM',
      sla: 'LENDER_PROCESSING',
    },
    {
      type: 'CALL',
      title: 'Call customer about disbursement date',
      linked: 'LOAN_APPLICATION',
      linkedId: ix(o.apps, 0),
      status: 'COMPLETED',
      owner: 'user',
      priority: 'MEDIUM',
      sla: 'CUSTOMER_FOLLOW_UP',
    },
    {
      type: 'REVIEW',
      title: 'Document verifier review',
      linked: 'LOAN_APPLICATION',
      linkedId: ix(o.apps, 4),
      status: 'OPEN',
      owner: 'queue',
      priority: 'MEDIUM',
      sla: 'DOCUMENT_REVIEW',
    },
    {
      type: 'FOLLOW_UP',
      title: 'Follow up with connector on referral',
      linked: 'LEAD',
      linkedId: ix(o.leads, 6),
      status: 'OPEN',
      owner: 'user',
      priority: 'LOW',
      sla: 'CUSTOMER_FOLLOW_UP',
    },
    {
      type: 'GENERAL',
      title: 'Archive closed application file',
      linked: 'LOAN_APPLICATION',
      linkedId: ix(o.apps, 9),
      status: 'COMPLETED',
      owner: 'user',
      priority: 'LOW',
      sla: null,
    },
  ];
  taskRows.forEach((task, i) => {
    const completed = task.status === 'COMPLETED';
    out.add('task', {
      id: idOf(t, 'tsk', i + 1),
      tenant_id: t.id,
      type: task.type,
      title: task.title,
      owner_user_id: task.owner === 'user' ? who(i) : null,
      owner_queue_id: task.owner === 'queue' ? ix(t.queues, 'MUM01-LOANOPS') : null,
      linked_type: task.linked,
      linked_id: task.linkedId,
      branch_id: ix(t.branches, 'MUM01'),
      priority: task.priority,
      status: task.status,
      due_at: at(d, 14 + i, 10),
      sla_class: task.sla,
      sla_decision_record_id: null,
      sla_rule_version_id: null,
      outcome_code:
        completed && ['CALL', 'FOLLOW_UP'].includes(task.type) ? 'CONNECTED' : completed ? 'DONE' : null,
      completion_note: completed ? 'Completed during the demo cohort run (synthetic).' : null,
      completed_at: completed ? at(d, 13, i) : null,
      completed_by: completed ? who(i) : null,
      follow_up_task_id: null,
      idempotency_key: `task-${t.tag}-${pad(i + 1, 4)}`,
      created_by_source: i % 4 === 3 ? 'SYSTEM' : 'USER',
      tags: i % 2 === 0 ? ['priority'] : [],
      created_by: staff.branchmgr,
      updated_by: staff.branchmgr,
    });
  });

  // Notifications, one per recipient, in several categories; some read.
  const notifications: [string, string, string, string][] = [
    ['TASK', 'Call back on consent confirmation is due today', '/tasks/tsk_' + t.tag + '_001', ix(rm, 0)],
    ['LEAD', 'New lead assigned from the intake queue', `/leads/${ix(o.leads, 4)}`, ix(rm, 1)],
    ['APPLICATION', 'Application moved to documents pending', `/applications/${ix(o.apps, 6)}`, ix(rm, 0)],
    [
      'ALERT',
      'Lender query raised on a submitted case',
      `/lender-cases/${ix(o.lenderCases, 5)}`,
      staff.loanops,
    ],
    ['SYSTEM', 'Monthly commission statement is ready', '/commissions', staff.owner],
    ['TASK', 'Overdue follow-up on a lead', `/tasks/tsk_${t.tag}_002`, staff.branchmgr],
    ['LEAD', 'Duplicate lead needs review', `/duplicates/dup_${t.tag}_001`, staff.branchmgr],
    ['APPLICATION', 'Sanction letter uploaded', `/applications/${ix(o.apps, 2)}`, staff.loanops],
    ['SYSTEM', 'Report schedule created', '/reports', staff.owner],
    ['ALERT', 'Connector bank account awaiting approval', '/connectors', staff.owner],
    ['TASK', 'Task assigned to you from the team queue', '/tasks', staff.teammgr],
    ['LEAD', 'Lead converted to an application', `/applications/${ix(o.apps, 0)}`, ix(rm, 0)],
  ];
  notifications.forEach(([category, title, link, user], i) =>
    out.add('notification', {
      id: idOf(t, 'ntf', i + 1),
      tenant_id: t.id,
      user_id: user,
      category,
      title,
      deep_link: link,
      read_at: i % 3 === 0 ? null : at(d, 20, i),
      lock_version: 0,
      created_at: at(d, 19, i),
      updated_at: at(d, 20, i),
    }),
  );

  // Message templates and the messages sent from them. Recipients are stored hashed and masked.
  const templates: [string, string, string, string, string][] = [
    [
      'lead.first-contact',
      'SMS',
      'TRANSACTIONAL',
      'Hi {{name}}, our team will call you about your loan enquiry.',
      'name',
    ],
    [
      'lead.callback',
      'WHATSAPP',
      'TRANSACTIONAL',
      'Hello {{name}}, we tried to reach you. Reply to schedule a call.',
      'name',
    ],
    [
      'app.docs-pending',
      'EMAIL',
      'OPERATIONAL',
      'Dear {{name}}, please upload the documents listed in your application.',
      'name,applicationId',
    ],
    [
      'app.sanctioned',
      'EMAIL',
      'TRANSACTIONAL',
      'Dear {{name}}, your loan of {{amount}} has been sanctioned.',
      'name,amount',
    ],
    ['app.disbursed', 'SMS', 'TRANSACTIONAL', 'Your loan has been disbursed. Reference {{ref}}.', 'ref'],
    ['otp.upload', 'SMS', 'AUTHENTICATION', 'Your upload code is {{otp}}. Valid for 10 minutes.', 'otp'],
    ['promo.festive', 'EMAIL', 'MARKETING', 'Festive offers on personal loans, {{name}}.', 'name'],
    [
      'ops.query-raised',
      'EMAIL',
      'OPERATIONAL',
      'A lender query needs your response on case {{caseRef}}.',
      'caseRef',
    ],
  ];
  templates.forEach(([code, channel, category, body, vars], i) =>
    out.add('message_template', {
      id: idOf(t, 'mtp', i + 1),
      tenant_id: t.id,
      code,
      channel,
      language: 'en',
      category,
      body,
      variables: vars.split(','),
      provider_template_id: `prov-${t.tag}-${pad(i + 1)}`,
      version: 1,
      status: i === 6 ? 'DRAFT' : i === 7 ? 'DEPRECATED' : 'APPROVED',
      lock_version: 0,
      created_by: staff.owner,
      updated_by: staff.owner,
    }),
  );
  for (let i = 0; i < 8; i += 1) {
    const channel = ix(templates, i)[1];
    const subjectType = i < 4 ? 'LEAD' : i < 6 ? 'CUSTOMER' : 'LOAN_APPLICATION';
    const subjectId =
      subjectType === 'LEAD'
        ? ix(o.leads, i)
        : subjectType === 'CUSTOMER'
          ? ix(o.customers, i)
          : ix(o.apps, i);
    const status = ['DELIVERED', 'SENT', 'FAILED', 'UNDELIVERED', 'BLOCKED', 'QUEUED', 'DELIVERED', 'SENT'][
      i
    ];
    out.add('message', {
      id: idOf(t, 'msg', i + 1),
      tenant_id: t.id,
      direction: i === 6 ? 'INBOUND' : 'OUTBOUND',
      channel,
      subject_type: subjectType,
      subject_id: subjectId,
      template_version_id: idOf(t, 'mtp', i + 1),
      recipient_hash: sha256Hex(`recipient-${t.tag}-${i}`),
      recipient_masked: '+91 ****** ' + mobileFor(t.tagDigit, 100 + i).slice(-4),
      variables_redacted: { name: 'R****', otp: i === 5 ? '******' : undefined },
      provider: channel === 'EMAIL' ? 'ses-local' : 'sms-local',
      provider_message_id: status === 'BLOCKED' || status === 'QUEUED' ? null : `pm-${t.tag}-${pad(i + 1)}`,
      status,
      status_history: [
        { status: 'QUEUED', at: at(d, 21, i) },
        { status, at: at(d, 21, i) },
      ],
      blocked_reason: status === 'BLOCKED' ? 'Recipient opted out of marketing (synthetic)' : null,
      lock_version: 0,
      created_by: staff.owner,
      updated_by: staff.owner,
    });
  }

  // Automations: definitions, versions, executions and their steps, scheduled triggers and dead letters.
  const autoCodes: [string, string, string, string][] = [
    ['lead-first-contact-sla', 'EVENT', 'LEAD', 'ACTIVE'],
    ['lead-stale-reminder', 'SCHEDULE', 'LEAD', 'ACTIVE'],
    ['app-docs-pending-nudge', 'EVENT', 'LOAN_APPLICATION', 'ACTIVE'],
    ['app-sanction-notify', 'EVENT', 'LOAN_APPLICATION', 'INACTIVE'],
    ['lender-query-task', 'EVENT', 'LENDER_CASE', 'ACTIVE'],
    ['task-overdue-escalate', 'TIMER', 'TASK', 'DRAFT'],
    ['verification-watch', 'WATCH', 'VERIFICATION', 'ARCHIVED'],
    ['daily-digest', 'SCHEDULE', 'SYSTEM', 'ACTIVE'],
  ];
  autoCodes.forEach(([code, trigger, entity, status], i) =>
    out.add('automation_definition', {
      id: idOf(t, 'adf', i + 1),
      tenant_id: t.id,
      code,
      name: code
        .split('-')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' '),
      description: 'Demo automation (synthetic)',
      trigger_type: trigger,
      entity_type: entity,
      status,
      is_system: i === 7,
      pinned_version_id: idOf(t, 'avr', i + 1),
      lock_version: 0,
      created_by: staff.owner,
      updated_by: staff.owner,
    }),
  );
  autoCodes.forEach((_, i) => {
    const steps = [
      { id: 'st-1', index: 0, type: 'NOTIFY', template: 'lead.first-contact' },
      { id: 'st-2', index: 1, type: 'CREATE_TASK', title: 'Call back' },
    ];
    out.add('automation_version', {
      id: idOf(t, 'avr', i + 1),
      tenant_id: t.id,
      definition_id: idOf(t, 'adf', i + 1),
      version_no: 1,
      status: i === 5 ? 'PENDING_APPROVAL' : i === 6 ? 'RETIRED' : 'ACTIVE',
      trigger_config: { event: 'lead.created', debounceSeconds: 30 },
      steps,
      content_hash: `sha256:${sha256Hex(`automation-${t.tag}-${i}`)}`,
      author_id: staff.owner,
      submitted_by: staff.owner,
      submitted_at: at(d, 2, i),
      approved_by: i === 5 ? null : staff.owner,
      approved_at: i === 5 ? null : at(d, 3, i),
      rejection_reason: null,
      lock_version: 0,
    });
  });
  const execStatus = [
    'SUCCEEDED',
    'SUCCEEDED',
    'FAILED',
    'WAITING',
    'DEAD_LETTERED',
    'RUNNING',
    'PENDING',
    'CANCELLED',
  ] as const;
  execStatus.forEach((status, i) =>
    out.add('automation_execution', {
      id: idOf(t, 'aex', i + 1),
      tenant_id: t.id,
      definition_id: idOf(t, 'adf', (i % 5) + 1),
      version_id: idOf(t, 'avr', (i % 5) + 1),
      trigger_type: 'EVENT',
      trigger_event_id: `evt-${t.tag}-${pad(i + 1)}`,
      subject_type: 'LEAD',
      subject_id: ix(o.leads, i),
      status,
      current_step_index: status === 'SUCCEEDED' ? 2 : 1,
      context: { leadId: ix(o.leads, i), source: 'WEBSITE' },
      dry_run: i === 7,
      worker_id: status === 'RUNNING' ? 'worker-local-1' : null,
      lease_expires_at: status === 'RUNNING' ? at(d, 22, 1) : null,
      error_code:
        status === 'FAILED' ? 'NOTIFY_TIMEOUT' : status === 'DEAD_LETTERED' ? 'PERMANENT_FAILURE' : null,
      error_message:
        status === 'FAILED' || status === 'DEAD_LETTERED' ? 'Provider did not respond (synthetic)' : null,
      // Left null on purpose: migration 20261001000041 checks this key with a regex repetition of {8,256}, which
      // PostgreSQL rejects (the limit is 255), so any non-null key errors on insert. Reported, not patched here.
      idempotency_key: null,
      correlation_id: `corr-${t.tag}-${pad(i + 1)}`,
      causation_id: null,
      chain_depth: i % 4,
      started_at: at(d, 21, i),
      completed_at: status === 'SUCCEEDED' || status === 'FAILED' ? at(d, 21, i + 1) : null,
    }),
  );
  execStatus.forEach((status, i) =>
    out.add('automation_step_execution', {
      id: idOf(t, 'ase', i + 1),
      tenant_id: t.id,
      execution_id: idOf(t, 'aex', i + 1),
      step_index: 0,
      step_id: 'st-1',
      step_type: 'NOTIFY',
      status:
        status === 'FAILED' || status === 'DEAD_LETTERED'
          ? 'FAILED'
          : status === 'PENDING'
            ? 'PENDING'
            : 'SUCCEEDED',
      input_snapshot: { template: 'lead.first-contact' },
      output_snapshot: status === 'SUCCEEDED' ? { delivered: true } : null,
      error_code: status === 'FAILED' ? 'NOTIFY_TIMEOUT' : null,
      error_message: status === 'FAILED' ? 'Provider did not respond (synthetic)' : null,
      error_classification: status === 'FAILED' ? 'RETRYABLE' : null,
      attempts: status === 'FAILED' ? 3 : 1,
      idempotency_key: `ase-${t.tag}-${pad(i + 1, 4)}`,
      skip_reason: null,
      skipped_by: null,
      started_at: at(d, 21, i),
      completed_at: at(d, 21, i + 1),
    }),
  );
  for (let i = 0; i < 8; i += 1) {
    out.add('scheduled_trigger', {
      id: idOf(t, 'str', i + 1),
      tenant_id: t.id,
      definition_id: idOf(t, 'adf', (i % 8) + 1),
      version_id: idOf(t, 'avr', (i % 8) + 1),
      cron_expression: i % 2 === 0 ? '0 9 * * 1-5' : '30 18 * * *',
      next_run_at: at(d, 23, i),
      last_run_at: at(d, 22, i),
      status: i === 6 ? 'PAUSED' : i === 7 ? 'EXHAUSTED' : 'ACTIVE',
      payload: { scope: 'TENANT' },
    });
  }
  for (let i = 0; i < 8; i += 1) {
    out.add('wfa_dead_letter', {
      id: idOf(t, 'wdl', i + 1),
      tenant_id: t.id,
      execution_id: idOf(t, 'aex', (i % 8) + 1),
      step_execution_id: idOf(t, 'ase', (i % 8) + 1),
      reason: 'Provider timed out after three retries (synthetic)',
      error_details: { attempts: 3, lastStatus: 504 },
      resolution_status: i < 3 ? 'RESOLVED' : i === 6 ? 'IGNORED' : 'OPEN',
      resolved_by: i < 3 || i === 6 ? staff.owner : null,
      resolved_at: i < 3 || i === 6 ? at(d, 23, i) : null,
      resolution_action: i < 3 ? 'RETRY' : i === 6 ? 'SKIP' : null,
    });
  }

  // Integrations, partner API clients and keys, and webhooks with delivery logs.
  const providers = ['karza', 'digio', 'idfy', 'cibil', 'razorpay', 'sendgrid', 'exotel', 'aws-s3'] as const;
  for (let i = 0; i < 8; i += 1) {
    out.add('integration_connection', {
      id: idOf(t, 'ic', i + 1),
      tenant_id: t.id,
      provider: ix(providers, i),
      capability: ['KYC', 'KYC', 'BUREAU', 'BUREAU', 'PAYMENTS', 'EMAIL', 'TELEPHONY', 'STORAGE'][i],
      environment: i < 6 ? 'SANDBOX' : 'PRODUCTION',
      credential_ref: `vault://${t.tag}/${ix(providers, i)}/current`,
      config: { timeoutMs: 8000, region: 'ap-south-1' },
      status: i === 5 ? 'DEGRADED' : i === 6 ? 'INACTIVE' : i === 7 ? 'SUSPENDED' : 'ACTIVE',
      health: { lastCheckedAt: at(d, 22, i), ok: i !== 5 },
      created_by: staff.owner,
      updated_by: staff.owner,
    });
  }
  for (let i = 0; i < 8; i += 1) {
    out.add('api_client', {
      id: idOf(t, 'apc', i + 1),
      tenant_id: t.id,
      client_id: `client-${t.tag}-${pad(i + 1)}`,
      client_secret_hash: sha256Hex(`client-secret-${t.tag}-${i}`),
      name: `Partner integration ${i + 1}`,
      partner_name: `Partner ${i + 1} (synthetic)`,
      status: i === 6 ? 'SUSPENDED' : i === 7 ? 'REVOKED' : 'ACTIVE',
      scopes: ['partner.lead_ingest', i % 2 === 0 ? 'partner.status_read' : 'partner.doc_upload'],
      rate_limit_rpm: 120 + i * 10,
      allowed_ips: ['203.0.113.0/24'],
      last_used_at: at(d, 22, i),
      lock_version: 1,
      created_by: staff.owner,
      updated_by: staff.owner,
    });
    out.add('api_key', {
      id: idOf(t, 'apk', i + 1),
      tenant_id: t.id,
      partner_id: `partner-${t.tag}-${pad(i + 1)}`,
      name: `Key ${i + 1}`,
      key_prefix: `dsa_${t.tag}_${pad(i + 1, 3)}`,
      key_hash: sha256Hex(`key-${t.tag}-${i}`),
      scopes: ['partner.lead_ingest'],
      allowed_ips: ['203.0.113.0/24'],
      rate_limit_rpm: 120,
      status: i === 5 ? 'REVOKED' : i === 6 ? 'EXPIRED' : 'ACTIVE',
      expires_at: at(d, i === 6 ? -5 : 180),
      last_used_at: at(d, 22, i),
      lock_version: 0,
      created_by: staff.owner,
      updated_by: staff.owner,
    });
  }
  // Idempotency keys for write requests: completed ones store the response status, in-flight ones do not.
  const routes: [string, string][] = [
    ['POST', '/v1/leads'],
    ['POST', '/v1/applications'],
    ['PATCH', '/v1/leads/{id}'],
    ['POST', '/v1/lender-cases/{id}/submit'],
    ['POST', '/v1/disbursements'],
    ['POST', '/v1/payouts'],
    ['POST', '/v1/documents/upload-intents'],
    ['POST', '/v1/tasks'],
  ];
  routes.forEach(([method, path], i) =>
    out.add('idempotency_key', {
      tenant_id: t.id,
      principal_id: ix(rm, i % 2),
      key: `idem-${t.tag}-${pad(i + 1, 4)}-key`,
      method,
      path,
      request_hash: sha256Hex(`${method} ${path} ${i}`),
      status: i === 4 || i === 6 ? 'IN_PROGRESS' : 'COMPLETED',
      response_status: i === 4 || i === 6 ? null : i === 1 ? 201 : 200,
      response_body: i === 4 || i === 6 ? null : { ok: true, route: path },
      resource_ref: i === 4 || i === 6 ? null : idOf(t, 'app', (i % 10) + 1),
      created_at: at(d, 20, i),
      expires_at: at(d, 21, i),
    }),
  );
  for (let i = 0; i < 8; i += 1) {
    out.add('webhook_subscription', {
      id: idOf(t, 'whs', i + 1),
      tenant_id: t.id,
      partner_id: `partner-${t.tag}-${pad((i % 4) + 1)}`,
      name: `Status callbacks ${i + 1}`,
      target_url: `https://partner${i + 1}.example.com/hooks/dsa`,
      subscribed_events: ['lead.converted', 'application.status_changed'],
      secret_hash: sha256Hex(`whsec-${t.tag}-${i}`),
      status: i === 5 ? 'FAILING' : i === 6 ? 'PAUSED' : i === 7 ? 'REVOKED' : 'ACTIVE',
      failure_count: i === 5 ? 4 : 0,
      lock_version: 0,
      created_by: staff.owner,
      updated_by: staff.owner,
      secret_ciphertext: `synthetic-ciphertext-${t.tag}-${i}`,
      last_failure_at: i === 5 ? at(d, 22, 2) : null,
    });
    out.add('webhook_delivery_log', {
      id: idOf(t, 'whd', i + 1),
      tenant_id: t.id,
      subscription_id: idOf(t, 'whs', i + 1),
      event_id: `evt-hook-${t.tag}-${pad(i + 1)}`,
      event_type: 'lead.converted',
      payload: { leadId: ix(o.leads, i % 3) },
      http_status: i === 5 ? 503 : 200,
      response_body: i === 5 ? 'Service unavailable (synthetic)' : 'ok',
      duration_ms: 120 + i * 9,
      attempt: i === 5 ? 3 : 1,
      status: i === 5 ? 'PENDING_RETRY' : i === 6 ? 'FAILED' : 'DELIVERED',
      delivered_at: i === 5 || i === 6 ? null : at(d, 22, i),
      next_retry_at: i === 5 ? at(d, 23) : null,
      last_error: i === 5 ? 'HTTP 503 from partner endpoint (synthetic)' : null,
    });
    out.add('inbound_webhook', {
      id: idOf(t, 'ihk', i + 1),
      tenant_id: t.id,
      provider: ix(providers, i % 3),
      connection_id: idOf(t, 'ic', (i % 8) + 1),
      provider_event_id: `pe-${t.tag}-${pad(i + 1)}`,
      payload: { type: 'status', reference: `REF-${pad(i + 1)}` },
      received_at: at(d, 22, i),
    });
  }

  // Background jobs, outbox events and the dedupe registry.
  const jobTypes = [
    'lead.assign',
    'report.render',
    'export.build',
    'document.archive',
    'commission.recalc',
    'sms.send',
    'email.send',
    'sla.sweep',
  ] as const;
  jobTypes.forEach((job, i) =>
    out.add('job_queue', {
      id: idOf(t, 'job', i + 1),
      tenant_id: t.id,
      job_type: job,
      payload: { batch: i + 1 },
      status: ['COMPLETED', 'COMPLETED', 'RUNNING', 'PENDING', 'FAILED', 'COMPLETED', 'CANCELLED', 'PENDING'][
        i
      ] as string,
      attempts: i % 3,
      max_attempts: 3,
      last_error: i === 4 ? 'Object store timeout (synthetic)' : null,
      run_at: at(d, 23, i),
      started_at: i < 3 ? at(d, 23, i) : null,
      completed_at: i === 0 || i === 1 || i === 5 ? at(d, 23, i + 1) : null,
    }),
  );
  const outboxTypes = [
    'lead.created',
    'lead.converted',
    'application.submitted',
    'lender_case.status_changed',
    'disbursement.verified',
    'commission.calculated',
    'payout.approved',
    'task.completed',
  ] as const;
  outboxTypes.forEach((type, i) =>
    out.add('outbox_event', {
      id: idOf(t, 'obx', i + 1),
      tenant_id: t.id,
      event_type: type,
      event_version: 1,
      subject_type: type.startsWith('lead')
        ? 'LEAD'
        : type.startsWith('application')
          ? 'LOAN_APPLICATION'
          : 'LENDER_CASE',
      subject_id: type.startsWith('lead')
        ? ix(o.leads, i)
        : type.startsWith('application')
          ? ix(o.apps, i)
          : ix(o.lenderCases, i % o.lenderCases.length),
      payload: { version: 1, at: at(d, 23, i) },
      correlation_id: `corr-evt-${t.tag}-${pad(i + 1)}`,
      causation_id: null,
      chain_depth: i % 4,
      created_at: at(d, 23, i),
      published_at: i < 5 ? at(d, 23, i + 1) : null,
      publish_attempts: i < 5 ? 1 : i % 3,
      last_publish_error: i === 6 ? 'broker unavailable (synthetic)' : null,
      dead_lettered_at: i === 7 ? at(d, 23, 4) : null,
      discarded_at: null,
    }),
  );
  const dedupeNs = ['DECISION', 'PROVIDER_MESSAGE', 'MESSAGE_FREQ'] as const;
  for (let i = 0; i < 8; i += 1) {
    out.add('dedupe_registry', {
      tenant_id: t.id,
      namespace: ix(dedupeNs, i % 3),
      key: `${ix(dedupeNs, i % 3).toLowerCase()}-${t.tag}-${pad(i + 1, 4)}`,
      ref_id: i % 3 === 0 ? idOf(t, 'dr', 400 + i) : idOf(t, 'msg', (i % 8) + 1),
      created_at: at(d, 23, i),
      expires_at: at(d, 40, i),
    });
  }

  // Reports, schedules, exports and evidence packs.
  const reportCodes = [
    'daily_operational_summary',
    'lead_funnel',
    'sanction_register',
    'disbursement_register',
    'commission_statement',
    'payout_register',
    'aging_report',
    'sla_breach',
  ] as const;
  reportCodes.forEach((code, i) =>
    out.add('report_run', {
      id: idOf(t, 'rpr', i + 1),
      tenant_id: t.id,
      report_code: code,
      status: [
        'COMPLETED',
        'COMPLETED',
        'RUNNING',
        'PENDING',
        'FAILED',
        'COMPLETED',
        'COMPLETED',
        'COMPLETED',
      ][i] as string,
      parameters: { from: '2026-10-01', to: '2026-10-22', branch: 'MUM01' },
      row_count: 10 + i * 4,
      result_summary: { total: 10 + i * 4 },
      created_by: staff.owner,
      created_at: at(d, 22, i),
      completed_at: i === 2 || i === 3 ? null : at(d, 22, i + 1),
      download_url: i < 6 ? `https://exports.local.example.com/${t.tag}/${code}.csv` : null,
      error_message: i === 4 ? 'Query timed out for the selected range (synthetic)' : null,
    }),
  );
  reportCodes.forEach((code, i) =>
    out.add('report_schedule', {
      id: idOf(t, 'sch', i + 1),
      tenant_id: t.id,
      report_code: code,
      frequency: i % 3 === 0 ? 'DAILY' : i % 3 === 1 ? 'WEEKLY' : 'MONTHLY',
      filters: { branch: 'MUM01' },
      recipient_emails: [`ops${i + 1}@example.com`],
      recipient_scope: i % 2 === 0 ? 'TENANT' : 'BRANCH',
      created_by: staff.owner,
      is_active: i !== 6,
      last_run_at: at(d, 21, i),
      next_run_at: at(d, 23, i),
      created_at: at(d, 2, i),
    }),
  );
  for (let i = 0; i < 8; i += 1) {
    out.add('export_job', {
      id: idOf(t, 'exp', i + 1),
      tenant_id: t.id,
      requester_id: staff.owner,
      scope_type: ['TENANT', 'BRANCH', 'USER'][i % 3],
      scope_id: i % 3 === 1 ? ix(t.branches, 'MUM01') : i % 3 === 2 ? staff.rm1 : t.id,
      export_type: ['leads', 'applications', 'commissions', 'payouts', 'audit'][i % 5],
      file_format: ['CSV', 'XLSX', 'JSON'][i % 3],
      filters: { from: '2026-10-01' },
      row_count: 20 + i * 5,
      file_key: `exports/${t.tag}/exp-${pad(i + 1)}.csv`,
      status: [
        'COMPLETED',
        'COMPLETED',
        'PROCESSING',
        'PENDING',
        'FAILED',
        'COMPLETED',
        'COMPLETED',
        'COMPLETED',
      ][i] as string,
      download_url: i < 6 ? `https://exports.local.example.com/${t.tag}/exp-${pad(i + 1)}` : null,
      expires_at: at(d, 24 + i),
      downloaded_at: i < 3 ? at(d, 23, i) : null,
      created_at: at(d, 22, i),
    });
    out.add('evidence_pack', {
      id: idOf(t, 'evp', i + 1),
      tenant_id: t.id,
      requested_by: staff.compliance,
      status: [
        'COMPLETED',
        'PROCESSING',
        'PENDING',
        'FAILED',
        'COMPLETED',
        'COMPLETED',
        'COMPLETED',
        'PENDING',
      ][i] as string,
      filters: { scope: 'lead', from: '2026-10-01' },
      record_count: 10 + i,
      checksum: sha256Hex(`evidence-${t.tag}-${i}`),
      file_path: `evidence/${t.tag}/pack-${pad(i + 1)}.zip`,
      error_message: i === 3 ? 'Source table unavailable (synthetic)' : null,
      created_at: at(d, 22, i),
      completed_at: i === 0 || i >= 4 ? at(d, 22, i + 2) : null,
      expires_at: at(d, 30, i),
    });
  }

  // Daily operational summary, one row per branch-user-day. Keys are distinct so the primary key holds.
  const summaryUsers = [staff.rm1, staff.rm2, staff.sales1, staff.teammgr];
  for (let i = 0; i < 8; i += 1) {
    out.add('rpt_daily_operational_summary', {
      tenant_id: t.id,
      summary_date: onDate('2026-10-12', i), // one date per row keeps (date, branch, user) unique
      branch_id: ix(t.branches, 'MUM01'),
      user_id: ix(summaryUsers, i % summaryUsers.length),
      lead_created_count: 4 + i,
      lead_qualified_count: 2 + (i % 3),
      lead_converted_count: i % 3,
      activity_count: 10 + i * 2,
      sanction_count: i % 2,
      sanction_amount: (i % 2) * 1200000,
      disbursement_count: i % 3 === 0 ? 1 : 0,
      disbursement_amount: i % 3 === 0 ? 500000 : 0,
      refreshed_at: at(d, 22, i),
    });
  }
}
