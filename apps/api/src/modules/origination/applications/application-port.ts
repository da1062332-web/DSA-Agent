// ApplicationPort, real implementation (owner: Dev 3; Contracts §4.3). Lead conversion (MOD-LEAD SUB-LEAD.09) creates the
// application through createDraftFromConversion, so the leads module never writes loan_application rows itself. Lender
// cases (MOD-LCS) read the checklist through getSubmissionDocuments. Both run inside the caller's transaction.
// The checklist generator (MOD-DOC SUB-DOC.02, TASK-304) asks DK-document.requirements for each party and writes one
// checklist_item per required document; it runs when T-APP-01 moves an application to DOCUMENTS_PENDING.
import {
  AppError,
  type ApplicationPort,
  type AuditPort,
  type CreateDraftFromConversionCommand,
  type DecisionPort,
  type IdGenerator,
  type RequestContext,
  type SubmissionDocument,
  type SubmissionDocuments,
  type Tx,
} from '@dsa/contracts';
import { sql } from 'kysely';
import { CHECKLIST_DONE_STATUSES } from './checklist-schemas';
import { updateVersioned, type Row } from './db';

export interface ApplicationPortDeps {
  ids: IdGenerator;
  audit: AuditPort;
}

const SECURED_CATEGORIES = new Set(['LAP', 'HL', 'VL', 'GL']);

export function createApplicationPort(deps: ApplicationPortDeps): ApplicationPort {
  return {
    async createDraftFromConversion(tx: Tx, ctx: RequestContext, cmd: CreateDraftFromConversionCommand) {
      const applicationId = await insertDraftApplication(tx, ctx, deps, cmd);
      return { applicationId, status: 'DRAFT' as const };
    },

    async getSubmissionDocuments(tx: Tx, _ctx: RequestContext, applicationId: string) {
      const app = await sql<Row>`select id from loan_application where id = ${applicationId}`.execute(tx);
      if (!app.rows[0]) throw AppError.of('NOT_FOUND', 'Application not found.');
      // The newest clean upload for each item supplies the hash; quarantined or infected files never count.
      const r = await sql<Row>`
        select c.id, c.party_id, c.document_type_code, c.mandatory, c.status, c.document_id,
               d.id as uploaded_id, d.sha256_hash
          from checklist_item c
          left join lateral (
            select u.id, u.sha256_hash from uploaded_document u
             where u.checklist_item_id = c.id and u.scan_status = 'CLEAN'
             order by u.created_at desc, u.id desc limit 1) d on true
         where c.application_id = ${applicationId}
         order by c.party_id, c.document_type_code, c.ordinal`.execute(tx);
      const documents: SubmissionDocument[] = r.rows.map((row) => ({
        checklistItemId: String(row.id),
        partyId: String(row.party_id),
        documentTypeCode: String(row.document_type_code),
        mandatory: Boolean(row.mandatory),
        status: row.status as SubmissionDocument['status'],
        documentId: (row.document_id as string | null) ?? (row.uploaded_id as string | null) ?? null,
        sha256: (row.sha256_hash as string | null) ?? null,
      }));
      return { complete: isComplete(documents), documents } satisfies SubmissionDocuments;
    },

    async onChecklistItemChanged(tx: Tx, ctx: RequestContext, checklistItemId: string) {
      return advanceForChecklistItem(tx, ctx, deps, checklistItemId);
    },
  };
}

/**
 * Documents complete: DOCUMENTS_PENDING -> UNDER_REVIEW (T-APP-02) without anyone clicking "Send to review". Runs in the caller's
 * transaction right after a checklist item reached ACCEPTED, WAIVED or NOT_APPLICABLE, and does nothing unless the application is
 * DOCUMENTS_PENDING, is not on hold, and every mandatory item is done (the rule T-APP-04 and isComplete share). A file on hold stays
 * where it is until the hold is cleared. Writes what a manual T-APP-02 writes (status history, outbox event, audit event), marked
 * automatic; the actor is the person whose action completed the checklist. UNDER_REVIEW -> READY_FOR_SUBMISSION stays a person's step.
 */
