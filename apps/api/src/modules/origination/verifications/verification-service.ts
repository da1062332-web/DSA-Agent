// apps/api/src/modules/origination/verifications/verification-service.ts
// Module 22: Verification (MOD-VER) — Service implementation
import crypto from 'node:crypto';
import {
  AppError,
  type CreateVerificationInput,
  type KycCheckRequest,
  type ListVerificationsQuery,
  type ListVerificationsResponse,
  type RequestContext,
  type RunVerificationCheck,
  type Tx,
  type VerificationRecord,
  type VerificationSubjectType,
} from '@dsa/contracts';
import { withIdempotency } from '@dsa/kernel';
import { sql } from 'kysely';
import { monotonicFactory } from 'ulid';
import type { ApiDeps } from '../../types';

const nextUlid = monotonicFactory();

/** Used when no deployment secret is configured (development and tests), like the documents module does. */
const processSecret = crypto.randomBytes(32).toString('hex');

/**
 * True when every CHECK constraint definition on verification.check_type lists `checkType` (no such constraint means no restriction).
 * `definitions` come from pg_get_constraintdef, which prints the allowed values as quoted literals.
 */
export function checkTypeIsListed(definitions: readonly string[], checkType: string): boolean {
  return definitions.every((definition) => definition.includes(`'${checkType}'`));
}

export class VerificationService {
  constructor(private readonly deps: ApiDeps) {}

