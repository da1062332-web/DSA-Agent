// apps/api/src/modules/origination/verifications/credit-report-service.ts
// Module 22: Verification (MOD-VER) — the credit-bureau soft pull (P1-05): POST /v1/customers/{id}/credit-reports and the two reads.
//
// A pull sends a customer's name, PAN and date of birth to the bureau, WITHOUT storing them, and keeps only the summary (score, accounts,
// monthly EMI, days past due, enquiries) in credit_report (migration 0130). Everything of a pull happens in ONE tenant transaction under the
// Idempotency-Key, in this order: permission, the customer in the caller's scope, the keyed request body, a lock per customer and bureau, the
// bureau consent, the 24-hour cache, the bureau call, the insert and the audit event. A failure is thrown, so nothing is stored and the same
// key can be retried; a retryable error is never stored as a result and a score is never invented.
import {
  AppError,
  CREDIT_REPORT_CACHE_HOURS,
  isPullableDateOfBirth,
  type CreditReport,
  type CreditBureau,
  type ListCreditReportsQuery,
  type ListCreditReportsResponse,
  type LatestCreditReportQuery,
  type Money,
  type PullCreditReport,
  type RequestContext,
  type Tx,
} from '@dsa/contracts';
import { withIdempotency } from '@dsa/kernel';
import { sql } from 'kysely';
import { monotonicFactory } from 'ulid';
import type { ApiDeps } from '../../types';
import { createKeyedHasher, vendorCaseId } from './keyed-hash';

const nextUlid = monotonicFactory();

/** The columns of a stored report. The date is read as text, so the time zone of the server can never shift it. */
const COLUMNS = sql`id, tenant_id, customer_id, consent_record_id, bureau, provider, outcome,
  to_char(report_date, 'YYYY-MM-DD') AS report_date, score, active_accounts, monthly_emi_amount, monthly_emi_currency,
  max_dpd_12m, enquiries_6m, vendor_ref, cost_amount, cost_currency, pulled_by, pulled_at, lock_version, created_at`;

interface CreditReportRow {
  id: string;
  tenant_id: string;
  customer_id: string;
  consent_record_id: string;
  bureau: CreditBureau;
  provider: string;
  outcome: 'SCORED' | 'NO_HISTORY';
  report_date: string;
  score: number | null;
  active_accounts: number | null;
  monthly_emi_amount: string | number | null;
  monthly_emi_currency: string;
  max_dpd_12m: number | null;
  enquiries_6m: number | null;
  vendor_ref: string | null;
  cost_amount: string | number | null;
  cost_currency: string | null;
  pulled_by: string;
  pulled_at: Date;
  lock_version: number;
  created_at: Date;
}

/** numeric(18,2) arrives as text with two places; anything else is normalised to two places. */
function money(amount: string | number | null, currency: string | null): Money | null {
  if (amount === null || currency === null) return null;
  const text = String(amount);
  const [whole = '0', frac = ''] = text.split('.');
  return { amount: `${whole}.${frac.padEnd(2, '0').slice(0, 2)}`, currency: currency.trim() };
}

function toReport(row: CreditReportRow): CreditReport {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    customerId: row.customer_id,
    consentRecordId: row.consent_record_id,
    bureau: row.bureau,
    provider: row.provider,
    outcome: row.outcome,
    reportDate: row.report_date,
    score: row.score,
    activeAccounts: row.active_accounts,
    monthlyEmi: money(row.monthly_emi_amount, row.monthly_emi_currency),
    maxDpd12m: row.max_dpd_12m,
    enquiries6m: row.enquiries_6m,
    vendorRef: row.vendor_ref,
    cost: money(row.cost_amount, row.cost_currency),
    pulledBy: row.pulled_by,
    pulledAt: new Date(row.pulled_at).toISOString(),
    lockVersion: row.lock_version,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/** The list cursor: base64url of {"k": pulled_at, "id"} of the last row (Contracts section 5). */
function encodeCursor(row: CreditReportRow): string {
  return Buffer.from(JSON.stringify({ k: new Date(row.pulled_at).toISOString(), id: row.id })).toString(
    'base64url',
  );
}
function decodeCursor(cursor: string): { k: string; id: string } {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      k?: unknown;
      id?: unknown;
    };
    if (typeof value.k === 'string' && typeof value.id === 'string' && !Number.isNaN(Date.parse(value.k))) {
      return { k: value.k, id: value.id };
    }
  } catch {
    // falls through to the error below
  }
  throw AppError.of('VALIDATION_ERROR', 'The cursor is not valid.', [
    { field: 'cursor', issue: 'INVALID_CURSOR' },
  ]);
}

export class CreditReportService {
  constructor(private readonly deps: ApiDeps) {}

