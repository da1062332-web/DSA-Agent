// MOD-DOC documents (owner: Dev 3; DSA Notion MODULE 20). Built in the 2026-10-19 audit follow-up on M-071.
//   API-DOC-007 GET  /v1/document-types                         any signed-in user (platform defaults + tenant overrides)
//   API-DOC-008 POST /v1/document-types                         config.manage; Idempotency-Key; create or update by code
//   API-DOC-001 POST /v1/documents/upload-intents               document.upload; Idempotency-Key; returns a signed PUT url
//   (signed url) PUT /public/v1/document-uploads/{token}        the bytes; checked against the intent's size and sha256
//   API-DOC-002 POST /v1/upload-intents/{id}/completion         document.upload; scans and registers the version (202)
//   API-DOC-003 GET  /v1/documents/{id}                         document.view; metadata and versions
//   API-DOC-006 POST /v1/document-versions/{id}/reviews         document.review; Idempotency-Key; accept or reject
//   API-DOC-004 POST /v1/document-versions/{id}/view-url        document.view; logged
//   API-DOC-005 POST /v1/document-versions/{id}/download-url    document.download; logged; step-up for S3 documents
//   (signed url) GET /public/v1/document-files/{token}          serves a version or an archive while the link is valid
//   API-DOC-009 POST /v1/applications/{id}/document-archive     document.download; async encrypted archive (202)
//               GET  /v1/document-archives/{id}                 document.download; archive status and link
//   API-APP-009 POST /v1/applications/{id}/waivers              document.waive; marks a checklist item WAIVED or NOT_APPLICABLE
//   API-APP-008 POST /v1/applications/{id}/completeness-checks  application.read; the checklist decides completeness
//   API-PRV-004 POST /v1/legal-holds                            privacy.manage; GET /v1/legal-holds lists them
// Documents belong to an application: every call is scoped through the application (out of scope or another tenant: 404).
// Audit and outbox events are written in the same transaction as the change.
import {
  AppError,
  CreateLegalHoldSchema,
  CreateUploadIntentSchema,
  DocumentLinkRequestSchema,
  ReviewDocumentVersionSchema,
  UpsertDocumentTypeSchema,
  WaiveChecklistItemSchema,
  type DocumentResource,
  type DocumentType,
  type DocumentVersion,
  type LegalHold,
  type PermissionCode,
  type RequestContext,
  type Tx,
} from '@dsa/contracts';
import { withIdempotency } from '@dsa/kernel';
import express, { type Router } from 'express';
import { zipSync } from 'fflate';
import { sql } from 'kysely';
import crypto from 'node:crypto';
import { idempotencyKey, requireCtx, sendResource } from '../../../http/request';
import type { ApiDeps } from '../../types';
import { MagicByteFileScanner } from '../document-sharing/storage-port';
import { isComplete } from './application-port';
import { applicationScope } from './applications';
import { iso, type Row } from './db';
import {
  decryptArchive,
  encryptArchive,
  FileLinkSigner,
  LocalDocumentObjectStore,
  sha256Hex,
  type DocumentObjectStore,
} from './document-store';

const LINK_TTL_SECONDS = 300;
const UPLOAD_TTL_MINUTES = 15;

/** Platform defaults for the fixed type codes (PA-10); a tenant row with the same code overrides one. */
const DEFAULT_TYPES: Omit<DocumentType, 'custom' | 'version'>[] = (
  [
    ['PAN_CARD', 'PAN card', 'IDENTITY', 'S3'],
    ['AADHAAR_MASKED', 'Aadhaar (masked)', 'IDENTITY', 'S3'],
    ['PHOTO', 'Photograph', 'IDENTITY', 'S2'],
    ['SALARY_SLIP', 'Salary slip', 'INCOME', 'S2'],
    ['BANK_STATEMENT', 'Bank statement', 'BANKING', 'S3'],
    ['ITR', 'Income tax return', 'INCOME', 'S2'],
    ['GST_CERT', 'GST certificate', 'BUSINESS', 'S2'],
    ['BUSINESS_PROOF', 'Business proof', 'BUSINESS', 'S2'],
    ['PROPERTY_DOC', 'Property document', 'PROPERTY', 'S2'],
    ['OTHER', 'Other document', 'OTHER', 'S2'],
  ] as const
).map(([code, name, category, sensitivity]) => ({
  code,
  name,
  category,
  allowedMime: ['application/pdf', 'image/jpeg', 'image/png'],
  maxSizeBytes: 10_485_760,
  validityMonths: null,
  sensitivity,
  retentionClass: 'R-LOAN',
  instructions: null,
  active: true,
}));

export interface DocumentDeps {
  store: DocumentObjectStore;
  signer: FileLinkSigner;
  secret: string;
}

/** The documents dependencies from ApiDeps, or local defaults (development and tests). */
export function documentDeps(deps: ApiDeps): DocumentDeps {
  const secret = deps.documentLinkSecret ?? processSecret;
  return {
    store: (deps.documentStore as DocumentObjectStore | undefined) ?? new LocalDocumentObjectStore(),
    signer: new FileLinkSigner(secret),
    secret,
  };
}
// Without a configured secret (unit tests, local runs) links are valid only for this process.
const processSecret = crypto.randomBytes(32).toString('hex');

