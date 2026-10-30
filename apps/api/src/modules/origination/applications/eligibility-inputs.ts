// MOD-ELG applicant inputs (owner: Dev 3; DSA Notion MODULE 17). The figures the approved rules read, kept per application:
//   declared monthly income  stated by the applicant or estimated by sales. Kept and shown, never used as verified income.
//   verified monthly income  entered from an accepted income document on the checklist (the checklist item must be ACCEPTED and
//                            of an income document type). This is the only income the rules read.
//   credit score             from an authorised credit report, entered by hand only when the tenant has switched manual credit
//                            entry on (feature flag eligibility.manual_credit_entry). There is no bureau integration, so no
//                            figure is ever recorded as bureau-verified.
// Reading and changing these needs application.update, because they are personal financial data. An assessment stores only
// codes and a fingerprint of its inputs, never the values.
import { AppError, type PermissionCode, type RequestContext, type Tx } from '@dsa/contracts';
import type { Router } from 'express';
import { sql } from 'kysely';
import { ifMatchVersion, requireCtx } from '../../../http/request';
import type { ApiDeps } from '../../types';
import { applicationScope } from './applications';
import { assertVersion, iso, updateVersioned, type Row } from './db';
import { DEFAULT_TYPES } from './documents';
import { businessDate, creditReportUsable, INPUT_EDITABLE_STATUSES } from './eligibility-rules';
import { ApplicantInputsUpdate, type ApplicantInputs } from './eligibility-schemas';

export const CREDIT_ENTRY_FLAG = 'eligibility.manual_credit_entry';
const PLATFORM_INCOME_CODES = DEFAULT_TYPES.filter((t) => t.category === 'INCOME').map((t) => t.code);

/** The application in the caller's scope, or NOT_FOUND (another tenant, another scope and a missing id look the same). */
export async function loadScopedApplication(
  tx: Tx,
  ctx: RequestContext,
  code: PermissionCode,
  id: string,
  opts: { lock?: boolean } = {},
): Promise<Row> {
  const r = opts.lock
    ? await sql<Row>`select * from loan_application where id = ${id} and ${applicationScope(ctx, code)} for update`.execute(
        tx,
      )
    : await sql<Row>`select * from loan_application where id = ${id} and ${applicationScope(ctx, code)}`.execute(
        tx,
      );
  if (!r.rows[0]) throw AppError.of('NOT_FOUND', 'Application not found.');
  return r.rows[0];
}

/** The stored figures for an application, or null when none were ever recorded. Dates are read as YYYY-MM-DD text. */
export async function readApplicantInputs(tx: Tx, applicationId: string): Promise<Row | null> {
  const r = await sql<Row>`
    select id, application_id, declared_monthly_income_amount, declared_income_source, declared_at,
           verified_monthly_income_amount, verified_income_checklist_item_id, verified_at,
           credit_score, credit_report_reference, to_char(credit_report_date, 'YYYY-MM-DD') as credit_report_date,
           credit_entered_at, updated_at, lock_version
      from applicant_financial_input
     where application_id = ${applicationId}`.execute(tx);
  return r.rows[0] ?? null;
}

/**
 * The verified income and the state of its evidence. Null when no verified income is recorded. The status is the checklist
 * item's current status, so a document that was later rejected stops counting.
 */
export async function verifiedIncomeEvidence(
  tx: Tx,
  tenantId: string,
  applicationId: string,
  inputs: Row | null,
): Promise<{ amount: string; checklistStatus: string | null; primary: boolean } | null> {
  if (
    !inputs ||
    inputs.verified_monthly_income_amount === null ||
    inputs.verified_monthly_income_amount === undefined
  ) {
    return null;
  }
  const item = await sql<Row>`
    select ci.status, ap.role
      from checklist_item ci
      left join application_party ap on ap.tenant_id = ci.tenant_id and ap.id = ci.party_id
     where ci.id = ${String(inputs.verified_income_checklist_item_id)}
       and ci.application_id = ${applicationId} and ci.tenant_id = ${tenantId}`.execute(tx);
  return {
    amount: String(inputs.verified_monthly_income_amount),
    checklistStatus: (item.rows[0]?.status as string | undefined) ?? null,
    primary: item.rows[0]?.role === 'PRIMARY',
  };
}

