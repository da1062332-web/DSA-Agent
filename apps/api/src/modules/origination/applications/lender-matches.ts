// MOD-APP multi-lender matching (owner: Dipanshu; task P1-04, migration M-120). For one application: which lenders will take
// it, for how much and at what EMI.
//   GET  /v1/applications/{id}/lender-matches/inputs   lender_match.run   what a run would use now, and where each value is from
//   POST /v1/applications/{id}/lender-matches (Idem)   lender_match.run   run @dsa/bre-core matchLenders and store the run
//   GET  /v1/applications/{id}/lender-matches/latest   lender_match.run   the most recent stored run with its ranked results
//   POST /v1/emi-calculations                          lender_match.run or lender_policy.read   stateless EMI calculator
// Inputs are prefilled from the application (amount, tenure, applicant type) and applicant_financial_input (verified income,
// else declared income; the credit score while its report is recent). The request body overrides any field for this run.
// 2026-11-28 (Bhushan), the way a DSA works a file out: the earning co-applicants' monthly income is clubbed with the borrower's,
// everyone's existing EMIs are counted (a guarantor's are shown, not counted), and the age, pincode, constitution and vintage come
// from the borrower's customer profile (BorrowerFinancialsPort), the property value from the file's live collateral.
// The policies come from origination/catalogue through LenderPolicyPort, never from its tables. The engine reads ctx.now,
// never the clock. A run is insert-only history; it is audited with its hash and counts, never the values (personal data).
import {
  AppError,
  EmiCalculationRequestSchema,
  LENDER_MATCH_FIELDS,
  LenderMatchRunRequestSchema,
  moneyToPaise,
  paiseToMoney,
  type BorrowerFinancials,
  type BorrowerIncomeLine,
  type EmiCalculation,
  type LenderMatchField,
  type LenderMatchInputSource,
  type LenderMatchInputValues,
  type LenderMatchPrefill,
  type LenderMatchResultView,
  type LenderMatchRun,
  type LenderPolicyPort,
  type MatchablePolicy,
  type RequestContext,
  type Tx,
} from '@dsa/contracts';
import { calculateEmi, computeContentHash, matchLenders, type LenderMatchInputs } from '@dsa/bre-core';
import { withIdempotency } from '@dsa/kernel';
import type { Router } from 'express';
import { sql } from 'kysely';
import { requireAnyPermission } from '../../../http/permissions';
import { idempotencyKey, requireCtx } from '../../../http/request';
import type { ApiDeps } from '../../types';
import { iso, type Row } from './db';
import { loadScopedApplication, readApplicantInputs } from './eligibility-inputs';
import { businessDate, creditReportUsable } from './eligibility-rules';

const RUN = 'lender_match.run' as const;

const EMPTY_INPUTS: LenderMatchInputValues = {
  requestedAmount: null,
  tenureMonths: null,
  monthlyIncome: null,
  monthlyObligations: null,
  ageYears: null,
  pincode: null,
  bureauScore: null,
  collateralValue: null,
  employmentType: null,
  constitution: null,
  vintageMonths: null,
};

const inr = (v: unknown) => ({ amount: String(v), currency: 'INR' });
const present = (v: unknown) => v !== null && v !== undefined;

/** Age in years from the birth year, on the business date. It can read one year high before the birthday, which errs toward
 *  the stricter answer on an age-at-maturity cap. */
export const ageFromBirthYear = (birthYear: number, now: Date): number =>
  Number(businessDate(now).slice(0, 4)) - birthYear;

const sumPaise = (values: readonly ({ amount: string } | null)[]): number | null => {
  const known = values.filter((v): v is { amount: string } => v !== null);
  return known.length === 0
    ? null
    : known.reduce((s, v) => s + moneyToPaise({ amount: v.amount, currency: 'INR' }), 0);
};

