// MOD-CPT connector portal on /portal/v1 (owner: Dev 5; DSA Notion MODULE 28; M-084). CONNECTOR_SELF scope: the caller must
// be an ACTIVE app_user of user_type CONNECTOR whose connector is ACTIVE, and every read and write is limited to that
// connector. Connectors never see Customer 360: referrals show a masked name and a coarse status only.
//   API-CPT-001 GET  /portal/v1/referrals               my referrals
//   API-CPT-003 POST /portal/v1/referrals/consent-otp   SEND a code for the customer's mobile, or VERIFY it (5 attempts, 10 min)
//   API-CPT-002 POST /portal/v1/referrals               Idempotency-Key; needs a verified, unused consent OTP for that mobile
//   API-CPT-004 GET  /portal/v1/statements              my payables: expected, approved, paid, held, in dispute; with lines
//   API-CPT-007 GET  /portal/v1/rate-card               my active agreement terms
//   API-CPT-005 POST /portal/v1/payout-requests         Idempotency-Key; step-up (MFA); payout of my ELIGIBLE or APPROVED lines
//   API-CPT-006 POST /portal/v1/disputes                Idempotency-Key; dispute one of my statement lines or payouts
// The OTP itself is never returned or logged; the consent.otp_requested event carries only its id, for the messaging sender.
import crypto from 'node:crypto';
import { AppError, maskMobile, type RequestContext, type Tx } from '@dsa/contracts';
import { withIdempotency } from '@dsa/kernel';
import express, { type Router } from 'express';
import { sql } from 'kysely';
import { z } from 'zod';
import { idempotencyKey, requireCtx } from '../../http/request';
import { computeMobileHash, normalizeMobile } from '../crm/leads/normalizer';
import { createLeadService } from '../crm/leads/router';
import { CreateLeadInputSchema } from '../crm/leads/types';
import type { ApiDeps } from '../types';

type Row = Record<string, unknown>;
const OTP_TTL_MS = 10 * 60_000;
const NO_S3 = [/[A-Z]{5}[0-9]{4}[A-Z]/i, /\b\d{4}\s?\d{4}\s?\d{4}\b/, /\b\d{9,18}\b/];
const Reason = z
  .string()
  .trim()
  .min(5)
  .max(500)
  .refine((s) => !NO_S3.some((p) => p.test(s)), 'must not contain identity or account numbers');

export const ConsentOtpRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('SEND'), mobile: z.string().min(8).max(25) }).strict(),
  z
    .object({
      action: z.literal('VERIFY'),
      otpId: z.string().min(3).max(64),
      code: z.string().regex(/^\d{6}$/),
    })
    .strict(),
]);
export const ReferralCreate = z
  .object({
    fullName: z.string().trim().min(2).max(200),
    mobile: z.string().min(8).max(25),
    productCategory: z.enum(['PL', 'BL', 'MSME', 'LAP', 'HL', 'VL', 'GL', 'EL', 'OTHER']),
    indicativeAmount: z
      .object({ amount: z.string().regex(/^\d{1,16}(\.\d{1,2})?$/), currency: z.literal('INR') })
      .optional(),
    pincode: z
      .string()
      .regex(/^[1-9][0-9]{5}$/)
      .optional(),
    consentOtpId: z.string().min(3).max(64),
  })
  .strict();
export const PortalPayoutRequest = z
  .object({ payableIds: z.array(z.string().min(3).max(64)).min(1).max(200) })
  .strict();
export const PortalDispute = z
  .object({
    subjectType: z.enum(['STATEMENT_LINE', 'PAYOUT']),
    subjectId: z.string().min(3).max(64),
    reason: Reason,
  })
  .strict();

interface Me {
  userId: string;
  connectorId: string;
  branchId: string;
}