  /**
   * The customer must exist in the tenant and be in the caller's scope for `code`: another tenant, an unknown id or a record outside the
   * caller's scope is 404, never 403. The customer is read through PartyPort (this module never reads the customer table), which gives
   * the home branch. A scope of OWN or TEAM needs the owner of the record, which the port does not give, so those two scopes do not
   * cover a customer here; a TENANT or BRANCH scope does.
   */
  private async requireCustomer(
    tx: Tx,
    ctx: RequestContext,
    customerId: string,
    code: 'credit_report.pull' | 'credit_report.read',
  ): Promise<void> {
    const partyPort = this.deps.partyPort;
    if (!partyPort) {
      throw AppError.of('DEPENDENCY_UNAVAILABLE', 'Customer lookup is not configured on this server.');
    }
    const party = await partyPort.getParty(tx, customerId);
    this.deps.authz.requireOnRecord(
      ctx,
      code,
      party ? { recordType: 'CUSTOMER', branchId: party.homeBranchId, ownerUserIds: [], queueIds: [] } : null,
    );
  }

  /**
   * POST /v1/customers/{id}/credit-reports. Returns the report, whether it came from the 24-hour cache (no bureau call, no new row, no cost)
   * and whether it is a replay of an earlier request with the same Idempotency-Key.
   */
  async pull(
    ctx: RequestContext,
    customerId: string,
    input: PullCreditReport,
    idempotencyKey: string,
  ): Promise<{ report: CreditReport; cached: boolean; isReplayed: boolean }> {
    this.deps.authz.requirePermission(ctx, 'credit_report.pull');
    const { bureauPort, consentPort } = this.deps;
    if (!bureauPort) {
      throw AppError.of('DEPENDENCY_UNAVAILABLE', 'Credit bureau pulls are not configured on this server.');
    }
    if (!consentPort) {
      throw AppError.of('DEPENDENCY_UNAVAILABLE', 'Consent lookup is not configured on this server.');
    }
    // The age rule needs the clock: it is the request's, so a test can fix it.
    if (!isPullableDateOfBirth(input.dateOfBirth, ctx.now)) {
      throw AppError.of(
        'VALIDATION_ERROR',
        'A credit report can be pulled only for a person aged 18 to 100.',
        [{ field: 'dateOfBirth', issue: 'INVALID_AGE' }],
      );
    }

    // withIdempotency stores a plain SHA-256 of the whole request, and a PAN or a date of birth hashed that way can be brute-forced
    // offline. So it is given a body in which they and the name are replaced by keyed hashes.
    const keyed = createKeyedHasher(this.deps.documentLinkSecret);
    const keyedBody = {
      customerId,
      bureau: input.bureau,
      pan: keyed('pan', input.pan),
      dateOfBirth: keyed('dateOfBirth', input.dateOfBirth),
      name: keyed('name', input.name),
    };
    const caseId = vendorCaseId(keyed, ctx.principal.tenantId, ctx.principal.id, idempotencyKey);
    const tenantId = ctx.principal.tenantId;

    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      // Outside the idempotent run, so a replay is also refused once the caller's scope has gone.
      await this.requireCustomer(tx, ctx, customerId, 'credit_report.pull');

      const result = await withIdempotency<CreditReport>(
        tx,
        ctx,
        {
          key: idempotencyKey,
          method: 'POST',
          path: `/v1/customers/${customerId}/credit-reports`,
          body: keyedBody,
        },
        async () => {
          // One pull at a time for a customer and a bureau: a second request with ANOTHER key waits here, then finds the first one's
          // report in the cache below, so the bureau is never called and paid twice. Released when the transaction ends.
          await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`credit_report:${tenantId}:${customerId}:${input.bureau}`}, 0))`.execute(
            tx,
          );

          // 1. No pull without a live consent of the customer for this bureau (also one given to a lead that became the customer).
          const consent = await consentPort.findActive(tx, {
            customerId,
            purpose: 'BUREAU_PULL',
            purposeTarget: input.bureau,
          });
          if (!consent) {
            throw AppError.of(
              'CONSENT_REQUIRED',
              'An active bureau consent of the customer is required for this bureau.',
              [{ field: 'bureau', issue: 'BUREAU_CONSENT_REQUIRED' }],
            );
          }

          // 2. The 24-hour cache: a report for this customer and bureau under 24 hours old is returned, and the bureau is not called.
          const since = new Date(ctx.now.getTime() - CREDIT_REPORT_CACHE_HOURS * 3_600_000);
          const cached = await sql<CreditReportRow>`
            SELECT ${COLUMNS} FROM app.credit_report
             WHERE tenant_id = ${tenantId} AND customer_id = ${customerId} AND bureau = ${input.bureau} AND pulled_at > ${since}
             ORDER BY pulled_at DESC, id DESC
             LIMIT 1`.execute(tx);
          const hit = cached.rows[0];
          if (hit) return { status: 200, body: toReport(hit), resourceRef: hit.id };

          // 3. The bureau call. The PAN, date of birth and name leave here and nowhere else; an error is thrown from here.
          const pulled = await bureauPort.pull(tx, ctx, {
            bureau: input.bureau,
            name: input.name,
            pan: input.pan,
            dateOfBirth: input.dateOfBirth,
            caseId,
          });

          // 4. Store the summary: no PAN, no date of birth, no name, no raw report. Immutable.
          const id = `crp_${nextUlid()}`;
          const summary = pulled.summary;
          await sql`
            INSERT INTO app.credit_report (
              id, tenant_id, customer_id, consent_record_id, bureau, provider, outcome, report_date,
              score, active_accounts, monthly_emi_amount, max_dpd_12m, enquiries_6m,
              vendor_ref, cost_amount, cost_currency, pulled_by, pulled_at, lock_version, created_at
            ) VALUES (
              ${id}, ${tenantId}, ${customerId}, ${consent.consentId}, ${input.bureau}, ${pulled.provider}, ${pulled.outcome}, ${pulled.reportDate},
              ${summary?.score ?? null}, ${summary?.activeAccounts ?? null}, ${summary?.monthlyEmi.amount ?? null},
              ${summary?.maxDpd12m ?? null}, ${summary?.enquiries6m ?? null},
              ${pulled.vendorRef}, ${pulled.unitCost?.amount ?? null}, ${pulled.unitCost?.currency ?? null},
              ${ctx.principal.id}, ${ctx.now}, 0, ${ctx.now}
            )`.execute(tx);
          const stored = await sql<CreditReportRow>`
            SELECT ${COLUMNS} FROM app.credit_report WHERE tenant_id = ${tenantId} AND id = ${id}`.execute(
            tx,
          );
          const row = stored.rows[0];
          if (!row) throw AppError.of('INTERNAL_ERROR', 'The credit report could not be read back.');

          // 5. Audit in the same transaction: the bureau, the outcome, the vendor reference and the cost. Nothing that identifies the person.
          await this.deps.audit.record(tx, ctx, {
            action: 'credit_report.pulled',
            entityType: 'credit_report',
            entityId: id,
            after: {
              customerId,
              bureau: input.bureau,
              provider: pulled.provider,
              outcome: pulled.outcome,
              vendorRef: pulled.vendorRef,
              cost: pulled.unitCost,
              consentRecordId: consent.consentId,
              pulledBy: ctx.principal.id,
            },
          });
          return { status: 201, body: toReport(row), resourceRef: id };
        },
      );
      return { report: result.body, cached: result.status === 200, isReplayed: Boolean(result.replayed) };
    });
  }

  /** GET /v1/customers/{id}/credit-reports/latest: the newest report, of one bureau when `bureau` is given. 404 when there is none. */
  async latest(
    ctx: RequestContext,
    customerId: string,
    query: LatestCreditReportQuery,
  ): Promise<CreditReport> {
    this.deps.authz.requirePermission(ctx, 'credit_report.read');
    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      await this.requireCustomer(tx, ctx, customerId, 'credit_report.read');
      const found = await sql<CreditReportRow>`
        SELECT ${COLUMNS} FROM app.credit_report
         WHERE tenant_id = ${ctx.principal.tenantId} AND customer_id = ${customerId}
         ${query.bureau ? sql`AND bureau = ${query.bureau}` : sql``}
         ORDER BY pulled_at DESC, id DESC
         LIMIT 1`.execute(tx);
      const row = found.rows[0];
      if (!row) throw AppError.of('NOT_FOUND', 'No credit report has been pulled for this customer.');
      return toReport(row);
    });
  }

  /** GET /v1/customers/{id}/credit-reports: newest first, cursor-paged. */
  async list(
    ctx: RequestContext,
    customerId: string,
    query: ListCreditReportsQuery,
  ): Promise<ListCreditReportsResponse> {
    this.deps.authz.requirePermission(ctx, 'credit_report.read');
    const limit = query.limit ?? 50;
    const after = query.cursor ? decodeCursor(query.cursor) : null;
    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      await this.requireCustomer(tx, ctx, customerId, 'credit_report.read');
      const found = await sql<CreditReportRow>`
        SELECT ${COLUMNS} FROM app.credit_report
         WHERE tenant_id = ${ctx.principal.tenantId} AND customer_id = ${customerId}
         ${query.bureau ? sql`AND bureau = ${query.bureau}` : sql``}
         ${after ? sql`AND (pulled_at, id) < (${new Date(after.k)}::timestamptz, ${after.id})` : sql``}
         ORDER BY pulled_at DESC, id DESC
         LIMIT ${limit + 1}`.execute(tx);
      const hasMore = found.rows.length > limit;
      const rows = hasMore ? found.rows.slice(0, limit) : found.rows;
      const last = rows[rows.length - 1];
      return {
        data: rows.map(toReport),
        meta: { nextCursor: hasMore && last ? encodeCursor(last) : null, limit },
      };
    });
  }
}