/** Whether this tenant has switched manual credit entry on (its own setting, else the platform default, which is off). */
export async function creditEntryEnabled(tx: Tx, tenantId: string): Promise<boolean> {
  const r = await sql<{ enabled: boolean }>`
    select coalesce(
      (select value from tenant_feature_flag where tenant_id = ${tenantId} and key = ${CREDIT_ENTRY_FLAG}),
      (select value from feature_flag where key = ${CREDIT_ENTRY_FLAG} and scope = 'TENANT'),
      false) as enabled`.execute(tx);
  return Boolean(r.rows[0]?.enabled);
}

/** A document type counts as income when the tenant's own type says so, else when it is a platform income type. */
async function isIncomeDocument(tx: Tx, tenantId: string, code: string): Promise<boolean> {
  const own =
    await sql<Row>`select category from document_type where tenant_id = ${tenantId} and code = ${code}`.execute(
      tx,
    );
  if (own.rows[0]) return own.rows[0].category === 'INCOME';
  return PLATFORM_INCOME_CODES.includes(code);
}

async function checkIncomeEvidence(
  tx: Tx,
  tenantId: string,
  applicationId: string,
  checklistItemId: string,
): Promise<void> {
  const item = await sql<Row>`
    select ci.status, ci.document_type_code, ap.role
      from checklist_item ci
      left join application_party ap on ap.tenant_id = ci.tenant_id and ap.id = ci.party_id
     where ci.id = ${checklistItemId} and ci.application_id = ${applicationId} and ci.tenant_id = ${tenantId}`.execute(
    tx,
  );
  const row = item.rows[0];
  const refused = (issue: string) =>
    AppError.of('VALIDATION_ERROR', 'The income evidence cannot be used to verify income.', [
      { field: 'verifiedMonthlyIncome.checklistItemId', issue },
    ]);
  if (!row) throw refused('NOT_FOUND');
  if (row.role !== 'PRIMARY') throw refused('NOT_PRIMARY');
  if (row.status !== 'ACCEPTED') throw refused('NOT_ACCEPTED');
  if (!(await isIncomeDocument(tx, tenantId, String(row.document_type_code)))) throw refused('NOT_INCOME');
}

const toInputs = (row: Row | null, applicationId: string, enabled: boolean, asOf: Date): ApplicantInputs => {
  const hasCredit = row !== null && row.credit_score !== null && row.credit_score !== undefined;
  return {
    applicationId,
    declaredMonthlyIncome:
      row && row.declared_monthly_income_amount !== null && row.declared_monthly_income_amount !== undefined
        ? { amount: String(row.declared_monthly_income_amount), currency: 'INR' }
        : null,
    declaredIncomeSource: (row?.declared_income_source as ApplicantInputs['declaredIncomeSource']) ?? null,
    declaredAt: row?.declared_at ? iso(row.declared_at) : null,
    verifiedMonthlyIncome:
      row && row.verified_monthly_income_amount !== null && row.verified_monthly_income_amount !== undefined
        ? {
            amount: String(row.verified_monthly_income_amount),
            currency: 'INR',
            checklistItemId: String(row.verified_income_checklist_item_id),
          }
        : null,
    verifiedAt: row?.verified_at ? iso(row.verified_at) : null,
    credit: hasCredit
      ? {
          score: Number(row!.credit_score),
          reportReference: String(row!.credit_report_reference),
          reportDate: String(row!.credit_report_date),
          enteredAt: iso(row!.credit_entered_at),
          usable: creditReportUsable(String(row!.credit_report_date), asOf),
        }
      : null,
    creditEntryEnabled: enabled,
    updatedAt: row?.updated_at ? iso(row.updated_at) : null,
    version: row ? Number(row.lock_version) : 0,
  };
};