const toType = (r: Row): DocumentType => ({
  code: String(r.code),
  name: String(r.name),
  category: r.category as DocumentType['category'],
  allowedMime: r.allowed_mime as string[],
  maxSizeBytes: Number(r.max_size_bytes),
  validityMonths: r.validity_months === null ? null : Number(r.validity_months),
  sensitivity: r.sensitivity as DocumentType['sensitivity'],
  retentionClass: String(r.retention_class),
  instructions: (r.instructions as string | null) ?? null,
  active: Boolean(r.active),
  custom: true,
  version: Number(r.lock_version),
});

const toVersion = (r: Row): DocumentVersion => ({
  id: String(r.id),
  versionNo: Number(r.version_no),
  fileName: String(r.file_name),
  sha256: String(r.sha256),
  sizeBytes: Number(r.size_bytes),
  detectedMime: String(r.detected_mime),
  scanStatus: r.scan_status as DocumentVersion['scanStatus'],
  reviewStatus: r.review_status as DocumentVersion['reviewStatus'],
  validUntil: r.valid_until ? iso(r.valid_until).slice(0, 10) : null,
  uploadedBy: String(r.uploaded_by),
  uploadedVia: String(r.uploaded_via),
  createdAt: iso(r.created_at),
});

async function typeFor(tx: Tx, code: string): Promise<Omit<DocumentType, 'custom' | 'version'>> {
  const r = await sql<Row>`select * from document_type where code = ${code}`.execute(tx);
  if (r.rows[0]) return toType(r.rows[0]);
  return DEFAULT_TYPES.find((t) => t.code === code) ?? DEFAULT_TYPES.find((t) => t.code === 'OTHER')!;
}

/** The application the caller may act on with `code`; 404 otherwise (never reveals other tenants or scopes). */
async function scopedApplication(
  tx: Tx,
  ctx: RequestContext,
  code: PermissionCode,
  id: string,
): Promise<Row> {
  const r = await sql<Row>`
    select * from loan_application where id = ${id} and ${applicationScope(ctx, code)}`.execute(tx);
  if (!r.rows[0]) throw AppError.of('NOT_FOUND', 'Application not found.');
  return r.rows[0];
}

/** A version and its document, if the caller's `code` scope covers the document's application. */
async function scopedVersion(tx: Tx, ctx: RequestContext, code: PermissionCode, versionId: string) {
  const r = await sql<Row>`
    select v.*, d.application_id, d.checklist_item_id, d.document_type_code, d.current_version_id, d.id as doc_id
      from document_version v join document d on d.id = v.document_id
     where v.id = ${versionId}`.execute(tx);
  const row = r.rows[0];
  if (!row || !row.application_id) throw AppError.of('NOT_FOUND', 'Document version not found.');
  await scopedApplication(tx, ctx, code, String(row.application_id)).catch(() => {
    throw AppError.of('NOT_FOUND', 'Document version not found.');
  });
  return row;
}

async function emit(
  deps: ApiDeps,
  tx: Tx,
  ctx: RequestContext,
  type: string,
  subjectId: string,
  data: object,
) {
  await sql`
    insert into outbox_event (id, tenant_id, event_type, event_version, subject_type, subject_id, payload, correlation_id,
                              chain_depth, created_at)
    values (${deps.ids.next('evt')}, ${ctx.principal.tenantId}, ${type}, 1, 'DOCUMENT', ${subjectId},
            ${JSON.stringify(data)}::jsonb, ${ctx.correlationId}, 0, ${ctx.now})`.execute(tx);
}

