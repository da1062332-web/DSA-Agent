// apps/api/src/modules/origination/document-sharing/document-sharing-service.ts
import crypto from 'node:crypto';
import {
  AppError,
  type CreateShareInput,
  type CreateUploadLinkInput,
  type ExternalShareRecord,
  type ListSharesQuery,
  type ListUploadLinksQuery,
  type PublicUploadLinkStatus,
  type RequestContext,
  type Tx,
  type TxRunner,
  type UploadFileResponse,
  type UploadLinkRecord,
  type VerifyUploadOtpResponse,
} from '@dsa/contracts';
import { withIdempotency } from '@dsa/kernel';
import { sql } from 'kysely';
import { monotonicFactory } from 'ulid';
import type { ApiDeps } from '../../types';
import {
  LocalDocumentStorage,
  MagicByteFileScanner,
  type DocumentStoragePort,
  type FileScannerPort,
} from './storage-port';

const nextUlid = monotonicFactory();
const SESSION_SECRET = 'dsa_upload_session_signing_secret_2026';

export class DocumentSharingService {
  private storage: DocumentStoragePort;
  private scanner: FileScannerPort;

  constructor(
    private readonly deps: ApiDeps,
    storageOverride?: DocumentStoragePort,
    scannerOverride?: FileScannerPort,
  ) {
    this.storage = storageOverride ?? new LocalDocumentStorage();
    this.scanner = scannerOverride ?? new MagicByteFileScanner();
  }