/** What the application, its recorded figures, its borrowers' profiles and its collateral say, with the source of each value. */
export async function prefillInputs(
  tx: Tx,
  ctx: RequestContext,
  app: Row,
  deps?: Pick<ApiDeps, 'borrowerFinancialsPort'>,
): Promise<{
  inputs: LenderMatchInputValues;
  sources: Record<LenderMatchField, LenderMatchInputSource | null>;
  borrowers: BorrowerIncomeLine[];
  collateralItems: number;
}> {
  const inputs: LenderMatchInputValues = { ...EMPTY_INPUTS };
  const sources = Object.fromEntries(LENDER_MATCH_FIELDS.map((f) => [f, null])) as Record<
    LenderMatchField,
    LenderMatchInputSource | null
  >;
  const set = <K extends LenderMatchField>(
    field: K,
    value: LenderMatchInputValues[K],
    source: LenderMatchInputSource,
  ) => {
    inputs[field] = value;
    sources[field] = source;
  };

  if (present(app.requested_amount)) set('requestedAmount', inr(app.requested_amount), 'APPLICATION');
  if (present(app.tenure_months)) set('tenureMonths', Number(app.tenure_months), 'APPLICATION');
  if (present(app.applicant_type))
    set('employmentType', app.applicant_type as LenderMatchInputValues['employmentType'], 'APPLICATION');

  const fin = await readApplicantInputs(tx, String(app.id));
  const recordedIncome = fin
    ? present(fin.verified_monthly_income_amount)
      ? fin.verified_monthly_income_amount
      : fin.declared_monthly_income_amount
    : null;
  if (
    fin &&
    present(fin.credit_score) &&
    present(fin.credit_report_date) &&
    creditReportUsable(String(fin.credit_report_date), ctx.now)
  ) {
    set('bureauScore', Number(fin.credit_score), 'FINANCIAL_INPUT');
  }

  // The borrowers on the file and what their profiles say.
  const parties = (
    await sql<Row>`
      select customer_id, role, relationship_to_primary from application_party
       where application_id = ${String(app.id)} and removed_at is null
       order by case role when 'PRIMARY' then 1 when 'CO_APPLICANT' then 2 else 3 end, created_at`.execute(tx)
  ).rows;
  const profiles = new Map<string, BorrowerFinancials>();
  if (deps?.borrowerFinancialsPort && parties.length > 0) {
    const list = await deps.borrowerFinancialsPort.getFinancials(
      tx,
      parties.map((p) => String(p.customer_id)),
    );
    for (const f of list) profiles.set(f.customerId, f);
  }

  const borrowers: BorrowerIncomeLine[] = parties.map((p) => {
    const role = p.role as BorrowerIncomeLine['role'];
    const profile = profiles.get(String(p.customer_id));
    // The borrower's own figure on the application (verified, else declared) wins over the profile.
    const fromApplication = role === 'PRIMARY' && present(recordedIncome);
    const income = fromApplication
      ? inr(Number(recordedIncome).toFixed(2))
      : (profile?.monthlyIncome ?? null);
    return {
      customerId: String(p.customer_id),
      role,
      relationshipToPrimary: (p.relationship_to_primary as string | null) ?? null,
      monthlyIncome: income,
      incomeSource: fromApplication ? 'FINANCIAL_INPUT' : income ? 'CUSTOMER_PROFILE' : null,
      monthlyObligations: profile?.monthlyObligations ?? null,
      counted: role !== 'GUARANTOR',
    };
  });
  const counted = borrowers.filter((b) => b.counted);
  const coIncome = counted.some((b) => b.role === 'CO_APPLICANT' && b.monthlyIncome !== null);
  const coObligations = counted.some((b) => b.role === 'CO_APPLICANT' && b.monthlyObligations !== null);

  const incomePaise = sumPaise(counted.map((b) => b.monthlyIncome));
  if (incomePaise !== null) {
    const primarySource = counted.find((b) => b.role === 'PRIMARY')?.incomeSource ?? 'CUSTOMER_PROFILE';
    set('monthlyIncome', paiseToMoney(incomePaise), coIncome ? 'CO_APPLICANTS' : primarySource);
  } else if (present(recordedIncome)) {
    // No party rows (a file from before parties were recorded): the application's own figure.
    set('monthlyIncome', inr(Number(recordedIncome).toFixed(2)), 'FINANCIAL_INPUT');
  }
  const obligationsPaise = sumPaise(counted.map((b) => b.monthlyObligations));
  if (obligationsPaise !== null) {
    set(
      'monthlyObligations',
      paiseToMoney(obligationsPaise),
      coObligations ? 'CO_APPLICANTS' : 'CUSTOMER_PROFILE',
    );
  }

  // Age, pincode, constitution and vintage are the borrower's (the primary applicant).
  const primaryParty = parties.find((p) => p.role === 'PRIMARY');
  const primary = primaryParty ? profiles.get(String(primaryParty.customer_id)) : undefined;
  if (primary) {
    if (primary.birthYear !== null)
      set('ageYears', ageFromBirthYear(primary.birthYear, ctx.now), 'CUSTOMER_PROFILE');
    if (primary.pincode !== null) set('pincode', primary.pincode, 'CUSTOMER_PROFILE');
    if (primary.constitution !== null)
      set('constitution', primary.constitution as LenderMatchInputValues['constitution'], 'CUSTOMER_PROFILE');
    if (primary.vintageMonths !== null) set('vintageMonths', primary.vintageMonths, 'CUSTOMER_PROFILE');
  }

  // The property pledged on the file (P1-03), for the LTV cap.
  const collateral = (
    await sql<{ n: number; paise: string | null }>`
      select count(*)::int as n, sum(estimated_market_value_paise)::text as paise from application_collateral
       where application_id = ${String(app.id)} and removed_at is null`.execute(tx)
  ).rows[0];
  if (collateral && collateral.n > 0 && collateral.paise !== null) {
    set('collateralValue', paiseToMoney(Number(collateral.paise)), 'COLLATERAL');
  }

  return { inputs, sources, borrowers, collateralItems: collateral?.n ?? 0 };
}