export function registerDocumentRoutes(router: Router, deps: ApiDeps): void {
  const docs = documentDeps(deps);

  // ---- API-DOC-007 / 008: document types ------------------------------------------------------------------------------
  router.get('/document-types', async (req, res) => {
    const ctx = requireCtx(req);
    const rows = await deps.txRunner.withTenantTx(ctx, async (tx) =>
      (await sql<Row>`select * from document_type order by code`.execute(tx)).rows.map(toType),
    );
    const own = new Set(rows.map((t) => t.code));
    const data = [
      ...rows,
      ...DEFAULT_TYPES.filter((t) => !own.has(t.code)).map((t) => ({ ...t, custom: false, version: null })),
    ].sort((a, b) => a.code.localeCompare(b.code));
    res.json({ data, meta: { nextCursor: null, limit: data.length } });
  });

  router.post('/document-types', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'config.manage');
    const key = idempotencyKey(req);
    const input = UpsertDocumentTypeSchema.parse(req.body);
    const result = await deps.txRunner.withTenantTx(ctx, (tx) =>
      withIdempotency(tx, ctx, { key, method: 'POST', path: '/v1/document-types', body: input }, async () => {
        const base = DEFAULT_TYPES.find((t) => t.code === input.code);
        const existing = (
          await sql<Row>`select * from document_type where code = ${input.code} for update`.execute(tx)
        ).rows[0];
        const merged = {
          allowedMime: input.allowedMime ??
            (existing ? (existing.allowed_mime as string[]) : base?.allowedMime) ?? ['application/pdf'],
          maxSizeBytes: input.maxSizeBytes ?? (existing ? Number(existing.max_size_bytes) : 10_485_760),
          validityMonths:
            input.validityMonths !== undefined ? input.validityMonths : (existing?.validity_months ?? null),
          sensitivity: input.sensitivity ?? (existing?.sensitivity as string) ?? base?.sensitivity ?? 'S2',
          retentionClass: input.retentionClass ?? (existing?.retention_class as string) ?? 'R-LOAN',
          instructions:
            input.instructions !== undefined ? input.instructions : (existing?.instructions ?? null),
          active: input.active ?? (existing ? Boolean(existing.active) : true),
        };
        const row = existing
          ? (
              await sql<Row>`
                update document_type set name = ${input.name}, category = ${input.category},
                       allowed_mime = ${merged.allowedMime}::text[], max_size_bytes = ${merged.maxSizeBytes},
                       validity_months = ${merged.validityMonths}, sensitivity = ${merged.sensitivity},
                       retention_class = ${merged.retentionClass}, instructions = ${merged.instructions},
                       active = ${merged.active}, updated_by = ${ctx.principal.id}
                 where id = ${existing.id} returning *`.execute(tx)
            ).rows[0]!
          : (
              await sql<Row>`
                insert into document_type (id, tenant_id, code, name, category, allowed_mime, max_size_bytes, validity_months,
                                           sensitivity, retention_class, instructions, active, created_by, updated_by)
                values (${deps.ids.next('dtp')}, ${ctx.principal.tenantId}, ${input.code}, ${input.name}, ${input.category},
                        ${merged.allowedMime}::text[], ${merged.maxSizeBytes}, ${merged.validityMonths}, ${merged.sensitivity},
                        ${merged.retentionClass}, ${merged.instructions}, ${merged.active}, ${ctx.principal.id},
                        ${ctx.principal.id})
                returning *`.execute(tx)
            ).rows[0]!;
        await deps.audit.record(tx, ctx, {
          action: existing ? 'document_type.updated' : 'document_type.created',
          entityType: 'DOCUMENT_TYPE',
          entityId: String(row.id),
          after: {
            code: input.code,
            category: input.category,
            sensitivity: merged.sensitivity,
            active: merged.active,
          },
          permissionUsed: 'config.manage',
        });
        return { status: existing ? 200 : 201, body: toType(row), resourceRef: String(row.id) };
      }),
    );
    if (result.body.version !== null) res.set('ETag', `"${result.body.version}"`);
    if (result.replayed) res.set('Idempotent-Replayed', 'true');
    res.status(result.status).json(result.body);
  });

  // ---- API-DOC-001: upload intent ---------------------------------------------------------------------------------------
  router.post('/documents/upload-intents', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'document.upload');
    const key = idempotencyKey(req);
    const input = CreateUploadIntentSchema.parse(req.body);
    const token = crypto.randomBytes(32).toString('base64url');
    const result = await deps.txRunner.withTenantTx(ctx, (tx) =>
      withIdempotency(
        tx,
        ctx,
        { key, method: 'POST', path: '/v1/documents/upload-intents', body: input },
        async () => {
          const item = (
            await sql<Row>`select * from checklist_item where id = ${input.checklistItemId}`.execute(tx)
          ).rows[0];
          if (!item) throw AppError.of('NOT_FOUND', 'Checklist item not found.');
          const app = await scopedApplication(tx, ctx, 'document.upload', String(item.application_id)).catch(
            () => {
              throw AppError.of('NOT_FOUND', 'Checklist item not found.');
            },
          );
          if (['CANCELLED', 'CLOSED', 'REJECTED', 'WITHDRAWN', 'DISBURSED'].includes(String(app.status))) {
            throw AppError.of(
              'INVALID_STATE',
              `Documents cannot be added while the application is ${app.status}.`,
            );
          }
          if (['ACCEPTED', 'WAIVED', 'NOT_APPLICABLE'].includes(String(item.status))) {
            throw AppError.of('INVALID_STATE', `The checklist item is already ${item.status}.`);
          }
          const type = await typeFor(tx, String(item.document_type_code));
          if (!type.allowedMime.includes(input.mimeType)) {
            throw AppError.of('VALIDATION_ERROR', `${type.name} accepts ${type.allowedMime.join(', ')}.`, [
              { field: 'mimeType', issue: 'NOT_ALLOWED' },
            ]);
          }
          if (input.sizeBytes > type.maxSizeBytes) {
            throw AppError.of('VALIDATION_ERROR', `${type.name} is limited to ${type.maxSizeBytes} bytes.`, [
              { field: 'sizeBytes', issue: 'TOO_LARGE' },
            ]);
          }
          const id = deps.ids.next('upi');
          const expiresAt = new Date(ctx.now.getTime() + UPLOAD_TTL_MINUTES * 60_000);
          await sql`
          insert into upload_intent (id, tenant_id, checklist_item_id, application_id, document_type_code, file_name,
                                     size_bytes, mime_type, sha256, token_hash, expires_at, created_by)
          values (${id}, ${ctx.principal.tenantId}, ${input.checklistItemId}, ${String(item.application_id)},
                  ${String(item.document_type_code)}, ${input.fileName}, ${input.sizeBytes}, ${input.mimeType},
                  ${input.sha256}, ${sha256Hex(token)}, ${expiresAt}, ${ctx.principal.id})`.execute(tx);
          await deps.audit.record(tx, ctx, {
            action: 'document.upload_requested',
            entityType: 'UPLOAD_INTENT',
            entityId: id,
            after: {
              checklistItemId: input.checklistItemId,
              mimeType: input.mimeType,
              sizeBytes: input.sizeBytes,
            },
            permissionUsed: 'document.upload',
          });
          return {
            status: 201,
            body: {
              uploadIntentId: id,
              method: 'PUT' as const,
              url: `/public/v1/document-uploads/${token}`,
              expiresAt: expiresAt.toISOString(),
              requiredHeaders: { 'Content-Type': input.mimeType, 'Content-Length': String(input.sizeBytes) },
            },
            resourceRef: id,
          };
        },
      ),
    );
    if (result.replayed) res.set('Idempotent-Replayed', 'true');
    res.status(result.status).json(result.body);
  });

  // ---- API-DOC-002: completion ------------------------------------------------------------------------------------------
  router.post('/upload-intents/:id/completion', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'document.upload');
    const scanner = new MagicByteFileScanner();
    const result = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const intent = (
        await sql<Row>`select * from upload_intent where id = ${req.params.id} for update`.execute(tx)
      ).rows[0];
      if (!intent) throw AppError.of('NOT_FOUND', 'Upload intent not found.');
      await scopedApplication(tx, ctx, 'document.upload', String(intent.application_id)).catch(() => {
        throw AppError.of('NOT_FOUND', 'Upload intent not found.');
      });
      if (intent.status === 'COMPLETED') {
        const v = (
          await sql<Row>`select scan_status from document_version where id = ${intent.version_id}`.execute(tx)
        ).rows[0];
        return {
          documentId: String(intent.document_id),
          versionId: String(intent.version_id),
          scanStatus: v?.scan_status,
        };
      }
      if (intent.status !== 'UPLOADED') {
        throw AppError.of('INVALID_STATE', 'Nothing has been uploaded for this intent yet.');
      }
      const bytes = await docs.store.get(ctx.principal.tenantId, String(intent.object_key));
      if (!bytes || sha256Hex(bytes) !== intent.sha256) {
        throw AppError.of('VALIDATION_ERROR', 'The stored file does not match the declared sha256.', [
          { field: 'sha256', issue: 'MISMATCH' },
        ]);
      }
      const scan = await scanner.scan(bytes, String(intent.file_name), String(intent.mime_type));
      const scanStatus = scan.clean ? 'CLEAN' : 'QUARANTINED';

      // One document per checklist item; a new upload becomes its next version and supersedes the previous one.
      let doc = (
        await sql<Row>`select * from document where checklist_item_id = ${intent.checklist_item_id} for update`.execute(
          tx,
        )
      ).rows[0];
      if (!doc) {
        const item = (
          await sql<Row>`select party_id from checklist_item where id = ${intent.checklist_item_id}`.execute(
            tx,
          )
        ).rows[0]!;
        doc = (
          await sql<Row>`
            insert into document (id, tenant_id, owner_type, owner_id, application_id, checklist_item_id, document_type_code,
                                  created_by, updated_by)
            values (${deps.ids.next('doc')}, ${ctx.principal.tenantId}, 'PARTY', ${String(item.party_id)},
                    ${String(intent.application_id)}, ${String(intent.checklist_item_id)},
                    ${String(intent.document_type_code)}, ${ctx.principal.id}, ${ctx.principal.id})
            returning *`.execute(tx)
        ).rows[0]!;
      }
      const next = (
        await sql<{
          n: number;
        }>`select coalesce(max(version_no), 0) + 1 as n from document_version where document_id = ${doc.id}`.execute(
          tx,
        )
      ).rows[0]!.n;
      await sql`
        update document_version set review_status = 'SUPERSEDED'
         where document_id = ${doc.id} and review_status = 'PENDING'`.execute(tx);
      const versionId = deps.ids.next('dvr');
      await sql`
        insert into document_version (id, tenant_id, document_id, version_no, object_key, file_name, sha256, size_bytes,
                                      detected_mime, scan_status, uploaded_by, uploaded_via)
        values (${versionId}, ${ctx.principal.tenantId}, ${String(doc.id)}, ${Number(next)}, ${String(intent.object_key)},
                ${String(intent.file_name)}, ${String(intent.sha256)}, ${bytes.length}, ${String(intent.mime_type)},
                ${scanStatus}, ${ctx.principal.id}, 'STAFF')`.execute(tx);
      await sql`update document set current_version_id = ${versionId}, updated_by = ${ctx.principal.id} where id = ${doc.id}`.execute(
        tx,
      );
      if (scanStatus === 'CLEAN') {
        await sql`
          update checklist_item set status = 'SUBMITTED', document_id = ${String(doc.id)}, reviewed_by = null,
                 reviewed_at = null, reject_reason = null, updated_by = ${ctx.principal.id}
           where id = ${intent.checklist_item_id}`.execute(tx);
      }
      await sql`
        update upload_intent set status = 'COMPLETED', document_id = ${String(doc.id)}, version_id = ${versionId},
               updated_at = now()
         where id = ${intent.id}`.execute(tx);
      await deps.audit.record(tx, ctx, {
        action: 'document.uploaded',
        entityType: 'DOCUMENT',
        entityId: String(doc.id),
        after: {
          versionId,
          versionNo: Number(next),
          scanStatus,
          documentTypeCode: intent.document_type_code,
        },
        permissionUsed: 'document.upload',
      });
      await emit(deps, tx, ctx, 'document.uploaded', String(doc.id), { documentId: doc.id, versionId });
      await emit(deps, tx, ctx, 'document.scanned', String(doc.id), {
        documentId: doc.id,
        versionId,
        scanStatus,
      });
      return { documentId: String(doc.id), versionId, scanStatus };
    });
    res.status(202).json(result);
  });

  // ---- API-DOC-003: read ------------------------------------------------------------------------------------------------
  router.get('/documents/:id', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'document.view');
    const body = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const doc = (await sql<Row>`select * from document where id = ${req.params.id}`.execute(tx)).rows[0];
      if (!doc || !doc.application_id) throw AppError.of('NOT_FOUND', 'Document not found.');
      await scopedApplication(tx, ctx, 'document.view', String(doc.application_id)).catch(() => {
        throw AppError.of('NOT_FOUND', 'Document not found.');
      });
      const versions = (
        await sql<Row>`select * from document_version where document_id = ${doc.id} order by version_no desc`.execute(
          tx,
        )
      ).rows.map(toVersion);
      const resource: DocumentResource = {
        id: String(doc.id),
        ownerType: doc.owner_type as DocumentResource['ownerType'],
        ownerId: String(doc.owner_id),
        applicationId: (doc.application_id as string | null) ?? null,
        checklistItemId: (doc.checklist_item_id as string | null) ?? null,
        documentTypeCode: String(doc.document_type_code),
        status: doc.status as DocumentResource['status'],
        currentVersionId: (doc.current_version_id as string | null) ?? null,
        versions,
        version: Number(doc.lock_version),
        createdAt: iso(doc.created_at),
        updatedAt: iso(doc.updated_at),
      };
      return resource;
    });
    sendResource(res, 200, body);
  });

  // ---- API-DOC-006: review ----------------------------------------------------------------------------------------------
  router.post('/document-versions/:id/reviews', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'document.review');
    const key = idempotencyKey(req);
    const input = ReviewDocumentVersionSchema.parse(req.body);
    const result = await deps.txRunner.withTenantTx(ctx, (tx) =>
      withIdempotency(
        tx,
        ctx,
        { key, method: 'POST', path: `/v1/document-versions/${req.params.id}/reviews`, body: input },
        async () => {
          const v = await scopedVersion(tx, ctx, 'document.review', req.params.id);
          if (v.scan_status !== 'CLEAN') {
            throw AppError.of(
              'DOCUMENT_QUARANTINED',
              'A version that did not pass the scan cannot be reviewed.',
            );
          }
          if (v.id !== v.current_version_id || v.review_status !== 'PENDING') {
            throw AppError.of(
              'INVALID_STATE',
              `This version is ${v.review_status} and cannot be reviewed again.`,
            );
          }
          const accepted = input.decision === 'ACCEPT';
          await sql`
            insert into document_review (id, tenant_id, version_id, decision, reason_code, comment, valid_until, reviewer_id)
            values (${deps.ids.next('drv')}, ${ctx.principal.tenantId}, ${String(v.id)}, ${input.decision},
                    ${input.reasonCode ?? null}, ${input.comment ?? null}, ${input.validUntil ?? null},
                    ${ctx.principal.id})`.execute(tx);
          await sql`
            update document_version set review_status = ${accepted ? 'ACCEPTED' : 'REJECTED'},
                   valid_until = ${input.validUntil ?? null}
             where id = ${String(v.id)}`.execute(tx);
          if (v.checklist_item_id) {
            await sql`
              update checklist_item set status = ${accepted ? 'ACCEPTED' : 'REJECTED'},
                     reject_reason = ${accepted ? null : (input.reasonCode ?? 'OTHER')},
                     reviewed_by = ${ctx.principal.id}, reviewed_at = ${ctx.now}, updated_by = ${ctx.principal.id}
               where id = ${String(v.checklist_item_id)}`.execute(tx);
          }
          await deps.audit.record(tx, ctx, {
            action: 'document.reviewed',
            entityType: 'DOCUMENT_VERSION',
            entityId: String(v.id),
            after: { decision: input.decision, reasonCode: input.reasonCode ?? null },
            permissionUsed: 'document.review',
          });
          await emit(deps, tx, ctx, 'document.reviewed', String(v.doc_id), {
            documentId: v.doc_id,
            versionId: v.id,
            decision: input.decision,
          });
          const updated = (
            await sql<Row>`select * from document_version where id = ${String(v.id)}`.execute(tx)
          ).rows[0]!;
          return { status: 200, body: toVersion(updated), resourceRef: String(v.id) };
        },
      ),
    );
    if (result.replayed) res.set('Idempotent-Replayed', 'true');
    res.status(result.status).json(result.body);
  });

  // ---- API-DOC-004 / 005: short-lived links (every issue is logged) -----------------------------------------------------
  const issueLink =
    (disposition: 'inline' | 'attachment', code: PermissionCode): express.RequestHandler =>
    async (req, res) => {
      const ctx = requireCtx(req);
      deps.authz.requirePermission(ctx, code);
      const { purpose } = DocumentLinkRequestSchema.parse(req.body ?? {});
      const body = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        const v = await scopedVersion(tx, ctx, code, req.params.id as string);
        if (v.scan_status !== 'CLEAN') {
          throw AppError.of(
            'DOCUMENT_QUARANTINED',
            'This version did not pass the scan and cannot be opened.',
          );
        }
        if (v.purged_at) throw AppError.of('INVALID_STATE', 'This version has been purged.');
        const type = await typeFor(tx, String(v.document_type_code));
        // S3 documents need a recent step-up to download (SUB-DOC.07).
        if (disposition === 'attachment' && type.sensitivity === 'S3') deps.authz.requireStepUp(ctx);
        await sql`
          insert into document_access_log (id, tenant_id, version_id, action, principal_id, purpose, ip)
          values (${deps.ids.next('dal')}, ${ctx.principal.tenantId}, ${String(v.id)},
                  ${disposition === 'inline' ? 'VIEW' : 'DOWNLOAD'}, ${ctx.principal.id}, ${purpose ?? null},
                  ${ctx.ip ?? null}::inet)`.execute(tx);
        const exp = Math.floor(ctx.now.getTime() / 1000) + LINK_TTL_SECONDS;
        const token = docs.signer.sign({
          t: ctx.principal.tenantId,
          k: 'v',
          i: String(v.id),
          d: disposition,
          e: exp,
        });
        return { url: `/public/v1/document-files/${token}`, expiresAt: new Date(exp * 1000).toISOString() };
      });
      res.json(body);
    };
  router.post('/document-versions/:id/view-url', issueLink('inline', 'document.view'));
  router.post('/document-versions/:id/download-url', issueLink('attachment', 'document.download'));

  // ---- API-DOC-009: archive ---------------------------------------------------------------------------------------------
  router.post('/applications/:id/document-archive', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'document.download');
    deps.authz.requireStepUp(ctx);
    const body = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      await scopedApplication(tx, ctx, 'document.download', req.params.id);
      const count = (
        await sql<{ n: number }>`
          select count(*)::int as n from document d join document_version v on v.id = d.current_version_id
           where d.application_id = ${req.params.id} and v.scan_status = 'CLEAN' and v.purged_at is null`.execute(
          tx,
        )
      ).rows[0]!.n;
      const archiveId = deps.ids.next('arc');
      await sql`
        insert into document_archive (id, tenant_id, application_id, document_count, requested_by)
        values (${archiveId}, ${ctx.principal.tenantId}, ${req.params.id}, ${count}, ${ctx.principal.id})`.execute(
        tx,
      );
      if (!deps.enqueueJob) throw AppError.of('DEPENDENCY_UNAVAILABLE', 'Background jobs are not available.');
      await deps.enqueueJob(tx, ctx.principal.tenantId, DOCUMENT_ARCHIVE_JOB, { archiveId });
      await deps.audit.record(tx, ctx, {
        action: 'document.archive_requested',
        entityType: 'LOAN_APPLICATION',
        entityId: req.params.id,
        after: { archiveId, documentCount: count },
        permissionUsed: 'document.download',
      });
      return { archiveId, status: 'QUEUED' as const, documentCount: count, url: null, expiresAt: null };
    });
    res.status(202).json(body);
  });

  router.get('/document-archives/:id', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'document.download');
    const body = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const a = (await sql<Row>`select * from document_archive where id = ${req.params.id}`.execute(tx))
        .rows[0];
      if (!a) throw AppError.of('NOT_FOUND', 'Archive not found.');
      await scopedApplication(tx, ctx, 'document.download', String(a.application_id)).catch(() => {
        throw AppError.of('NOT_FOUND', 'Archive not found.');
      });
      let url: string | null = null;
      let expiresAt: string | null = null;
      if (a.status === 'READY') {
        const exp = Math.floor(ctx.now.getTime() / 1000) + LINK_TTL_SECONDS;
        url = `/public/v1/document-files/${docs.signer.sign({ t: ctx.principal.tenantId, k: 'a', i: String(a.id), d: 'attachment', e: exp })}`;
        expiresAt = new Date(exp * 1000).toISOString();
      }
      return {
        archiveId: String(a.id),
        status: a.status,
        documentCount: Number(a.document_count),
        url,
        expiresAt,
      };
    });
    res.json(body);
  });

  // ---- API-APP-009: waivers / API-APP-008: completeness check -----------------------------------------------------------
  router.post('/applications/:id/waivers', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'document.waive');
    const key = idempotencyKey(req);
    const input = WaiveChecklistItemSchema.parse(req.body);
    const result = await deps.txRunner.withTenantTx(ctx, (tx) =>
      withIdempotency(
        tx,
        ctx,
        { key, method: 'POST', path: `/v1/applications/${req.params.id}/waivers`, body: input },
        async () => {
          await scopedApplication(tx, ctx, 'document.waive', req.params.id);
          const item = (
            await sql<Row>`select * from checklist_item where id = ${input.checklistItemId} and application_id = ${req.params.id}
                          for update`.execute(tx)
          ).rows[0];
          if (!item) throw AppError.of('NOT_FOUND', 'Checklist item not found.');
          if (item.status === 'ACCEPTED')
            throw AppError.of('INVALID_STATE', 'An accepted document cannot be waived.');
          const updated = (
            await sql<Row>`
            update checklist_item set status = ${input.status}, attestation_note = ${input.reason},
                   updated_by = ${ctx.principal.id}
             where id = ${input.checklistItemId} returning *`.execute(tx)
          ).rows[0]!;
          await deps.audit.record(tx, ctx, {
            action: 'checklist.waived',
            entityType: 'CHECKLIST_ITEM',
            entityId: input.checklistItemId,
            before: { status: item.status },
            after: { status: input.status },
            reason: input.reason,
            permissionUsed: 'document.waive',
          });
          await emit(deps, tx, ctx, 'checklist.changed', req.params.id, {
            applicationId: req.params.id,
            waived: input.checklistItemId,
          });
          return {
            status: 200,
            body: {
              checklistItemId: String(updated.id),
              status: String(updated.status),
              version: Number(updated.lock_version),
            },
            resourceRef: input.checklistItemId,
          };
        },
      ),
    );
    sendResource(res, result.status, result.body, result.replayed);
  });

  router.post('/applications/:id/completeness-checks', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'application.read');
    const body = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      await scopedApplication(tx, ctx, 'application.read', req.params.id);
      const items = (
        await sql<Row>`select id, document_type_code, mandatory, status from checklist_item where application_id = ${req.params.id}`.execute(
          tx,
        )
      ).rows;
      const outstanding = items.filter(
        (i) => Boolean(i.mandatory) && !['ACCEPTED', 'WAIVED', 'NOT_APPLICABLE'].includes(String(i.status)),
      );
      const complete = isComplete(
        items.map((i) => ({ mandatory: Boolean(i.mandatory), status: i.status as never })),
      );
      await sql`
        update loan_application set last_completeness_result = ${complete ? 'COMPLETE' : 'INCOMPLETE'},
               updated_by = ${ctx.principal.id}
         where id = ${req.params.id}`.execute(tx);
      return {
        result: complete ? 'COMPLETE' : 'INCOMPLETE',
        reasons:
          items.length === 0
            ? [{ code: 'NO_CHECKLIST', text: 'The checklist has not been generated (T-APP-01).' }]
            : outstanding.map((i) => ({
                code: 'DOCUMENT_OUTSTANDING',
                text: `${i.document_type_code} is ${i.status}`,
                checklistItemId: i.id,
              })),
      };
    });
    res.json(body);
  });

  // ---- API-PRV-004: legal holds -----------------------------------------------------------------------------------------
  const toHold = (r: Row): LegalHold => ({
    id: String(r.id),
    subjectType: String(r.subject_type),
    subjectId: String(r.subject_id),
    reason: String(r.reason),
    reference: (r.reference as string | null) ?? null,
    placedBy: String(r.placed_by),
    placedAt: iso(r.placed_at),
    releasedAt: r.released_at ? iso(r.released_at) : null,
    version: Number(r.lock_version),
  });

  router.post('/legal-holds', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'privacy.manage');
    const key = idempotencyKey(req);
    const input = CreateLegalHoldSchema.parse(req.body);
    const table: Record<string, string> = {
      CUSTOMER: 'customer',
      LOAN_APPLICATION: 'loan_application',
      LEAD: 'lead',
      DOCUMENT: 'document',
    };
    const result = await deps.txRunner.withTenantTx(ctx, (tx) =>
      withIdempotency(tx, ctx, { key, method: 'POST', path: '/v1/legal-holds', body: input }, async () => {
        const exists =
          await sql<Row>`select 1 from ${sql.table(table[input.subjectType]!)} where id = ${input.subjectId}`.execute(
            tx,
          );
        if (!exists.rows[0]) throw AppError.of('NOT_FOUND', 'Subject not found.');
        const row = (
          await sql<Row>`
            insert into legal_hold (id, tenant_id, subject_type, subject_id, reason, reference, placed_by)
            values (${deps.ids.next('lgh')}, ${ctx.principal.tenantId}, ${input.subjectType}, ${input.subjectId},
                    ${input.reason}, ${input.reference ?? null}, ${ctx.principal.id})
            returning *`.execute(tx)
        ).rows[0]!;
        await deps.audit.record(tx, ctx, {
          action: 'legal_hold.placed',
          entityType: input.subjectType,
          entityId: input.subjectId,
          after: { legalHoldId: row.id },
          reason: input.reason,
          permissionUsed: 'privacy.manage',
        });
        return { status: 201, body: toHold(row), resourceRef: String(row.id) };
      }),
    );
    sendResource(res, result.status, result.body, result.replayed);
  });

  router.get('/legal-holds', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'privacy.manage');
    const data = await deps.txRunner.withTenantTx(ctx, async (tx) =>
      (
        await sql<Row>`select * from legal_hold order by placed_at desc, id desc limit 200`.execute(tx)
      ).rows.map(toHold),
    );
    res.json({ data, meta: { nextCursor: null, limit: 200 } });
  });
}