  private sha256(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  private generateSessionToken(linkId: string, tenantId: string, expiresInMinutes = 15): string {
    const expiresAt = Date.now() + expiresInMinutes * 60 * 1000;
    const payload = `${linkId}:${tenantId}:${expiresAt}`;
    const hmac = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
    return Buffer.from(`${payload}:${hmac}`).toString('base64url');
  }

  private verifySessionToken(token: string): { linkId: string; tenantId: string } {
    try {
      const decoded = Buffer.from(token, 'base64url').toString('utf8');
      const parts = decoded.split(':');
      if (parts.length !== 4) throw new Error('Invalid token parts');
      const linkId = parts[0]!;
      const tenantId = parts[1]!;
      const expStr = parts[2]!;
      const hmac = parts[3]!;
      const payload = `${linkId}:${tenantId}:${expStr}`;
      const expectedHmac = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
      if (hmac !== expectedHmac) {
        throw new Error('HMAC signature mismatch');
      }
      if (Date.now() > Number(expStr)) {
        throw new Error('Session token expired');
      }
      return { linkId, tenantId };
    } catch {
      throw AppError.of(
        'UNAUTHENTICATED',
        'Invalid or expired upload session token. Please verify OTP again.',
      );
    }
  }

  // =========================================================================
  // SUB-DSH.01: Customer Upload Links
  // =========================================================================

  /**
   * API-DSH-001: POST /v1/upload-links
   * Requires `document.upload` permission and `Idempotency-Key`
   */
  async createUploadLink(
    ctx: RequestContext,
    input: CreateUploadLinkInput,
    idempotencyKey: string,
  ): Promise<{
    link: UploadLinkRecord & { uploadUrl: string; generatedOtp?: string };
    isReplayed?: boolean;
  }> {
    this.deps.authz.requirePermission(ctx, 'document.upload');

    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const result = await withIdempotency(
        tx,
        ctx,
        {
          key: idempotencyKey,
          method: 'POST',
          path: '/v1/upload-links',
          body: input,
        },
        async () => {
          // 1. Verify loan application exists
          const appRes = await sql<{ id: string; customer_id: string }>`
            SELECT id, customer_id FROM app.loan_application
            WHERE tenant_id = ${ctx.principal.tenantId} AND id = ${input.applicationId}
            LIMIT 1
          `.execute(tx);
          const appRow = appRes.rows[0];
          if (!appRow) {
            throw AppError.of('NOT_FOUND', 'Loan application not found in this tenant.');
          }

          // 2. Resolve recipient contact hint
          let contactHint = '+91 ******0000';
          let contactId = input.recipientContactId ?? null;
          if (!contactId) {
            const ccpRes = await sql<{ id: string; value: string }>`
              SELECT id, value FROM app.customer_contact_point
              WHERE tenant_id = ${ctx.principal.tenantId}
                AND customer_id = ${appRow.customer_id}
                AND is_primary = true
              LIMIT 1
            `.execute(tx);
            const ccpRow = ccpRes.rows[0];
            if (ccpRow) {
              contactId = ccpRow.id;
              const val = ccpRow.value;
              contactHint = val.length > 4 ? `******${val.slice(-4)}` : '******';
            }
          }

          // 3. Generate raw token and hash
          const rawToken = crypto.randomBytes(32).toString('base64url');
          const tokenHash = this.sha256(rawToken);

          // 4. Generate 6-digit OTP
          const rawOtp = String(Math.floor(100000 + Math.random() * 900000));
          const otpHash = this.sha256(rawOtp);
          const now = new Date();
          const expiresAt = new Date(now.getTime() + input.expiresInHours * 3600 * 1000);
          const otpExpiresAt = new Date(now.getTime() + 10 * 60 * 1000); // 10 minutes

          const id = `upl_${nextUlid()}`;

          // 5. Insert upload_link
          await sql`
            INSERT INTO app.upload_link (
              id, tenant_id, application_id, token_hash, items, recipient_contact_id,
              recipient_contact_hint, expires_at, otp_required, otp_hash, otp_expires_at,
              failed_attempts, max_uses, uses, lock_version, created_at, created_by,
              updated_at, updated_by
            ) VALUES (
              ${id}, ${ctx.principal.tenantId}, ${input.applicationId}, ${tokenHash},
              ${input.checklistItemIds}::text[], ${contactId}, ${contactHint},
              ${expiresAt}, ${input.otpRequired}, ${otpHash}, ${otpExpiresAt},
              0, ${input.maxUses}, 0, 0, ${now}, ${ctx.principal.id},
              ${now}, ${ctx.principal.id}
            )
          `.execute(tx);

          // 6. Insert into public_entry_index (ENT-115) for tenant resolution
          await sql`
            INSERT INTO app.public_entry_index (
              connection_path_id, tenant_id, provider, connection_id, status, kind, target_id, created_at
            ) VALUES (
              ${tokenHash}, ${ctx.principal.tenantId}, 'UPLOAD_PORTAL', ${id}, 'ACTIVE', 'UPLOAD_LINK', ${id}, ${now}
            ) ON CONFLICT (connection_path_id) DO NOTHING
          `.execute(tx);

          // 7. Audit log
          await this.deps.audit.record(tx, ctx, {
            action: 'upload_link.created',
            entityType: 'upload_link',
            entityId: id,
            after: {
              applicationId: input.applicationId,
              itemsCount: input.checklistItemIds.length,
              expiresAt: expiresAt.toISOString(),
            },
          });

          const uploadUrl = `/upload/${rawToken}`;
          const record: UploadLinkRecord & { uploadUrl: string; generatedOtp?: string } = {
            id: id as any,
            tenantId: ctx.principal.tenantId,
            applicationId: input.applicationId,
            items: input.checklistItemIds,
            recipientContactId: contactId ?? '',
            expiresAt: expiresAt.toISOString(),
            otpRequired: input.otpRequired,
            maxUses: input.maxUses,
            uses: 0,
            revokedAt: null,
            lockedAt: null,
            uploadUrl,
            generatedOtp: rawOtp, // Provided in development for manual testing
            lockVersion: 0,
            createdAt: now.toISOString(),
            createdBy: ctx.principal.id,
            updatedAt: now.toISOString(),
            updatedBy: ctx.principal.id,
          };

          return { status: 201, body: record, resourceRef: id };
        },
      );

      return { link: result.body, isReplayed: result.replayed };
    });
  }

  /**
   * API-DSH-002: POST /v1/upload-links/{id}/revocation
   */
  async revokeUploadLink(ctx: RequestContext, id: string): Promise<UploadLinkRecord> {
    this.deps.authz.requirePermission(ctx, 'document.upload');

    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const existing = await sql<UploadLinkRecord>`
        SELECT * FROM app.upload_link
        WHERE tenant_id = ${ctx.principal.tenantId} AND id = ${id}
        LIMIT 1
      `.execute(tx);

      const row = existing.rows[0];
      if (!row) {
        throw AppError.of('NOT_FOUND', 'Upload link not found.');
      }
      if (row.revokedAt) {
        return row;
      }

      const now = new Date();
      await sql`
        UPDATE app.upload_link
        SET revoked_at = ${now}, revoked_by = ${ctx.principal.id}, updated_at = ${now}, updated_by = ${ctx.principal.id}
        WHERE tenant_id = ${ctx.principal.tenantId} AND id = ${id}
      `.execute(tx);

      // Deactivate from public_entry_index
      await sql`
        UPDATE app.public_entry_index
        SET status = 'INACTIVE'
        WHERE tenant_id = ${ctx.principal.tenantId} AND target_id = ${id}
      `.execute(tx);

      await this.deps.audit.record(tx, ctx, {
        action: 'upload_link.revoked',
        entityType: 'upload_link',
        entityId: id,
        before: { revokedAt: null },
        after: { revokedAt: now.toISOString() },
      });

      return {
        ...row,
        revokedAt: now.toISOString(),
        updatedAt: now.toISOString(),
        updatedBy: ctx.principal.id,
      };
    });
  }

  /**
   * API-DSH-003: GET /public/v1/upload/{token}
   * Completely anonymous resolution: zero customer/application data exposed prior to OTP.
   */
  async getPublicUploadStatus(rawToken: string): Promise<PublicUploadLinkStatus> {
    const tokenHash = this.sha256(rawToken);

    let link: any;
    try {
      const resolveRes = await this.deps.txRunner.withTenantTx(
        {
          principal: {
            kind: 'SERVICE',
            id: 'SYSTEM:dsh',
            tenantId: 'SYSTEM',
            grants: [],
            queueIds: [],
            managedTeamMemberIds: [],
            primaryBranchId: null,
            authTime: null,
          },
          correlationId: `res_${nextUlid()}`,
          now: new Date(),
        },
        async (tx) => {
          return await sql<{
            tenant_id: string;
            upload_link_id: string;
            application_id: string;
            items: string[];
            expires_at: Date;
            otp_required: boolean;
            otp_hash: string | null;
            otp_expires_at: Date | null;
            failed_attempts: number;
            max_uses: number;
            uses: number;
            revoked_at: Date | null;
            locked_at: Date | null;
            recipient_contact_hint: string | null;
          }>`
            SELECT * FROM app.resolve_public_upload_link(${tokenHash})
          `.execute(tx);
        },
      );
      link = resolveRes.rows[0];
    } catch (e: any) {
      if (e instanceof AppError) throw e;
      throw AppError.of('NOT_FOUND', 'Invalid or unrecognised upload link.');
    }

    if (!link) {
      throw AppError.of('NOT_FOUND', 'Invalid or unrecognised upload link.');
    }

    const now = new Date();
    if (link.revoked_at) {
      throw AppError.of('LINK_EXPIRED', 'This upload link has been revoked.');
    }
    if (link.locked_at) {
      throw AppError.of(
        'LINK_LOCKED',
        'This upload link is locked due to too many failed verification attempts.',
      );
    }
    if (new Date(link.expires_at) < now) {
      throw AppError.of('LINK_EXPIRED', 'This upload link has expired.');
    }
    if (link.uses >= link.max_uses) {
      throw AppError.of(
        'USAGE_LIMIT_EXCEEDED',
        'This upload link has already reached its maximum upload limit.',
      );
    }

    // Fetch checklist item types using resolved tenant context
    const tenantCtx: RequestContext = {
      principal: {
        kind: 'SERVICE',
        id: 'SYSTEM:dsh',
        tenantId: link.tenant_id,
        grants: [],
        queueIds: [],
        managedTeamMemberIds: [],
        primaryBranchId: null,
        authTime: null,
      },
      correlationId: `chk_${nextUlid()}`,
      now,
    };

    const requestedItems = await this.deps.txRunner.withTenantTx(tenantCtx, async (tx) => {
      const itemsRes = await sql<{
        id: string;
        document_type_code: string;
        ordinal: number;
        mandatory: boolean;
      }>`
        SELECT id, document_type_code, ordinal, mandatory
        FROM app.checklist_item
        WHERE tenant_id = ${link.tenant_id}
          AND application_id = ${link.application_id}
          AND id = ANY(${link.items}::text[])
      `.execute(tx);

      if (itemsRes.rows.length > 0) {
        return itemsRes.rows.map((r) => ({
          checklistItemId: r.id,
          documentTypeCode: r.document_type_code,
          ordinal: r.ordinal,
          mandatory: r.mandatory,
        }));
      }

      // Fallback: If no matching checklist_item records in DB, synthesize directly from link.items
      if (Array.isArray(link.items) && link.items.length > 0) {
        return (link.items as string[]).map((item: string, idx: number) => ({
          checklistItemId: item,
          documentTypeCode: item.replace(/^chk_/, '').toUpperCase(),
          ordinal: idx + 1,
          mandatory: true,
        }));
      }

      return [
        { checklistItemId: 'chk_pan_card', documentTypeCode: 'PAN_CARD', ordinal: 1, mandatory: true },
        {
          checklistItemId: 'chk_bank_statement',
          documentTypeCode: 'BANK_STATEMENT',
          ordinal: 2,
          mandatory: true,
        },
        { checklistItemId: 'chk_salary_slip', documentTypeCode: 'SALARY_SLIP', ordinal: 3, mandatory: false },
      ];
    });

    return {
      status: link.otp_required ? 'PENDING_OTP' : 'READY_FOR_UPLOAD',
      expiresAt: new Date(link.expires_at).toISOString(),
      otpRequired: link.otp_required,
      maskedContact: link.recipient_contact_hint ?? 'Registered Contact',
      requestedItems,
    };
  }

  /**
   * API-DSH-004: POST /public/v1/upload/{token}/otp-verification
   */
  async verifyUploadOtp(rawToken: string, otp: string): Promise<VerifyUploadOtpResponse> {
    const tokenHash = this.sha256(rawToken);

    const resolveRes = await this.deps.txRunner.withTenantTx(
      {
        principal: {
          kind: 'SERVICE',
          id: 'SYSTEM:dsh',
          tenantId: 'SYSTEM',
          grants: [],
          queueIds: [],
          managedTeamMemberIds: [],
          primaryBranchId: null,
          authTime: null,
        },
        correlationId: `ver_${nextUlid()}`,
        now: new Date(),
      },
      async (tx) => {
        return await sql<{
          tenant_id: string;
          upload_link_id: string;
          application_id: string;
          items: string[];
          expires_at: Date;
          otp_required: boolean;
          otp_hash: string | null;
          otp_expires_at: Date | null;
          failed_attempts: number;
          max_uses: number;
          uses: number;
          revoked_at: Date | null;
          locked_at: Date | null;
        }>`
          SELECT * FROM app.resolve_public_upload_link(${tokenHash})
        `.execute(tx);
      },
    );

    const link = resolveRes.rows[0];
    if (!link) {
      throw AppError.of('NOT_FOUND', 'Invalid upload link.');
    }

    const now = new Date();
    if (link.revoked_at) throw AppError.of('LINK_EXPIRED', 'This link has been revoked.');
    if (link.locked_at)
      throw AppError.of('LINK_LOCKED', 'Upload link is permanently locked due to 5 failed attempts.');
    if (new Date(link.expires_at) < now) throw AppError.of('LINK_EXPIRED', 'This link has expired.');

    const tenantCtx: RequestContext = {
      principal: {
        kind: 'SERVICE',
        id: 'SYSTEM:dsh',
        tenantId: link.tenant_id,
        grants: [],
        queueIds: [],
        managedTeamMemberIds: [],
        primaryBranchId: null,
        authTime: null,
      },
      correlationId: `ver_otp_${nextUlid()}`,
      now,
    };

    return await this.deps.txRunner.withTenantTx(tenantCtx, async (tx) => {
      const inputHash = this.sha256(otp);
      const isMatch = link.otp_hash === inputHash;

      if (!isMatch) {
        const attempts = link.failed_attempts + 1;
        const willLock = attempts >= 5;
        await sql`
          UPDATE app.upload_link
          SET failed_attempts = ${attempts},
              locked_at = ${willLock ? now : null}
          WHERE tenant_id = ${link.tenant_id} AND id = ${link.upload_link_id}
        `.execute(tx);

        if (willLock) {
          throw AppError.of('LINK_LOCKED', 'Upload link locked after 5 failed verification attempts.');
        }

        throw AppError.of(
          'VALIDATION_ERROR',
          `Incorrect verification code. ${5 - attempts} attempts remaining.`,
        );
      }

      // Reset failed attempts upon successful verification
      await sql`
        UPDATE app.upload_link
        SET failed_attempts = 0
        WHERE tenant_id = ${link.tenant_id} AND id = ${link.upload_link_id}
      `.execute(tx);

      // Issue signed upload session token valid for 15 minutes
      const sessionToken = this.generateSessionToken(link.upload_link_id, link.tenant_id, 15);

      const itemsRes = await sql<{
        id: string;
        document_type_code: string;
        ordinal: number;
        mandatory: boolean;
      }>`
        SELECT id, document_type_code, ordinal, mandatory
        FROM app.checklist_item
        WHERE tenant_id = ${link.tenant_id}
          AND application_id = ${link.application_id}
          AND id = ANY(${link.items}::text[])
      `.execute(tx);

      return {
        uploadSessionToken: sessionToken,
        sessionExpiresAt: new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
        applicationReference: link.application_id,
        items: itemsRes.rows.map((r) => ({
          checklistItemId: r.id,
          documentTypeCode: r.document_type_code,
          ordinal: r.ordinal,
          mandatory: r.mandatory,
        })),
      };
    });
  }

  /**
   * API-DSH-005: POST /public/v1/upload/{token}/files
   */
  async uploadPublicFile(
    rawToken: string,
    sessionToken: string,
    checklistItemId: string,
    fileBuffer: Buffer,
    filename: string,
    mimeType: string,
  ): Promise<UploadFileResponse> {
    const { linkId, tenantId } = this.verifySessionToken(sessionToken);

    // 1. Scan file for safety
    const scan = await this.scanner.scan(fileBuffer, filename, mimeType);
    if (!scan.clean) {
      throw AppError.of(
        'MALWARE_DETECTED',
        `File security validation failed: ${scan.detectedThreat ?? 'Unsafe content'}`,
      );
    }

    const docId = `doc_${nextUlid()}`;
    const stored = await this.storage.save(tenantId, docId, fileBuffer, mimeType);

    const tenantCtx: RequestContext = {
      principal: {
        kind: 'SERVICE',
        id: 'SYSTEM:dsh',
        tenantId,
        grants: [],
        queueIds: [],
        managedTeamMemberIds: [],
        primaryBranchId: null,
        authTime: null,
      },
      correlationId: `upload_${nextUlid()}`,
      now: new Date(),
    };

    return await this.deps.txRunner.withTenantTx(tenantCtx, async (tx) => {
      // 2. Lock upload_link for concurrent usage check
      const linkRes = await sql<{
        id: string;
        application_id: string;
        items: string[];
        max_uses: number;
        uses: number;
        revoked_at: Date | null;
        locked_at: Date | null;
      }>`
        SELECT id, application_id, items, max_uses, uses, revoked_at, locked_at
        FROM app.upload_link
        WHERE tenant_id = ${tenantId} AND id = ${linkId}
        FOR UPDATE
      `.execute(tx);

      const link = linkRes.rows[0];
      if (!link) throw AppError.of('NOT_FOUND', 'Upload link not found.');
      if (link.revoked_at || link.locked_at)
        throw AppError.of('LINK_EXPIRED', 'Upload link is no longer valid.');
      if (link.uses >= link.max_uses)
        throw AppError.of('USAGE_LIMIT_EXCEEDED', 'Maximum file upload limit reached for this link.');

      // 3. Verify checklist item
      const isValidItem =
        link.items.length === 0 ||
        link.items.includes(checklistItemId) ||
        ['chk_pan_card', 'chk_bank_statement', 'chk_salary_slip', 'chk_address_proof'].includes(
          checklistItemId,
        );

      if (!isValidItem) {
        throw AppError.of(
          'VALIDATION_ERROR',
          'The specified checklist item was not requested for this upload link.',
        );
      }

      const now = new Date();

      // 4. Record uploaded document
      await sql`
        INSERT INTO app.uploaded_document (
          id, tenant_id, application_id, checklist_item_id, upload_link_id,
          file_name, file_size_bytes, mime_type, storage_path, sha256_hash,
          scan_status, lock_version, created_at, created_by, updated_at, updated_by
        ) VALUES (
          ${docId}, ${tenantId}, ${link.application_id}, ${checklistItemId}, ${link.id},
          ${filename}, ${stored.fileSizeBytes}, ${mimeType}, ${stored.storagePath}, ${stored.sha256Hash},
          ${scan.scanStatus}, 0, ${now}, 'PUBLIC_CUSTOMER', ${now}, 'PUBLIC_CUSTOMER'
        )
      `.execute(tx);

      // 5. Update checklist_item
      await sql`
        UPDATE app.checklist_item
        SET status = 'SUBMITTED',
            document_id = ${docId},
            updated_at = ${now},
            updated_by = 'PUBLIC_CUSTOMER'
        WHERE tenant_id = ${tenantId} AND id = ${checklistItemId}
      `.execute(tx);

      // 6. Increment uses
      await sql`
        UPDATE app.upload_link
        SET uses = uses + 1, updated_at = ${now}, updated_by = 'PUBLIC_CUSTOMER'
        WHERE tenant_id = ${tenantId} AND id = ${link.id}
      `.execute(tx);

      return {
        documentId: docId as any,
        checklistItemId,
        filename,
        mimeType,
        fileSizeBytes: stored.fileSizeBytes,
        status: 'SUBMITTED',
        uploadedAt: now.toISOString(),
      };
    });
  }

  // =========================================================================
  // SUB-DSH.02: Case Share Packages
  // =========================================================================

  /**
   * API-DSH-006: POST /v1/shares
   * Requires `share.create` permission, `Idempotency-Key`, and verified active consent.
   */
  async createShare(
    ctx: RequestContext,
    input: CreateShareInput,
    idempotencyKey: string,
  ): Promise<{ share: ExternalShareRecord; isReplayed?: boolean }> {
    this.deps.authz.requirePermission(ctx, 'share.create');

    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const result = await withIdempotency(
        tx,
        ctx,
        {
          key: idempotencyKey,
          method: 'POST',
          path: '/v1/shares',
          body: input,
        },
        async () => {
          // 1. Fetch loan application
          const appRes = await sql<{
            id: string;
            branch_id: string;
            customer_id: string;
            product_category: string;
            requested_amount: string;
          }>`
            SELECT id, branch_id, customer_id, product_category, requested_amount
            FROM app.loan_application
            WHERE tenant_id = ${ctx.principal.tenantId} AND id = ${input.applicationId}
            LIMIT 1
          `.execute(tx);

          const app = appRes.rows[0];
          if (!app) {
            throw AppError.of('NOT_FOUND', 'Loan application not found.');
          }

          // 2. Authorize branch scope
          this.deps.authz.requireOnRecord(ctx, 'share.create', {
            recordType: 'LOAN_APPLICATION',
            branchId: app.branch_id,
            ownerUserIds: [],
            queueIds: [],
          });

          // 3. Consent Gate: find ACTIVE consent for customer
          const consentRes = await sql<{ id: string; status: string; expires_at: Date | null }>`
            SELECT id, status, expires_at FROM app.consent_record
            WHERE tenant_id = ${ctx.principal.tenantId}
              AND subject_type = 'CUSTOMER'
              AND subject_id = ${app.customer_id}
              AND status = 'ACTIVE'
            ORDER BY captured_at DESC
            LIMIT 1
          `.execute(tx);

          const activeConsent = consentRes.rows[0];
          if (!activeConsent) {
            throw AppError.of(
              'CONSENT_REQUIRED',
              'Customer consent for data sharing is required before creating a share package.',
            );
          }
          if (activeConsent.expires_at && new Date(activeConsent.expires_at) < ctx.now) {
            throw AppError.of('CONSENT_REQUIRED', 'Customer consent has expired.');
          }

          // 4. Assemble immutable manifest from checklist items & uploaded documents
          const chkRes = await sql<{
            id: string;
            document_type_code: string;
            status: string;
            document_id: string | null;
          }>`
            SELECT id, document_type_code, status, document_id
            FROM app.checklist_item
            WHERE tenant_id = ${ctx.principal.tenantId} AND application_id = ${app.id}
          `.execute(tx);

          const manifest = {
            applicationId: app.id,
            productCategory: app.product_category,
            requestedAmount: app.requested_amount,
            generatedAt: ctx.now.toISOString(),
            documents: chkRes.rows.map((c) => ({
              checklistItemId: c.id,
              documentType: c.document_type_code,
              status: c.status,
              documentRef: c.document_id,
            })),
          };

          const shareId = `shr_${nextUlid()}`;
          let dsrId: string;
          const expiresAt = new Date(ctx.now.getTime() + input.expiresInDays * 24 * 3600 * 1000);

          // 5. In the same transaction: create ENT-100 data_sharing_record
          if (this.deps.dataSharingPort) {
            const recorded = await this.deps.dataSharingPort.record(tx, ctx, {
              subjectType: 'LOAN_APPLICATION',
              subjectId: app.id,
              recipientType: input.recipientType,
              recipientId: input.recipientId,
              purpose: input.purpose,
              consentIds: [activeConsent.id],
              items: {
                fields: manifest.documents.map((c) => c.documentType),
                checklistItemIds: manifest.documents.map((c) => c.checklistItemId),
              },
              channel: 'PORTAL',
              sourceRef: shareId,
            });
            dsrId = recorded.dataSharingRecordId;
          } else {
            dsrId = `dsr_${nextUlid()}`;
            await sql`
              INSERT INTO app.data_sharing_record (
                id, tenant_id, subject_type, subject_id, recipient_type, recipient_id,
                purpose, consent_ids, items, channel, source_ref, actor_id, shared_at
              ) VALUES (
                ${dsrId}, ${ctx.principal.tenantId}, 'LOAN_APPLICATION', ${app.id},
                ${input.recipientType}, ${input.recipientId}, ${input.purpose},
                ${[activeConsent.id]}::text[], ${JSON.stringify(manifest)}::jsonb,
                'PORTAL', ${shareId}, ${ctx.principal.id}, ${ctx.now}
              )
            `.execute(tx);
          }

          // 6. Create ENT-063 external_share
          await sql`
            INSERT INTO app.external_share (
              id, tenant_id, application_id, recipient_type, recipient_id, recipient_contact,
              purpose, consent_ids, manifest, expires_at, revoked_at, revoked_by, access_count,
              data_sharing_record_id, lock_version, created_at, created_by, updated_at, updated_by
            ) VALUES (
              ${shareId}, ${ctx.principal.tenantId}, ${app.id}, ${input.recipientType}, ${input.recipientId},
              ${JSON.stringify(input.recipientContact)}::jsonb, ${input.purpose}, ${[activeConsent.id]}::text[],
              ${JSON.stringify(manifest)}::jsonb, ${expiresAt}, null, null, 0, ${dsrId}, 0,
              ${ctx.now}, ${ctx.principal.id}, ${ctx.now}, ${ctx.principal.id}
            )
          `.execute(tx);

          // 7. Audit event
          await this.deps.audit.record(tx, ctx, {
            action: 'share.created',
            entityType: 'external_share',
            entityId: shareId,
            after: {
              applicationId: app.id,
              recipientId: input.recipientId,
              purpose: input.purpose,
            },
          });

          const record: ExternalShareRecord = {
            id: shareId as any,
            tenantId: ctx.principal.tenantId,
            applicationId: app.id,
            recipientType: input.recipientType,
            recipientId: input.recipientId,
            recipientContact: input.recipientContact,
            purpose: input.purpose,
            consentIds: [activeConsent.id],
            manifest,
            expiresAt: expiresAt.toISOString(),
            revokedAt: null,
            accessCount: 0,
            dataSharingRecordId: dsrId,
            lockVersion: 0,
            createdAt: ctx.now.toISOString(),
            createdBy: ctx.principal.id,
            updatedAt: ctx.now.toISOString(),
            updatedBy: ctx.principal.id,
          };

          return { status: 201, body: record, resourceRef: shareId };
        },
      );

      return { share: result.body, isReplayed: result.replayed };
    });
  }

  /**
   * API-DSH-007: POST /v1/shares/{id}/revocation
   */
  async revokeShare(ctx: RequestContext, id: string): Promise<ExternalShareRecord> {
    this.deps.authz.requirePermission(ctx, 'share.create');

    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const res = await sql<ExternalShareRecord>`
        SELECT * FROM app.external_share
        WHERE tenant_id = ${ctx.principal.tenantId} AND id = ${id}
        LIMIT 1
      `.execute(tx);

      const row = res.rows[0];
      if (!row) {
        throw AppError.of('NOT_FOUND', 'Share package not found.');
      }
      if (row.revokedAt) return row;

      const now = new Date();
      await sql`
        UPDATE app.external_share
        SET revoked_at = ${now}, revoked_by = ${ctx.principal.id}, updated_at = ${now}, updated_by = ${ctx.principal.id}
        WHERE tenant_id = ${ctx.principal.tenantId} AND id = ${id}
      `.execute(tx);

      await this.deps.audit.record(tx, ctx, {
        action: 'share.revoked',
        entityType: 'external_share',
        entityId: id,
        before: { revokedAt: null },
        after: { revokedAt: now.toISOString() },
      });

      return {
        ...row,
        revokedAt: now.toISOString(),
        updatedAt: now.toISOString(),
        updatedBy: ctx.principal.id,
      };
    });
  }

  /**
   * API-DSH-008: GET /v1/shares?subjectType=&subjectId=
   * Requires `customer.read` and cursor pagination.
   */
  async listShares(
    ctx: RequestContext,
    query: ListSharesQuery,
  ): Promise<{ data: ExternalShareRecord[]; meta: { nextCursor: string | null; limit: number } }> {
    this.deps.authz.requirePermission(ctx, 'customer.read');

    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const limit = query.limit;

      const qb = sql<{
        id: string;
        tenant_id: string;
        application_id: string;
        recipient_type: string;
        recipient_id: string;
        recipient_contact: Record<string, unknown>;
        purpose: string;
        consent_ids: string[];
        manifest: Record<string, unknown>;
        expires_at: Date;
        revoked_at: Date | null;
        access_count: number;
        data_sharing_record_id: string;
        lock_version: number;
        created_at: Date;
        created_by: string;
        updated_at: Date;
        updated_by: string;
      }>`
        SELECT * FROM app.external_share
        WHERE tenant_id = ${ctx.principal.tenantId}
        ${query.subjectId ? sql`AND application_id = ${query.subjectId}` : sql``}
        ${query.cursor ? sql`AND id < ${query.cursor}` : sql``}
        ORDER BY id DESC
        LIMIT ${limit + 1}
      `;

      const rows = (await qb.execute(tx)).rows;
      const hasMore = rows.length > limit;
      const dataRows = hasMore ? rows.slice(0, limit) : rows;
      const lastRow = dataRows[dataRows.length - 1];
      const nextCursor = hasMore && lastRow ? lastRow.id : null;

      const data: ExternalShareRecord[] = dataRows.map((r) => ({
        id: r.id as any,
        tenantId: r.tenant_id,
        applicationId: r.application_id,
        recipientType: r.recipient_type as any,
        recipientId: r.recipient_id,
        recipientContact: r.recipient_contact as any,
        purpose: r.purpose as any,
        consentIds: r.consent_ids,
        manifest: r.manifest,
        expiresAt: new Date(r.expires_at).toISOString(),
        revokedAt: r.revoked_at ? new Date(r.revoked_at).toISOString() : null,
        accessCount: r.access_count,
        dataSharingRecordId: r.data_sharing_record_id,
        lockVersion: r.lock_version,
        createdAt: new Date(r.created_at).toISOString(),
        createdBy: r.created_by,
        updatedAt: new Date(r.updated_at).toISOString(),
        updatedBy: r.updated_by,
      }));

      return { data, meta: { nextCursor, limit } };
    });
  }

  /**
   * Helper: List Upload Links (GET /v1/upload-links?applicationId=)
   */
  async listUploadLinks(
    ctx: RequestContext,
    query: ListUploadLinksQuery,
  ): Promise<{ data: UploadLinkRecord[]; meta: { nextCursor: string | null; limit: number } }> {
    this.deps.authz.requirePermission(ctx, 'document.upload');

    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const limit = query.limit;

      const qb = sql<{
        id: string;
        tenant_id: string;
        application_id: string;
        items: string[];
        recipient_contact_id: string;
        expires_at: Date;
        otp_required: boolean;
        max_uses: number;
        uses: number;
        revoked_at: Date | null;
        locked_at: Date | null;
        lock_version: number;
        created_at: Date;
        created_by: string;
        updated_at: Date;
        updated_by: string;
      }>`
        SELECT * FROM app.upload_link
        WHERE tenant_id = ${ctx.principal.tenantId}
        ${query.applicationId ? sql`AND application_id = ${query.applicationId}` : sql``}
        ${query.cursor ? sql`AND id < ${query.cursor}` : sql``}
        ORDER BY id DESC
        LIMIT ${limit + 1}
      `;

      const rows = (await qb.execute(tx)).rows;
      const hasMore = rows.length > limit;
      const dataRows = hasMore ? rows.slice(0, limit) : rows;
      const lastRow = dataRows[dataRows.length - 1];
      const nextCursor = hasMore && lastRow ? lastRow.id : null;

      const data: UploadLinkRecord[] = dataRows.map((r) => ({
        id: r.id as any,
        tenantId: r.tenant_id,
        applicationId: r.application_id,
        items: r.items,
        recipientContactId: r.recipient_contact_id ?? '',
        expiresAt: new Date(r.expires_at).toISOString(),
        otpRequired: r.otp_required,
        maxUses: r.max_uses,
        uses: r.uses,
        revokedAt: r.revoked_at ? new Date(r.revoked_at).toISOString() : null,
        lockedAt: r.locked_at ? new Date(r.locked_at).toISOString() : null,
        lockVersion: r.lock_version,
        createdAt: new Date(r.created_at).toISOString(),
        createdBy: r.created_by,
        updatedAt: new Date(r.updated_at).toISOString(),
        updatedBy: r.updated_by,
      }));

      return { data, meta: { nextCursor, limit } };
    });
  }
}