export async function advanceWhenDocumentsComplete(
  tx: Tx,
  ctx: RequestContext,
  deps: ApplicationPortDeps,
  applicationId: string,
): Promise<{ advanced: boolean }> {
  // Lock the row: two reviews that finish the checklist together must not both move the file.
  const current = (await sql<Row>`select * from loan_application where id = ${applicationId} for update`.execute(tx)).rows[0];
  if (!current || current.status !== 'DOCUMENTS_PENDING' || current.on_hold) return { advanced: false };

  const items = await sql<{ mandatory: boolean; status: string }>`
    select mandatory, status from checklist_item where application_id = ${applicationId}`.execute(tx);
  if (!isComplete(items.rows.map((i) => ({ mandatory: Boolean(i.mandatory), status: i.status as never })))) {
    return { advanced: false };
  }

  await updateVersioned(tx, ctx.principal.id, 'loan_application', current, Number(current.lock_version), {
    status: 'UNDER_REVIEW',
  });
  const tenantId = ctx.principal.tenantId;
  await sql`
    insert into application_status_history (id, tenant_id, application_id, from_status, to_status,
                                            transition_code, reason_code, actor, occurred_at)
    values (${deps.ids.next('ash')}, ${tenantId}, ${applicationId}, 'DOCUMENTS_PENDING', 'UNDER_REVIEW',
            'T-APP-02', 'DOCUMENTS_COMPLETE', ${ctx.principal.id}, ${ctx.now})`.execute(tx);
  await sql`
    insert into outbox_event (id, tenant_id, event_type, event_version, subject_type, subject_id, payload,
                              correlation_id, chain_depth, created_at)
    values (${deps.ids.next('evt')}, ${tenantId}, 'application.state_changed', 1, 'LOAN_APPLICATION', ${applicationId},
            ${JSON.stringify({ applicationId, from: 'DOCUMENTS_PENDING', to: 'UNDER_REVIEW', transitionCode: 'T-APP-02', automatic: true })}::jsonb,
            ${ctx.correlationId}, 0, ${ctx.now})`.execute(tx);
  await deps.audit.record(tx, ctx, {
    action: 'application.state_changed',
    entityType: 'LOAN_APPLICATION',
    entityId: applicationId,
    before: { status: 'DOCUMENTS_PENDING' },
    after: { status: 'UNDER_REVIEW', automatic: true },
    reason: 'All mandatory documents are verified.',
  });
  return { advanced: true };
}

/** The same, starting from a checklist item (what the Verification module knows). */
export async function advanceForChecklistItem(
  tx: Tx,
  ctx: RequestContext,
  deps: ApplicationPortDeps,
  checklistItemId: string,
): Promise<{ advanced: boolean }> {
  const r = await sql<Row>`select application_id from checklist_item where id = ${checklistItemId}`.execute(tx);
  const applicationId = r.rows[0]?.application_id;
  return applicationId ? advanceWhenDocumentsComplete(tx, ctx, deps, String(applicationId)) : { advanced: false };
}

/**
 * A DRAFT application with its PRIMARY party, history, application.created event and audit, in the caller's transaction.
 * Used by lead conversion (leadId set) and by API-APP-001 (created from an existing customer, no lead).
 */
export async function insertDraftApplication(
  tx: Tx,
  ctx: RequestContext,
  deps: ApplicationPortDeps,
  cmd: Omit<CreateDraftFromConversionCommand, 'leadId'> & { leadId: string | null },
): Promise<string> {
  const tenantId = ctx.principal.tenantId;
  const applicationId = deps.ids.next('app');
  await sql`
    insert into loan_application (id, tenant_id, branch_id, customer_id, lead_id, product_category,
                                  requested_amount, currency, tenure_months, purpose_code, applicant_type,
                                  status, sales_owner_id, created_by, updated_by)
    values (${applicationId}, ${tenantId}, ${cmd.branchId}, ${cmd.customerId}, ${cmd.leadId},
            ${cmd.productCategory}, ${cmd.requestedAmount.amount}, ${cmd.requestedAmount.currency},
            ${cmd.tenureMonths ?? null}, ${cmd.purposeCode ?? null}, ${cmd.applicantType}, 'DRAFT',
            ${cmd.salesOwnerUserId}, ${ctx.principal.id}, ${ctx.principal.id})`.execute(tx);
  await sql`
    insert into application_party (id, tenant_id, application_id, customer_id, role, party_type, created_by)
    values (${deps.ids.next('pty')}, ${tenantId}, ${applicationId}, ${cmd.customerId}, 'PRIMARY',
            ${cmd.partyType}, ${ctx.principal.id})`.execute(tx);
  await sql`
    insert into application_status_history (id, tenant_id, application_id, from_status, to_status,
                                            transition_code, reason_code, actor, occurred_at)
    values (${deps.ids.next('ash')}, ${tenantId}, ${applicationId}, null, 'DRAFT', 'CREATE',
            ${cmd.leadId ? 'CONVERSION' : 'DIRECT'}, ${ctx.principal.id}, ${ctx.now})`.execute(tx);
  await sql`
    insert into outbox_event (id, tenant_id, event_type, event_version, subject_type, subject_id, payload,
                              correlation_id, chain_depth, created_at)
    values (${deps.ids.next('evt')}, ${tenantId}, 'application.created', 1, 'LOAN_APPLICATION', ${applicationId},
            ${JSON.stringify({ applicationId, customerId: cmd.customerId, leadId: cmd.leadId })}::jsonb,
            ${ctx.correlationId}, 0, ${ctx.now})`.execute(tx);
  await deps.audit.record(tx, ctx, {
    action: 'application.created',
    entityType: 'LOAN_APPLICATION',
    entityId: applicationId,
    after: { status: 'DRAFT', leadId: cmd.leadId, productCategory: cmd.productCategory },
    permissionUsed: 'application.create',
  });
  return applicationId;
}