// ---- unauthenticated routes reached by signed links -------------------------------------------------------------------
const serviceCtx = (tenantId: string, correlationId: string): RequestContext => ({
  principal: {
    kind: 'SERVICE',
    id: 'SYSTEM:document-links',
    tenantId,
    primaryBranchId: null,
    managedTeamMemberIds: [],
    queueIds: [],
    grants: [],
    authTime: null,
  },
  correlationId,
  now: new Date(),
});

export function createPublicDocumentRouter(deps: ApiDeps): Router {
  const router = express.Router();
  const docs = documentDeps(deps);

  // The upload target of API-DOC-001: the raw bytes, which must match the intent's size and sha256.
  router.put(
    '/document-uploads/:token',
    express.raw({ type: () => true, limit: '52mb' }),
    async (req, res, next) => {
      try {
        const tokenHash = sha256Hex(String(req.params.token));
        const found = await deps.txRunner.withTenantTx(
          serviceCtx('PUBLIC', req.correlationId),
          async (tx) =>
            (
              await sql<{
                tenant_id: string;
                id: string;
              }>`select * from app.resolve_upload_intent(${tokenHash})`.execute(tx)
            ).rows[0],
        );
        if (!found) throw AppError.of('NOT_FOUND', 'Upload link not found.');
        const ctx = serviceCtx(found.tenant_id, req.correlationId);
        const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        await deps.txRunner.withTenantTx(ctx, async (tx) => {
          const intent = (
            await sql<Row>`select * from upload_intent where id = ${found.id} for update`.execute(tx)
          ).rows[0]!;
          if (intent.status !== 'PENDING')
            throw AppError.of('INVALID_STATE', 'This upload link has already been used.');
          if (new Date(String(intent.expires_at)) <= ctx.now)
            throw AppError.of('LINK_EXPIRED', 'This upload link has expired.');
          if (bytes.length !== Number(intent.size_bytes) || sha256Hex(bytes) !== intent.sha256) {
            throw AppError.of('VALIDATION_ERROR', 'The file does not match the declared size and sha256.', [
              { field: 'body', issue: 'MISMATCH' },
            ]);
          }
          const objectKey = await docs.store.put(found.tenant_id, `${intent.id}-${intent.sha256}`, bytes);
          await sql`update upload_intent set status = 'UPLOADED', object_key = ${objectKey}, updated_at = now()
                     where id = ${intent.id}`.execute(tx);
        });
        res.status(204).end();
      } catch (err) {
        next(err);
      }
    },
  );

  // The target of API-DOC-004/005 links and of ready archives.
  router.get('/document-files/:token', async (req, res, next) => {
    try {
      const claims = docs.signer.verify(String(req.params.token), Math.floor(Date.now() / 1000));
      if (!claims) throw AppError.of('LINK_EXPIRED', 'This link is invalid or has expired.');
      const ctx = serviceCtx(claims.t, req.correlationId);
      const file = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        if (claims.k === 'v') {
          const v = (await sql<Row>`select * from document_version where id = ${claims.i}`.execute(tx))
            .rows[0];
          if (!v || v.scan_status !== 'CLEAN' || v.purged_at) return null;
          const bytes = await docs.store.get(claims.t, String(v.object_key));
          return bytes ? { bytes, type: String(v.detected_mime), name: String(v.file_name) } : null;
        }
        const a = (await sql<Row>`select * from document_archive where id = ${claims.i}`.execute(tx)).rows[0];
        if (!a || a.status !== 'READY') return null;
        const sealed = await docs.store.get(claims.t, String(a.object_key));
        return sealed
          ? {
              bytes: decryptArchive(sealed, docs.secret),
              type: 'application/zip',
              name: `${String(a.application_id)}-documents.zip`,
            }
          : null;
      });
      if (!file) throw AppError.of('NOT_FOUND', 'File not found.');
      res.set('Cache-Control', 'no-store');
      res.set('Content-Type', file.type);
      res.set('Content-Disposition', `${claims.d}; filename="${file.name.replace(/["\\\r\n]/g, '_')}"`);
      res.set('X-Content-Type-Options', 'nosniff');
      res.send(file.bytes);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

// ---- the archive job (run by the background worker in the archive's tenant) --------------------------------------------
export const DOCUMENT_ARCHIVE_JOB = 'document.archive';

/** The job handler for DOCUMENT_ARCHIVE_JOB; server.ts registers it with the platform job queue. */
export function createDocumentArchiveHandler(
  deps: ApiDeps,
): (tx: Tx, tenantId: string, payload: Record<string, unknown>) => Promise<void> {
  const docs = documentDeps(deps);
  return async (tx, tenantId, payload) => {
    const archiveId = String(payload.archiveId);
    const a = (await sql<Row>`select * from document_archive where id = ${archiveId} for update`.execute(tx))
      .rows[0];
    if (!a || a.status !== 'QUEUED') return;
    try {
      await buildArchive(tx, tenantId, a);
    } catch (err) {
      // The archive is marked FAILED with the reason; nothing half-built is kept.
      const reason = (err instanceof Error ? err.message : 'unknown error').slice(0, 500);
      await sql`update document_archive set status = 'FAILED', failure_reason = ${reason}, completed_at = now()
                 where id = ${archiveId}`.execute(tx);
    }
  };

  async function buildArchive(tx: Tx, tenantId: string, a: Row): Promise<void> {
    const archiveId = String(a.id);
    const versions = (
      await sql<Row>`
        select d.document_type_code, v.id, v.version_no, v.file_name, v.object_key, v.sha256
          from document d join document_version v on v.id = d.current_version_id
         where d.application_id = ${String(a.application_id)} and v.scan_status = 'CLEAN' and v.purged_at is null
         order by d.document_type_code, v.id`.execute(tx)
    ).rows;
    const files: Record<string, Uint8Array> = {};
    const manifest: object[] = [];
    for (const v of versions) {
      const bytes = await docs.store.get(tenantId, String(v.object_key));
      if (!bytes || sha256Hex(bytes) !== v.sha256)
        throw new Error(`Stored file of ${String(v.id)} is missing or altered.`);
      const name = `${String(v.document_type_code)}/${String(v.id)}-${String(v.file_name)}`;
      files[name] = bytes;
      manifest.push({ path: name, versionId: v.id, sha256: v.sha256 });
    }
    files['manifest.json'] = Buffer.from(
      JSON.stringify({ applicationId: a.application_id, files: manifest }, null, 2),
    );
    const sealed = encryptArchive(Buffer.from(zipSync(files)), docs.secret);
    const objectKey = await docs.store.put(tenantId, `${archiveId}.zip.enc`, sealed);
    await sql`
      update document_archive set status = 'READY', object_key = ${objectKey}, document_count = ${versions.length},
             completed_at = now()
       where id = ${archiveId}`.execute(tx);
    for (const v of versions) {
      await sql`
        insert into document_access_log (id, tenant_id, version_id, action, principal_id, purpose)
        values (${deps.ids.next('dal')}, ${tenantId}, ${String(v.id)}, 'ARCHIVE', ${String(a.requested_by)},
                ${`archive ${archiveId}`})`.execute(tx);
    }
  }
}