/** The wire inputs as bre-core inputs (integer paise). */
export function toEngineInputs(v: LenderMatchInputValues): LenderMatchInputs {
  const p = (m: LenderMatchInputValues['requestedAmount']) => (m === null ? null : moneyToPaise(m));
  return {
    requestedAmountPaise: p(v.requestedAmount),
    tenureMonths: v.tenureMonths,
    monthlyIncomePaise: p(v.monthlyIncome),
    monthlyObligationsPaise: p(v.monthlyObligations),
    ageYears: v.ageYears,
    pincode: v.pincode,
    bureauScore: v.bureauScore,
    collateralValuePaise: p(v.collateralValue),
    employmentType: v.employmentType,
    constitution: v.constitution,
    vintageMonths: v.vintageMonths,
  };
}

const moneyOrNull = (paise: number | null) => (paise === null ? null : paiseToMoney(paise));

/** Runs the engine and ranks the results; names and rate bands come from the policy rows. */
export function rankMatches(
  inputs: LenderMatchInputValues,
  policies: readonly MatchablePolicy[],
  now: Date,
): LenderMatchResultView[] {
  const byId = new Map(policies.map((p) => [p.policyId, p]));
  return matchLenders(toEngineInputs(inputs), policies, now).map((r, i) => {
    const p = byId.get(r.policyId)!;
    return {
      rank: i + 1,
      policyId: r.policyId,
      lenderId: r.lenderId,
      lenderName: p.lenderName,
      productVersionId: r.productVersionId,
      productName: p.productName,
      outcome: r.outcome,
      reasons: r.reasons,
      missingFields: r.missingFields,
      eligibleAmount: moneyOrNull(r.eligibleAmountPaise),
      limitedBy: r.limitedBy,
      emiMin: moneyOrNull(r.emiMinPaise),
      emiMax: moneyOrNull(r.emiMaxPaise),
      foirBps: r.foirBps,
      processingFee: moneyOrNull(r.processingFeePaise),
      rateMinBps: p.rateMinBps,
      rateMaxBps: p.rateMaxBps,
    };
  });
}