  /**
   * API-VER-001: POST /v1/verifications
   * Creates an immutable verification check record (ENT-064).
   * Enforces verification.perform permission, VERIFICATION_CHECK consent gate,
   * Idempotency-Key replay semantics, and S3 Aadhaar masking rules.
   */
  async createVerification(
    ctx: RequestContext,
    input: CreateVerificationInput,
    idempotencyKey: string,
  ): Promise<{ verification: VerificationRecord; isReplayed?: boolean }> {
    this.deps.authz.requirePermission(ctx, 'verification.perform');

    // A PROVIDER_AUTOMATED record states that a vendor answered. Only the server may create one (runCheck, API-VER-003): a caller who
    // could type method PROVIDER_AUTOMATED and result VERIFIED here could forge a check that never happened. Old records stay readable.
    if (input.method === 'PROVIDER_AUTOMATED') {
      throw AppError.of(
        'VALIDATION_ERROR',
        'Provider-automated verifications are created by the server only: run the check with POST /v1/verifications/checks.',
        [{ field: 'method', issue: 'PROVIDER_AUTOMATED_IS_SERVER_ONLY' }],
      );
    }

    // Strict Legal & Security Guard: Block any payload containing a 12-digit Aadhaar number
    const payloadStr = JSON.stringify({
      minimalResult: input.minimalResult,
      notes: input.notes,
      evidenceRef: input.evidenceRef,
    });
    if (/\b\d{12}\b/.test(payloadStr)) {
      throw AppError.of(
        'VALIDATION_ERROR',
        'Storage of full 12-digit Aadhaar numbers is strictly prohibited under the Aadhaar Act. Only masked format (e.g., XXXXXXXX1234) is permitted.',
        [{ field: 'minimalResult.maskedIdentifier', issue: 'ILLEGAL_AADHAAR_FORMAT' }],
      );
    }

    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const result = await withIdempotency(
        tx,
        ctx,
        {
          key: idempotencyKey,
          method: 'POST',
          path: '/v1/verifications',
          body: input,
        },
        async () => {
          // 1. Consent gate: an active VERIFICATION_CHECK consent of the subject being verified
          await this.assertConsentFor(tx, ctx, input);

          // 2. Generate unique verification ID
          const verId = `ver_${nextUlid()}`;
          const nowIso = ctx.now.toISOString();
          const validityExpiresAt = input.validityExpiresAt ? new Date(input.validityExpiresAt) : null;

          // 3. Insert immutable verification row (ENT-064)
          await sql`
            INSERT INTO app.verification (
              id, tenant_id, subject_type, subject_id, check_type, method,
              purpose, consent_record_id, result, minimal_result, evidence_ref,
              validity_expires_at, performed_by, performed_at, notes,
              lock_version, created_at
            ) VALUES (
              ${verId}, ${ctx.principal.tenantId}, ${input.subjectType}, ${input.subjectId},
              ${input.checkType}, ${input.method}, ${input.purpose}, ${input.consentRecordId},
              ${input.result}, ${JSON.stringify(input.minimalResult)}::jsonb, ${input.evidenceRef},
              ${validityExpiresAt}, ${ctx.principal.id}, ${ctx.now}, ${input.notes ?? null},
              0, ${ctx.now}
            )
          `.execute(tx);

          // 4. Emit Audit Event
          await this.deps.audit.record(tx, ctx, {
            action: 'verification.performed',
            entityType: 'verification',
            entityId: verId,
            after: {
              subjectType: input.subjectType,
              subjectId: input.subjectId,
              checkType: input.checkType,
              method: input.method,
              purpose: input.purpose,
              result: input.result,
              consentRecordId: input.consentRecordId,
              evidenceRef: input.evidenceRef,
              performedBy: ctx.principal.id,
            },
          });

          const record: VerificationRecord = {
            id: verId as any,
            tenantId: ctx.principal.tenantId as any,
            subjectType: input.subjectType,
            subjectId: input.subjectId,
            checkType: input.checkType,
            method: input.method,
            purpose: input.purpose,
            consentRecordId: input.consentRecordId,
            result: input.result,
            minimalResult: {
              ...input.minimalResult,
              discrepancies: input.minimalResult.discrepancies ?? [],
            },
            evidenceRef: input.evidenceRef,
            validityExpiresAt: validityExpiresAt ? validityExpiresAt.toISOString() : null,
            performedBy: ctx.principal.id as any,
            performedAt: nowIso,
            notes: input.notes ?? null,
            lockVersion: 0,
            createdAt: nowIso,
          };

          return { status: 201, body: record, resourceRef: verId };
        },
      );

      return { verification: result.body, isReplayed: result.replayed };
    });
  }

  /**
   * The consent gate shared by POST /v1/verifications and POST /v1/verifications/checks: the referenced consent must exist in the
   * tenant, be active and unexpired, be a VERIFICATION_CHECK consent, and belong to the subject being verified (AUD-P1-03).
   */
  private async assertConsentFor(
    tx: Tx,
    ctx: RequestContext,
    input: { consentRecordId: string; subjectType: VerificationSubjectType; subjectId: string },
  ): Promise<void> {
    const consentRes = await sql<{
      id: string;
      status: string;
      purpose: string;
      purpose_target: string | null;
      expires_at: Date | null;
      subject_type: string;
      subject_id: string;
    }>`
      SELECT id, status, purpose, purpose_target, expires_at, subject_type, subject_id
      FROM app.consent_record
      WHERE tenant_id = ${ctx.principal.tenantId}
        AND id = ${input.consentRecordId}
      LIMIT 1
    `.execute(tx);

    const consent = consentRes.rows[0];
    if (!consent) {
      throw AppError.of('NOT_FOUND', 'Referenced consent record does not exist in this tenant.');
    }
    if (consent.status !== 'ACTIVE') {
      throw AppError.of(
        'CONSENT_REQUIRED',
        `Consent record ${consent.id} is ${consent.status.toLowerCase()}. Active consent is required.`,
      );
    }
    if (consent.expires_at && new Date(consent.expires_at) < ctx.now) {
      throw AppError.of('CONSENT_REQUIRED', `Consent record ${consent.id} has expired.`);
    }
    if (consent.purpose !== 'VERIFICATION_CHECK') {
      // A code, so a screen can say why in plain words: a lead's own consent (CONTACT, LOAN_PROCESSING) is not a verification consent.
      throw AppError.of(
        'VALIDATION_ERROR',
        `Consent record purpose is ${consent.purpose}; expected VERIFICATION_CHECK.`,
        [{ field: 'consentRecordId', issue: 'CONSENT_PURPOSE_MISMATCH' }],
      );
    }

    // The consent must belong to the subject being verified. A consent given by one person cannot support a check of another
    // (AUD-P1-03). A loan application's subject is its customer.
    const expected: { type: string; id: string } | null =
      input.subjectType === 'LOAN_APPLICATION'
        ? await sql<{ customer_id: string }>`
            SELECT customer_id FROM app.loan_application
             WHERE tenant_id = ${ctx.principal.tenantId} AND id = ${input.subjectId}
             LIMIT 1`
            .execute(tx)
            .then((r) => (r.rows[0] ? { type: 'CUSTOMER', id: r.rows[0].customer_id } : null))
        : { type: input.subjectType, id: input.subjectId };
    if (!expected || consent.subject_type !== expected.type || consent.subject_id !== expected.id) {
      throw AppError.of(
        'VALIDATION_ERROR',
        'The consent record is not a consent of the subject being verified.',
        [{ field: 'consentRecordId', issue: 'CONSENT_SUBJECT_MISMATCH' }],
      );
    }
  }

  /**
   * API-VER-003: POST /v1/verifications/checks
   * The server runs a provider check (PAN, GST or the bank-account penny drop) and stores the result as a PROVIDER_AUTOMATED
   * verification (ENT-064). The caller never states the result. Everything happens in ONE tenant transaction under the
   * Idempotency-Key, so a concurrent duplicate request waits on the idempotency row and then replays: one key never calls the vendor
   * twice. A vendor error is thrown, so nothing is stored and the same key can be retried; a retryable error is never stored as a
   * result.
   *
   * The bank-account check moves Rs 1, so it follows the money rule (see KycCheckPort): when it cannot be known whether the transfer
   * was sent, the port returns an INCONCLUSIVE / OUTCOME_UNKNOWN result instead of throwing. It is stored like any other result, so
   * the key is used up and a retry with it replays the record without calling the vendor. A new key is a deliberate new attempt.
   */
  async runCheck(
    ctx: RequestContext,
    input: RunVerificationCheck,
    idempotencyKey: string,
  ): Promise<{ verification: VerificationRecord; isReplayed?: boolean }> {
    this.deps.authz.requirePermission(ctx, 'verification.perform');
    const kycPort = this.deps.kycPort;
    if (!kycPort) {
      throw AppError.of('DEPENDENCY_UNAVAILABLE', 'Provider KYC checks are not configured on this server.');
    }

    // withIdempotency stores a plain SHA-256 of the whole request, and a PAN or an account number hashed that way can be brute-forced
    // offline. So it is given a body in which the identifier (PAN, GSTIN or account number) and the name are replaced by keyed hashes
    // (the key comes from the deployment secret). The IFSC code is a public branch code and stays as it is.
    const key = this.kycKey();
    const keyed = (label: string, value: string) =>
      crypto.createHmac('sha256', key).update(`${label}\n${value}`).digest('hex');
    const identifier =
      input.check === 'BANK_ACCOUNT'
        ? { accountNumber: keyed('accountNumber', input.accountNumber), ifsc: input.ifsc }
        : { idNumber: keyed('idNumber', input.idNumber) };
    const keyedBody = {
      check: input.check,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      consentRecordId: input.consentRecordId,
      purpose: input.purpose,
      ...identifier,
      ...(input.name !== undefined ? { name: keyed('name', input.name) } : {}),
    };
    // The vendor's case id is stable for one Idempotency-Key (the same scope the key has: tenant, user, key), so a retry after a
    // timeout reaches the vendor with the same case id and the vendor can recognise it.
    const caseId = `idem_${keyed('case', `${ctx.principal.tenantId}:${ctx.principal.id}:${idempotencyKey}`).slice(0, 20)}`;

    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const result = await withIdempotency(
        tx,
        ctx,
        { key: idempotencyKey, method: 'POST', path: '/v1/verifications/checks', body: keyedBody },
        async () => {
          // 1. No check is paid for without an active VERIFICATION_CHECK consent of this subject.
          await this.assertConsentFor(tx, ctx, input);

          // 2. The vendor call. The full identifier leaves here and nowhere else; a vendor error is thrown from here (for a bank check
          //    only an error that proves nothing was sent; an unknown outcome comes back as a result, see the money rule above).
          //    A bank check sends Rs 1 before its record exists, so the database is asked first whether it can store the check type.
          if (input.check === 'BANK_ACCOUNT') await this.assertCheckTypeStorable(tx, input.check);
          const named = input.name !== undefined ? { name: input.name } : {};
          const request: KycCheckRequest =
            input.check === 'BANK_ACCOUNT'
              ? {
                  check: 'BANK_ACCOUNT',
                  accountNumber: input.accountNumber,
                  ifsc: input.ifsc,
                  ...named,
                  caseId,
                }
              : { check: input.check, idNumber: input.idNumber, ...named, caseId };
          const outcome = await kycPort.run(tx, ctx, request);

          // 3. Store the result: masked values only, immutable (ENT-064).
          const verId = `ver_${nextUlid()}`;
          const evidenceRef = `${outcome.provider}:${outcome.referenceId ?? caseId}`;
          await sql`
            INSERT INTO app.verification (
              id, tenant_id, subject_type, subject_id, check_type, method,
              purpose, consent_record_id, result, minimal_result, evidence_ref,
              validity_expires_at, performed_by, performed_at, notes,
              lock_version, created_at
            ) VALUES (
              ${verId}, ${ctx.principal.tenantId}, ${input.subjectType}, ${input.subjectId},
              ${input.check}, 'PROVIDER_AUTOMATED', ${input.purpose}, ${input.consentRecordId},
              ${outcome.verificationResult}, ${JSON.stringify(outcome.minimalResult)}::jsonb, ${evidenceRef},
              ${null}, ${ctx.principal.id}, ${ctx.now}, ${null},
              0, ${ctx.now}
            )
          `.execute(tx);

          // 4. Audit in the same transaction. No identifier, no name: the masked identifier only.
          await this.deps.audit.record(tx, ctx, {
            action: 'verification.performed',
            entityType: 'verification',
            entityId: verId,
            after: {
              subjectType: input.subjectType,
              subjectId: input.subjectId,
              checkType: input.check,
              method: 'PROVIDER_AUTOMATED',
              purpose: input.purpose,
              result: outcome.verificationResult,
              consentRecordId: input.consentRecordId,
              evidenceRef,
              provider: outcome.provider,
              maskedIdentifier: outcome.identifierMasked,
              performedBy: ctx.principal.id,
            },
          });

          const nowIso = ctx.now.toISOString();
          const record: VerificationRecord = {
            id: verId,
            tenantId: ctx.principal.tenantId,
            subjectType: input.subjectType,
            subjectId: input.subjectId,
            checkType: input.check,
            method: 'PROVIDER_AUTOMATED',
            purpose: input.purpose,
            consentRecordId: input.consentRecordId,
            result: outcome.verificationResult,
            minimalResult: outcome.minimalResult,
            evidenceRef,
            validityExpiresAt: null,
            performedBy: ctx.principal.id,
            performedAt: nowIso,
            notes: null,
            lockVersion: 0,
            createdAt: nowIso,
          };
          return { status: 201, body: record, resourceRef: verId };
        },
      );
      return { verification: result.body, isReplayed: result.replayed };
    });
  }

  /**
   * A bank check sends Rs 1 BEFORE its record is stored. If the database does not accept the check type yet (migration 0138 not applied),
   * the insert would fail after the transfer, the key would stay unused and a retry would send the Rs 1 again. So the constraint is read
   * first and the check is refused before anything is sent. A pg_constraint read needs no privilege beyond the connection.
   */
  private async assertCheckTypeStorable(tx: Tx, checkType: string): Promise<void> {
    const rules = await sql<{ def: string }>`
      SELECT pg_get_constraintdef(k.oid) AS def
        FROM pg_constraint k
       WHERE k.conrelid = 'app.verification'::regclass AND k.contype = 'c'
         AND pg_get_constraintdef(k.oid) LIKE '%check_type%'`.execute(tx);
    if (
      !checkTypeIsListed(
        rules.rows.map((r) => r.def),
        checkType,
      )
    ) {
      throw AppError.of(
        'INTERNAL_ERROR',
        'Bank account checks are not ready on this server: the database update 0138 has not been applied. Nothing was sent to the provider.',
      );
    }
  }

  /** A key of its own, derived from the deployment secret (as document-store.ts derives its keys), for the keyed hashes above. */
  private kycKey(): Buffer {
    const secret =
      this.deps.documentLinkSecret && this.deps.documentLinkSecret.length >= 32
        ? this.deps.documentLinkSecret
        : processSecret;
    return crypto.createHmac('sha256', secret).update('dsa:verification-idempotency:v1').digest();
  }

  /**
   * API-VER-002: GET /v1/verifications
   * Lists verification check history with cursor pagination.
   * Requires verification.read permission.
   */
  async listVerifications(
    ctx: RequestContext,
    query: ListVerificationsQuery,
  ): Promise<ListVerificationsResponse> {
    this.deps.authz.requirePermission(ctx, 'verification.read');

    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const limit = query.limit ?? 50;

      const qb = sql<{
        id: string;
        tenant_id: string;
        subject_type: string;
        subject_id: string;
        check_type: string;
        method: string;
        purpose: string;
        consent_record_id: string;
        result: string;
        minimal_result: Record<string, unknown>;
        evidence_ref: string;
        validity_expires_at: Date | null;
        performed_by: string;
        performed_at: Date;
        notes: string | null;
        lock_version: number;
        created_at: Date;
      }>`
        SELECT * FROM app.verification
        WHERE tenant_id = ${ctx.principal.tenantId}
        ${query.subjectType ? sql`AND subject_type = ${query.subjectType}` : sql``}
        ${query.subjectId ? sql`AND subject_id = ${query.subjectId}` : sql``}
        ${query.checkType ? sql`AND check_type = ${query.checkType}` : sql``}
        ${query.result ? sql`AND result = ${query.result}` : sql``}
        ${query.method ? sql`AND method = ${query.method}` : sql``}
        ${query.cursor ? sql`AND id < ${query.cursor}` : sql``}
        ORDER BY id DESC
        LIMIT ${limit + 1}
      `;

      const rows = (await qb.execute(tx)).rows;
      const hasMore = rows.length > limit;
      const dataRows = hasMore ? rows.slice(0, limit) : rows;
      const lastRow = dataRows[dataRows.length - 1];
      const nextCursor = hasMore && lastRow ? lastRow.id : null;

      const data: VerificationRecord[] = dataRows.map((r) => ({
        id: r.id as any,
        tenantId: r.tenant_id as any,
        subjectType: r.subject_type as any,
        subjectId: r.subject_id,
        checkType: r.check_type as any,
        method: r.method as any,
        purpose: r.purpose as any,
        consentRecordId: r.consent_record_id as any,
        result: r.result as any,
        minimalResult: r.minimal_result as any,
        evidenceRef: r.evidence_ref,
        validityExpiresAt: r.validity_expires_at ? new Date(r.validity_expires_at).toISOString() : null,
        performedBy: r.performed_by as any,
        performedAt: new Date(r.performed_at).toISOString(),
        notes: r.notes,
        lockVersion: r.lock_version,
        createdAt: new Date(r.created_at).toISOString(),
      }));

      return { data, meta: { nextCursor, limit } };
    });
  }

  /**
   * Helper: GET /v1/verifications/:id
   */
  async getVerificationById(ctx: RequestContext, id: string): Promise<VerificationRecord> {
    this.deps.authz.requirePermission(ctx, 'verification.read');

    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const res = await sql<{
        id: string;
        tenant_id: string;
        subject_type: string;
        subject_id: string;
        check_type: string;
        method: string;
        purpose: string;
        consent_record_id: string;
        result: string;
        minimal_result: Record<string, unknown>;
        evidence_ref: string;
        validity_expires_at: Date | null;
        performed_by: string;
        performed_at: Date;
        notes: string | null;
        lock_version: number;
        created_at: Date;
      }>`
        SELECT * FROM app.verification
        WHERE tenant_id = ${ctx.principal.tenantId} AND id = ${id}
        LIMIT 1
      `.execute(tx);

      const r = res.rows[0];
      if (!r) {
        throw AppError.of('NOT_FOUND', `Verification check ${id} not found.`);
      }

      return {
        id: r.id as any,
        tenantId: r.tenant_id as any,
        subjectType: r.subject_type as any,
        subjectId: r.subject_id,
        checkType: r.check_type as any,
        method: r.method as any,
        purpose: r.purpose as any,
        consentRecordId: r.consent_record_id as any,
        result: r.result as any,
        minimalResult: r.minimal_result as any,
        evidenceRef: r.evidence_ref,
        validityExpiresAt: r.validity_expires_at ? new Date(r.validity_expires_at).toISOString() : null,
        performedBy: r.performed_by as any,
        performedAt: new Date(r.performed_at).toISOString(),
        notes: r.notes,
        lockVersion: r.lock_version,
        createdAt: new Date(r.created_at).toISOString(),
      };
    });
  }
}
