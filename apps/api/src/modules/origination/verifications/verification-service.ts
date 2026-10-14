// apps/api/src/modules/origination/verifications/verification-service.ts
// Module 22: Verification (MOD-VER) — Service implementation
import {
  AppError,
  type CreateVerificationInput,
  type ListVerificationsQuery,
  type ListVerificationsResponse,
  type RequestContext,
  type VerificationRecord,
} from '@dsa/contracts';
import { withIdempotency } from '@dsa/kernel';
import { sql } from 'kysely';
import { monotonicFactory } from 'ulid';
import type { ApiDeps } from '../../types';

const nextUlid = monotonicFactory();

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
          // 1. Consent Gate: Verify active consent record
          const consentRes = await sql<{
            id: string;
            status: string;
            purpose: string;
            purpose_target: string | null;
            expires_at: Date | null;
          }>`
            SELECT id, status, purpose, purpose_target, expires_at
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
            throw AppError.of(
              'VALIDATION_ERROR',
              `Consent record purpose is ${consent.purpose}; expected VERIFICATION_CHECK.`,
            );
          }

          // 2. Generate unique verification ID
          const verId = `ver_${nextUlid()}`;
          const nowIso = ctx.now.toISOString();
          const validityExpiresAt = input.validityExpiresAt
            ? new Date(input.validityExpiresAt)
            : null;

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