/** A stored run and its results, ranked. Lender and product names and rate bands come from catalogue, through the port. */
async function loadRun(tx: Tx, port: LenderPolicyPort, run: Row): Promise<LenderMatchRun> {
  const r = await sql<Row>`
    select * from lender_match_result where run_id = ${String(run.id)} order by rank`.execute(tx);
  const labels = await port.describePolicies(
    tx,
    r.rows.map((x) => String(x.policy_id)),
  );
  const m = (v: unknown) => (v == null ? null : inr(v));
  return {
    id: String(run.id),
    applicationId: String(run.application_id),
    evaluatedAt: iso(run.evaluated_at),
    inputs: run.inputs as LenderMatchInputValues,
    inputsHash: String(run.inputs_hash),
    policyCount: Number(run.policy_count),
    eligibleCount: Number(run.eligible_count),
    results: r.rows.map((x) => {
      const label = labels.get(String(x.policy_id));
      return {
        rank: Number(x.rank),
        policyId: String(x.policy_id),
        lenderId: String(x.lender_id),
        lenderName: label?.lenderName ?? '',
        productVersionId: String(x.product_version_id),
        productName: label?.productName ?? '',
        outcome: x.outcome as LenderMatchResultView['outcome'],
        reasons: (x.reasons as LenderMatchResultView['reasons']) ?? [],
        missingFields: (x.missing_fields as LenderMatchResultView['missingFields']) ?? [],
        eligibleAmount: m(x.eligible_amount),
        limitedBy: (x.limited_by as LenderMatchResultView['limitedBy']) ?? null,
        emiMin: m(x.emi_min),
        emiMax: m(x.emi_max),
        foirBps: x.foir_bps == null ? null : Number(x.foir_bps),
        processingFee: m(x.processing_fee),
        rateMinBps: label?.rateMinBps ?? 0,
        rateMaxBps: label?.rateMaxBps ?? 0,
      };
    }),
    createdBy: String(run.created_by),
  };
}

/** The port, or 503: matching never guesses which policies apply. */
function policyPort(deps: ApiDeps): LenderPolicyPort {
  if (!deps.lenderPolicyPort) {
    throw AppError.of('DEPENDENCY_UNAVAILABLE', 'Lender policies are not available, so matching cannot run.');
  }
  return deps.lenderPolicyPort;
}