/** Same rule as the checklist summary: no open mandatory item, and the checklist is not empty. */
export function isComplete(documents: Pick<SubmissionDocument, 'mandatory' | 'status'>[]): boolean {
  return (
    documents.length > 0 && documents.every((d) => !d.mandatory || CHECKLIST_DONE_STATUSES.includes(d.status))
  );
}

/**
 * Writes the checklist for an application from DK-document.requirements, one decision per party (SUB-DOC.02).
 * Existing rows are kept, so running it again only adds what is missing. Returns the rows written and the decision
 * records, which the caller stores in loan_application.last_checklist_decision_ids.
 */
export async function generateChecklist(
  tx: Tx,
  ctx: RequestContext,
  deps: { ids: IdGenerator; decisionPort?: DecisionPort },
  application: Row,
): Promise<{ written: number; decisionIds: string[] }> {
  if (!deps.decisionPort) {
    throw AppError.of(
      'DEPENDENCY_UNAVAILABLE',
      'The rule engine is not available to build the document checklist.',
    );
  }
  const applicationId = String(application.id);
  let parties = await sql<Row>`
    select id, role, party_type from application_party
     where application_id = ${applicationId} and removed_at is null order by created_at, id`.execute(tx);
  if (parties.rows.length === 0 && application.customer_id) {
    const cust = await sql<Row>`select party_type from customer where id = ${String(application.customer_id)}`.execute(tx);
    const partyType = (cust.rows[0]?.party_type as string) ?? 'INDIVIDUAL';
    const newPartyId = deps.ids.next('pty');
    await sql`
      insert into application_party (id, tenant_id, application_id, customer_id, role, party_type, created_by)
      values (${newPartyId}, ${ctx.principal.tenantId}, ${applicationId}, ${String(application.customer_id)}, 'PRIMARY', ${partyType}, ${ctx.principal.id})
      on conflict do nothing`.execute(tx);
    parties = await sql<Row>`
      select id, role, party_type from application_party
       where application_id = ${applicationId} and removed_at is null order by created_at, id`.execute(tx);
  }
  let written = 0;
  const decisionIds: string[] = [];
  for (const party of parties.rows) {
    const decision = await deps.decisionPort.decide(tx, ctx, {
      decisionKey: 'DK-document.requirements',
      scope: {
        branchId: String(application.branch_id),
        productVersionId: (application.product_version_id as string | null) ?? undefined,
      },
      subject: { type: 'LOAN_APPLICATION', id: applicationId },
      facts: {
        product: {
          category: application.product_category as never,
          id: (application.product_version_id as string | null) ?? undefined,
        },
        party: {
          role: party.role as 'PRIMARY' | 'CO_APPLICANT' | 'GUARANTOR',
          type: party.party_type as 'INDIVIDUAL' | 'ENTITY',
          applicant_type: application.applicant_type as never,
        },
        application: {
          requested_amount: {
            amount: String(application.requested_amount),
            currency: String(application.currency),
          },
          secured: SECURED_CATEGORIES.has(String(application.product_category)),
        },
      },
      evaluationTime: ctx.now.toISOString(),
      idempotencyKey: `${applicationId}:${String(party.id)}:document-requirements`,
    });
    decisionIds.push(decision.decisionRecordId);
    if (!decision.outputs) {
      throw AppError.of('DECISION_FAILED_CLOSED', 'The document requirements could not be decided.', [
        { issue: 'DECISION_FAILED_CLOSED', meta: { decisionRecordId: decision.decisionRecordId } },
      ]);
    }
    for (const doc of decision.outputs.documents) {
      for (let ordinal = 1; ordinal <= Math.max(1, doc.count); ordinal++) {
        const r = await sql`
          insert into checklist_item (id, tenant_id, application_id, party_id, document_type_code, ordinal, mandatory,
                                      required_count, period_months, source_decision_id, created_by, updated_by)
          values (${deps.ids.next('chk')}, ${ctx.principal.tenantId}, ${applicationId}, ${String(party.id)},
                  ${doc.typeCode}, ${ordinal}, ${doc.mandatory}, ${Math.max(1, doc.count)},
                  ${doc.periodMonths > 0 ? doc.periodMonths : null}, ${decision.decisionRecordId},
                  ${ctx.principal.id}, ${ctx.principal.id})
          on conflict (application_id, party_id, document_type_code, ordinal) do nothing`.execute(tx);
        written += Number(r.numAffectedRows ?? 0);
      }
    }
  }
  if (written > 0) {
    await sql`
      insert into outbox_event (id, tenant_id, event_type, event_version, subject_type, subject_id, payload,
                                correlation_id, chain_depth, created_at)
      values (${deps.ids.next('evt')}, ${ctx.principal.tenantId}, 'checklist.changed', 1, 'LOAN_APPLICATION',
              ${applicationId}, ${JSON.stringify({ applicationId, itemsAdded: written })}::jsonb,
              ${ctx.correlationId}, 0, ${ctx.now})`.execute(tx);
  }
  return { written, decisionIds };
}