export function registerApplicantInputRoutes(router: Router, deps: ApiDeps): void {
  router.get('/applications/:id/eligibility-inputs', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'application.update');
    const body = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const app = await loadScopedApplication(tx, ctx, 'application.update', req.params.id);
      const applicationId = String(app.id);
      const row = await readApplicantInputs(tx, applicationId);
      const enabled = await creditEntryEnabled(tx, ctx.principal.tenantId);
      return toInputs(row, applicationId, enabled, ctx.now);
    });
    res.set('ETag', `"${body.version}"`);
    res.json(body);
  });

  router.put('/applications/:id/eligibility-inputs', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'application.update');
    const version = ifMatchVersion(req);
    const input = ApplicantInputsUpdate.parse(req.body);
    const tenantId = ctx.principal.tenantId;

    const body = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const app = await loadScopedApplication(tx, ctx, 'application.update', req.params.id, { lock: true });
      const applicationId = String(app.id);
      if (!(INPUT_EDITABLE_STATUSES as readonly string[]).includes(String(app.status))) {
        throw AppError.of(
          'INVALID_STATE',
          `Applicant figures cannot change when the application is ${app.status}.`,
        );
      }
      const existing = await sql<Row>`
        select * from applicant_financial_input where application_id = ${applicationId} for update`.execute(
        tx,
      );
      const current = existing.rows[0];
      assertVersion(current ?? ({ lock_version: 0 } as Row), version);

      if (input.credit) {
        if (!(await creditEntryEnabled(tx, tenantId))) {
          throw AppError.of(
            'INVALID_STATE',
            'Recording a credit score by hand is not enabled for this tenant.',
          );
        }
        if (input.credit.reportDate > businessDate(ctx.now)) {
          throw AppError.of('VALIDATION_ERROR', 'The credit report date cannot be in the future.', [
            { field: 'credit.reportDate', issue: 'FUTURE' },
          ]);
        }
      }
      if (input.verifiedMonthlyIncome) {
        await checkIncomeEvidence(tx, tenantId, applicationId, input.verifiedMonthlyIncome.checklistItemId);
      }

      // A field left out is unchanged; null clears it. Only the field names reach the audit trail, never the values.
      const changes: Record<string, unknown> = {};
      const changed: string[] = [];
      if (input.declaredMonthlyIncome !== undefined) {
        const declared = input.declaredMonthlyIncome;
        changes.declared_monthly_income_amount = declared?.amount ?? null;
        changes.declared_income_source = input.declaredIncomeSource ?? null;
        changes.declared_at = declared ? ctx.now : null;
        changes.declared_by = declared ? ctx.principal.id : null;
        changed.push('declaredMonthlyIncome');
      }
      if (input.verifiedMonthlyIncome !== undefined) {
        const verified = input.verifiedMonthlyIncome;
        changes.verified_monthly_income_amount = verified?.amount ?? null;
        changes.verified_income_checklist_item_id = verified?.checklistItemId ?? null;
        changes.verified_at = verified ? ctx.now : null;
        changes.verified_by = verified ? ctx.principal.id : null;
        changed.push('verifiedMonthlyIncome');
      }
      if (input.credit !== undefined) {
        const credit = input.credit;
        changes.credit_score = credit?.score ?? null;
        changes.credit_report_reference = credit?.reportReference ?? null;
        changes.credit_report_date = credit?.reportDate ?? null;
        changes.credit_entered_at = credit ? ctx.now : null;
        changes.credit_entered_by = credit ? ctx.principal.id : null;
        changed.push('credit');
      }

      const row =
        current ??
        (
          await sql<Row>`
            insert into applicant_financial_input (id, tenant_id, application_id, created_by, updated_by)
            values (${deps.ids.next('elg')}, ${tenantId}, ${applicationId}, ${ctx.principal.id}, ${ctx.principal.id})
            returning *`.execute(tx)
        ).rows[0]!;
      await updateVersioned(tx, ctx.principal.id, 'applicant_financial_input', row, version, changes);
      await deps.audit.record(tx, ctx, {
        action: 'eligibility.inputs_updated',
        entityType: 'LOAN_APPLICATION',
        entityId: applicationId,
        after: { changed },
        permissionUsed: 'application.update',
      });

      const fresh = await readApplicantInputs(tx, applicationId);
      const enabled = await creditEntryEnabled(tx, tenantId);
      return toInputs(fresh, applicationId, enabled, ctx.now);
    });
    res.set('ETag', `"${body.version}"`);
    res.json(body);
  });
}