export function registerLenderMatchRoutes(router: Router, deps: ApiDeps): void {
  router.get('/applications/:id/lender-matches/inputs', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, RUN);
    const body = await deps.txRunner.withTenantTx(ctx, async (tx): Promise<LenderMatchPrefill> => {
      const app = await loadScopedApplication(tx, ctx, RUN, String(req.params.id));
      const { inputs, sources, borrowers, collateralItems } = await prefillInputs(tx, ctx, app, deps);
      return { applicationId: String(app.id), inputs, sources, borrowers, collateralItems };
    });
    res.status(200).json(body);
  });

  router.post('/applications/:id/lender-matches', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, RUN);
    const key = idempotencyKey(req);
    const overrides = LenderMatchRunRequestSchema.parse(req.body ?? {});
    const port = policyPort(deps);
    const applicationId = String(req.params.id);

    const result = await deps.txRunner.withTenantTx(ctx, (tx) =>
      withIdempotency(
        tx,
        ctx,
        { key, method: 'POST', path: `/v1/applications/${applicationId}/lender-matches`, body: overrides },
        async () => {
          const app = await loadScopedApplication(tx, ctx, RUN, applicationId);
          const { inputs: prefilled } = await prefillInputs(tx, ctx, app, deps);
          const inputs: LenderMatchInputValues = { ...prefilled, ...overrides };
          const policies = await port.matchablePolicies(tx, String(app.product_category), ctx.now);
          const results = rankMatches(inputs, policies, ctx.now);
          const inputsHash = computeContentHash(inputs);
          const eligibleCount = results.filter((r) => r.outcome === 'ELIGIBLE').length;
          const runId = deps.ids.next('lmr');

          const run = await sql<Row>`
            insert into lender_match_run (id, tenant_id, application_id, inputs, inputs_hash, evaluated_at, policy_count,
                                          eligible_count, created_by)
            values (${runId}, ${ctx.principal.tenantId}, ${applicationId}, ${JSON.stringify(inputs)}::jsonb, ${inputsHash},
                    ${ctx.now}::timestamptz, ${results.length}, ${eligibleCount}, ${ctx.principal.id})
            returning *`.execute(tx);
          for (const r of results) {
            await sql`
              insert into lender_match_result (id, tenant_id, run_id, rank, policy_id, lender_id, product_version_id, outcome,
                                               reasons, missing_fields, eligible_amount, limited_by, emi_min, emi_max, foir_bps,
                                               processing_fee)
              values (${deps.ids.next('lmx')}, ${ctx.principal.tenantId}, ${runId}, ${r.rank}, ${r.policyId}, ${r.lenderId},
                      ${r.productVersionId}, ${r.outcome}, ${r.reasons}::text[], ${r.missingFields}::text[],
                      ${r.eligibleAmount?.amount ?? null}::numeric, ${r.limitedBy}, ${r.emiMin?.amount ?? null}::numeric,
                      ${r.emiMax?.amount ?? null}::numeric, ${r.foirBps}, ${r.processingFee?.amount ?? null}::numeric)`.execute(
              tx,
            );
          }
          await deps.audit.record(tx, ctx, {
            action: 'lender_match.run',
            entityType: 'LOAN_APPLICATION',
            entityId: applicationId,
            after: { runId, inputsHash, policyCount: results.length, eligibleCount },
            permissionUsed: RUN,
          });
          const body: LenderMatchRun = {
            id: runId,
            applicationId,
            evaluatedAt: iso(run.rows[0]!.evaluated_at),
            inputs,
            inputsHash,
            policyCount: results.length,
            eligibleCount,
            results,
            createdBy: ctx.principal.id,
          };
          return { status: 201, body, resourceRef: runId };
        },
      ),
    );
    if (result.replayed) res.set('Idempotent-Replayed', 'true');
    res.status(result.status).json(result.body);
  });

  router.get('/applications/:id/lender-matches/latest', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, RUN);
    const port = policyPort(deps);
    const body = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const app = await loadScopedApplication(tx, ctx, RUN, String(req.params.id));
      const r = await sql<Row>`
        select * from lender_match_run where application_id = ${String(app.id)}
         order by evaluated_at desc, id desc limit 1`.execute(tx);
      if (!r.rows[0]) {
        throw AppError.of('NOT_FOUND', 'No lender match has been run for this application yet.', [
          { field: 'id', issue: 'NO_MATCH_RUN' },
        ]);
      }
      return loadRun(tx, port, r.rows[0]);
    });
    res.status(200).json(body);
  });

  router.post('/emi-calculations', (req, res) => {
    const ctx = requireCtx(req);
    requireAnyPermission(deps.authz, ctx, [RUN, 'lender_policy.read']);
    const input = EmiCalculationRequestSchema.parse(req.body);
    const principal = moneyToPaise(input.principal);
    const emi = calculateEmi(principal, input.annualRateBps, input.tenureMonths);
    const total = emi * input.tenureMonths;
    const body: EmiCalculation = {
      emi: paiseToMoney(emi),
      totalPayable: paiseToMoney(total),
      totalInterest: paiseToMoney(Math.max(0, total - principal)),
    };
    res.status(200).json(body);
  });
}