/** The connector behind the caller; 403 for anyone else (staff use /v1). */
async function me(tx: Tx, ctx: RequestContext): Promise<Me> {
  const r = await sql<Row>`
    select u.id, u.connector_id, c.primary_branch_id
      from app_user u join connector c on c.id = u.connector_id
     where u.id = ${ctx.principal.id} and u.user_type = 'CONNECTOR' and u.status = 'ACTIVE' and c.status = 'ACTIVE'`.execute(
    tx,
  );
  const row = r.rows[0];
  if (!row) throw AppError.of('FORBIDDEN', 'The portal is for active connector users.');
  return {
    userId: String(row.id),
    connectorId: String(row.connector_id),
    branchId: String(row.primary_branch_id),
  };
}

const otpHash = (id: string, code: string) =>
  crypto.createHash('sha256').update(`${id}:${code}`).digest('hex');

const COARSE: Record<string, string> = {
  NEW: 'RECEIVED',
  CONTACT_ATTEMPTED: 'IN_PROGRESS',
  IN_PROGRESS: 'IN_PROGRESS',
  QUALIFIED: 'IN_PROGRESS',
  CONVERTED: 'APPLICATION',
  DISQUALIFIED: 'CLOSED',
  NOT_CONTACTABLE: 'CLOSED',
  MERGED: 'CLOSED',
  ARCHIVED: 'CLOSED',
};

const maskName = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => `${p[0]}${'*'.repeat(Math.max(1, p.length - 1))}`)
    .join(' ');

export function createConnectorPortalRouter(deps: ApiDeps): Router {
  const router = express.Router();

  // API-CPT-001
  router.get('/referrals', async (req, res) => {
    const ctx = requireCtx(req);
    const data = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const m = await me(tx, ctx);
      const r = await sql<Row>`
        select id, full_name, mobile_e164, product_category, state, created_at from lead
         where connector_id = ${m.connectorId} order by created_at desc, id desc limit 200`.execute(tx);
      return r.rows.map((l) => ({
        id: String(l.id),
        name: maskName(String(l.full_name)),
        mobileMasked: maskMobile(String(l.mobile_e164)),
        productCategory: String(l.product_category),
        status: COARSE[String(l.state)] ?? 'IN_PROGRESS',
        submittedAt: new Date(String(l.created_at)).toISOString(),
      }));
    });
    res.json({ data, meta: { nextCursor: null, limit: 200 } });
  });

  // API-CPT-003
  router.post('/referrals/consent-otp', async (req, res) => {
    const ctx = requireCtx(req);
    const input = ConsentOtpRequest.parse(req.body);
    const body = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const m = await me(tx, ctx);
      if (input.action === 'SEND') {
        const recent = await sql<{ n: number }>`
          select count(*)::int as n from referral_consent_otp
           where connector_id = ${m.connectorId} and created_at > now() - interval '1 hour'`.execute(tx);
        if (recent.rows[0]!.n >= 20) throw AppError.of('RATE_LIMITED', 'Too many consent codes this hour.');
        const id = deps.ids.next('otp');
        const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
        const expiresAt = new Date(ctx.now.getTime() + OTP_TTL_MS);
        await sql`
          insert into referral_consent_otp (id, tenant_id, connector_id, mobile_hash, code_hash, expires_at, created_by)
          values (${id}, ${ctx.principal.tenantId}, ${m.connectorId}, ${computeMobileHash(ctx.principal.tenantId, normalizeMobile(input.mobile))},
                  ${otpHash(id, code)}, ${expiresAt}, ${ctx.principal.id})`.execute(tx);
        // The messaging sender picks this up and texts the code to the customer; the event never carries the code.
        await sql`
          insert into outbox_event (id, tenant_id, event_type, event_version, subject_type, subject_id, payload,
                                    correlation_id, chain_depth, created_at)
          values (${deps.ids.next('evt')}, ${ctx.principal.tenantId}, 'consent.otp_requested', 1, 'CONNECTOR', ${m.connectorId},
                  ${JSON.stringify({ otpId: id })}::jsonb, ${ctx.correlationId}, 0, ${ctx.now})`.execute(tx);
        return { otpId: id, expiresAt: expiresAt.toISOString(), status: 'SENT' };
      }
      const r = await sql<Row>`
        select * from referral_consent_otp where id = ${input.otpId} and connector_id = ${m.connectorId}`.execute(
        tx,
      );
      const otp = r.rows[0];
      if (!otp) throw AppError.of('NOT_FOUND', 'Consent code not found.');
      if (otp.verified_at) return { otpId: input.otpId, status: 'VERIFIED' };
      if (new Date(String(otp.expires_at)) < ctx.now || Number(otp.attempts) >= 5) {
        throw AppError.of(
          'INVALID_STATE',
          'The code has expired or too many attempts were made. Send a new one.',
        );
      }
      const ok = crypto.timingSafeEqual(
        Buffer.from(otpHash(input.otpId, input.code)),
        Buffer.from(String(otp.code_hash)),
      );
      await sql`
        update referral_consent_otp set attempts = attempts + 1, verified_at = ${ok ? ctx.now : null}
         where id = ${input.otpId}`.execute(tx);
      if (!ok) return { otpId: input.otpId, status: 'INCORRECT', attemptsLeft: 4 - Number(otp.attempts) };
      return { otpId: input.otpId, status: 'VERIFIED' };
    });
    res.json(body);
  });

  // API-CPT-002
  router.post('/referrals', async (req, res) => {
    const ctx = requireCtx(req);
    const key = idempotencyKey(req);
    const input = ReferralCreate.parse(req.body);
    const result = await deps.txRunner.withTenantTx(ctx, (tx) =>
      withIdempotency(
        tx,
        ctx,
        { key, method: 'POST', path: '/portal/v1/referrals', body: input },
        async () => {
          const m = await me(tx, ctx);
          const mobile = normalizeMobile(input.mobile);
          const otp = (
            await sql<Row>`select * from referral_consent_otp where id = ${input.consentOtpId} and connector_id = ${m.connectorId}`.execute(
              tx,
            )
          ).rows[0];
          const sameMobile =
            otp &&
            Buffer.compare(otp.mobile_hash as Buffer, computeMobileHash(ctx.principal.tenantId, mobile)) ===
              0;
          if (!otp || !otp.verified_at || otp.used_by_lead || !sameMobile) {
            throw AppError.of('CONSENT_REQUIRED', 'A verified consent code for this mobile is required.');
          }
          // The lead is created by the portal service identity, in the connector's branch, attributed to the connector.
          const svc: RequestContext = {
            ...ctx,
            principal: {
              kind: 'SERVICE',
              id: 'SYSTEM:connector-portal',
              tenantId: ctx.principal.tenantId,
              primaryBranchId: m.branchId,
              managedTeamMemberIds: [],
              queueIds: [],
              grants: [{ code: 'lead.create', scope: 'BRANCH', branchIds: [m.branchId] }],
              authTime: null,
            },
          };
          const lead = CreateLeadInputSchema.parse({
            fullName: input.fullName,
            mobile,
            productCategory: input.productCategory,
            indicativeAmount: input.indicativeAmount ?? null,
            pincode: input.pincode ?? null,
            branchId: m.branchId,
            source: 'REFERRAL',
            subSource: 'CONNECTOR_PORTAL',
            connectorId: m.connectorId,
            consent: {
              purpose: 'CONTACT',
              noticeVersion: 'PORTAL-V1',
              channel: 'OTP',
              evidenceRef: `otp:${String(otp.id)}`,
            },
          });
          const created = await createLeadService(deps).createLead(tx, svc, lead, `cpt_${key.slice(0, 100)}`);
          await sql`update referral_consent_otp set used_by_lead = ${created.resource.id} where id = ${String(otp.id)}`.execute(
            tx,
          );
          const body = { id: created.resource.id, status: 'RECEIVED', submittedAt: ctx.now.toISOString() };
          return { status: 201, body, resourceRef: created.resource.id };
        },
      ),
    );
    if (result.replayed) res.set('Idempotent-Replayed', 'true');
    res.status(result.status).json(result.body);
  });

  // API-CPT-004
  router.get('/statements', async (req, res) => {
    const ctx = requireCtx(req);
    const body = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const m = await me(tx, ctx);
      const lines = await sql<Row>`
        select p.id, p.amount, p.currency, p.state, p.created_at,
               exists (select 1 from dispute d where d.subject_type = 'STATEMENT_LINE' and d.subject_id = p.id
                                                 and d.status in ('OPEN', 'UNDER_REVIEW')) as disputed
          from commission_payable p
         where p.connector_id = ${m.connectorId}
         order by p.created_at desc, p.id desc limit 500`.execute(tx);
      const sum = (pred: (l: Row) => boolean) =>
        lines.rows.filter(pred).reduce((a, l) => a + Math.round(Number(l.amount) * 100), 0);
      const money = (paise: number) => ({ amount: (paise / 100).toFixed(2), currency: 'INR' });
      return {
        connectorId: m.connectorId,
        totals: {
          expected: money(sum((l) => l.state === 'ACCRUED' || l.state === 'ELIGIBLE')),
          approved: money(sum((l) => l.state === 'APPROVED' || l.state === 'IN_PAYOUT')),
          paid: money(sum((l) => l.state === 'PAID')),
          held: money(sum((l) => l.state === 'ON_HOLD')),
          disputed: money(sum((l) => Boolean(l.disputed))),
        },
        lines: lines.rows.map((l) => ({
          id: String(l.id),
          amount: { amount: Number(l.amount).toFixed(2), currency: String(l.currency) },
          state: String(l.state),
          disputed: Boolean(l.disputed),
          createdAt: new Date(String(l.created_at)).toISOString(),
        })),
      };
    });
    res.json(body);
  });

  // API-CPT-007
  router.get('/rate-card', async (req, res) => {
    const ctx = requireCtx(req);
    const body = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const m = await me(tx, ctx);
      const r = await sql<Row>`
        select id, version, valid_from, valid_to, permitted_products, share_rule_scope from connector_agreement
         where connector_id = ${m.connectorId} and status = 'ACTIVE' and valid_from <= now() and valid_to > now()
         order by valid_from desc limit 1`.execute(tx);
      const a = r.rows[0];
      if (!a) return { connectorId: m.connectorId, agreement: null };
      return {
        connectorId: m.connectorId,
        agreement: {
          id: String(a.id),
          version: Number(a.version),
          validFrom: new Date(String(a.valid_from)).toISOString(),
          validTo: new Date(String(a.valid_to)).toISOString(),
          permittedProducts: a.permitted_products as string[],
          shareRuleScope: String(a.share_rule_scope),
        },
      };
    });
    res.json(body);
  });

  // API-CPT-005
  router.post('/payout-requests', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requireStepUp(ctx);
    const key = idempotencyKey(req);
    const input = PortalPayoutRequest.parse(req.body);
    const result = await deps.txRunner.withTenantTx(ctx, (tx) =>
      withIdempotency(
        tx,
        ctx,
        { key, method: 'POST', path: '/portal/v1/payout-requests', body: input },
        async () => {
          const m = await me(tx, ctx);
          const lines = await sql<Row>`
          select p.id, p.amount, p.currency from commission_payable p
           where p.id = any(${input.payableIds}::text[]) and p.connector_id = ${m.connectorId}
             and p.state in ('ELIGIBLE', 'APPROVED')
             and not exists (select 1 from payout_line l where l.payable_id = p.id and l.status = 'INCLUDED')
           for update of p`.execute(tx);
          if (lines.rows.length !== new Set(input.payableIds).size) {
            throw AppError.of(
              'VALIDATION_ERROR',
              'Every line must be yours, payable, and not already in a payout.',
              [{ field: 'payableIds', issue: 'NOT_PAYABLE' }],
            );
          }
          const id = deps.ids.next('prq');
          const total = lines.rows.reduce((a, l) => a + Math.round(Number(l.amount) * 100), 0);
          await sql`
          insert into payout_request (id, tenant_id, connector_id, origin, status, total, currency, submitted_by, submitted_at,
                                      created_by, updated_by)
          values (${id}, ${ctx.principal.tenantId}, ${m.connectorId}, 'CONNECTOR', 'SUBMITTED', ${(total / 100).toFixed(2)}, 'INR',
                  ${ctx.principal.id}, ${ctx.now}, ${ctx.principal.id}, ${ctx.principal.id})`.execute(tx);
          for (const l of lines.rows) {
            await sql`
            insert into payout_line (id, tenant_id, payout_id, payable_id, amount, currency, created_by)
            values (${deps.ids.next('pln')}, ${ctx.principal.tenantId}, ${id}, ${String(l.id)}, ${String(l.amount)}, ${String(l.currency)},
                    ${ctx.principal.id})`.execute(tx);
          }
          await deps.audit.record(tx, ctx, {
            action: 'payout_request.submitted',
            entityType: 'PAYOUT_REQUEST',
            entityId: id,
            after: { origin: 'CONNECTOR', lines: lines.rows.length, total: (total / 100).toFixed(2) },
            permissionUsed: 'payout.request',
          });
          const body = {
            id,
            status: 'SUBMITTED',
            total: { amount: (total / 100).toFixed(2), currency: 'INR' },
            lines: lines.rows.length,
          };
          return { status: 201, body, resourceRef: id };
        },
      ),
    );
    if (result.replayed) res.set('Idempotent-Replayed', 'true');
    res.status(result.status).json(result.body);
  });

  // API-CPT-006
  router.post('/disputes', async (req, res) => {
    const ctx = requireCtx(req);
    const key = idempotencyKey(req);
    const input = PortalDispute.parse(req.body);
    const result = await deps.txRunner.withTenantTx(ctx, (tx) =>
      withIdempotency(
        tx,
        ctx,
        { key, method: 'POST', path: '/portal/v1/disputes', body: input },
        async () => {
          const m = await me(tx, ctx);
          const owned =
            input.subjectType === 'STATEMENT_LINE'
              ? await sql`select 1 from commission_payable where id = ${input.subjectId} and connector_id = ${m.connectorId}`.execute(
                  tx,
                )
              : await sql`select 1 from payout_request where id = ${input.subjectId} and connector_id = ${m.connectorId}`.execute(
                  tx,
                );
          if (!owned.rows.length) throw AppError.of('NOT_FOUND', 'Statement line or payout not found.');
          const open = await sql`
          select 1 from dispute where subject_type = ${input.subjectType} and subject_id = ${input.subjectId}
                                  and status in ('OPEN', 'UNDER_REVIEW')`.execute(tx);
          if (open.rows.length)
            throw AppError.of('INVALID_STATE', 'There is already an open dispute on this item.');
          const id = deps.ids.next('dsp');
          await sql`
          insert into dispute (id, tenant_id, party_type, party_id, subject_type, subject_id, reason, created_by, updated_by)
          values (${id}, ${ctx.principal.tenantId}, 'CONNECTOR', ${m.connectorId}, ${input.subjectType}, ${input.subjectId},
                  ${input.reason}, ${ctx.principal.id}, ${ctx.principal.id})`.execute(tx);
          await deps.audit.record(tx, ctx, {
            action: 'dispute.raised',
            entityType: 'DISPUTE',
            entityId: id,
            after: { subjectType: input.subjectType, subjectId: input.subjectId, origin: 'CONNECTOR' },
            permissionUsed: 'finance.dispute',
          });
          return {
            status: 201,
            body: { id, status: 'OPEN', subjectType: input.subjectType, subjectId: input.subjectId },
            resourceRef: id,
          };
        },
      ),
    );
    if (result.replayed) res.set('Idempotent-Replayed', 'true');
    res.status(result.status).json(result.body);
  });

  return router;
}
