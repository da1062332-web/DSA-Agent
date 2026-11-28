// Lender document pack download (owner: Dipanshu; task P2-04, migration M-121).
//   GET /v1/lender-cases/{id}/pack    lender_case.submit (with the case's application in the caller's scope)
// Streams one ZIP of exactly the documents the case's FROZEN submission package lists, never the live checklist: each file is the
// version the manifest pinned (its sha256 when the manifest has one, otherwise the newest clean version uploaded before the freeze),
// and its bytes must hash to the stored sha256. Files are ordered and named by the lender's pack profile (catalogue), or the default.
// Refusals: no package or not frozen 409 INVALID_STATE; a manifest altered after it was built, or a file whose bytes no longer match,
// 409 CONTENT_HASH_MISMATCH; a listed file that is gone (purged, quarantined) 409 INVALID_STATE with the checklist items. Unknown or
// out-of-scope case 404. The download is audited (who, which package, how many files) and each document version gets an access-log
// row, in one transaction before the bytes are sent. The ZIP is built in memory: packs are a handful of scanned documents.
import {
  AppError,
  orderPackDocuments,
  packFileName,
  type ErrorDetail,
  type FrozenPackageDocument,
  type PackParty,
  type RequestContext,
  type Tx,
} from '@dsa/contracts';
import type { Router } from 'express';
import { zipSync } from 'fflate';
import { sql } from 'kysely';
import { requireCtx } from '../../../http/request';
import type { ApiDeps } from '../../types';
import { loadPackProfile } from '../catalogue/lender-pack-profiles';
import { applicationScope } from './applications';
import type { Row } from './db';
import { sha256Hex } from './document-store';
import { documentDeps } from './documents';

/** One file of the pack, resolved from the manifest. versionId is set for MOD-DOC versions (they get an access-log row). */
export interface PackFile {
  checklistItemId: string;
  documentTypeCode: string;
  party: PackParty;
  originalFileName: string;
  mimeType: string | null;
  bytes: Uint8Array;
  versionId: string | null;
}

export interface BuiltPack {
  packageId: string;
  manifestSha256: string;
  zip: Uint8Array;
  names: string[];
}

/** The ZIP: files in profile order, named by the profile pattern, timestamped with the freeze time (same pack, same bytes). */
export function zipPack(
  files: readonly PackFile[],
  profile: { documentOrder: readonly string[]; filenamePattern: string },
  frozenAt: Date,
): { zip: Uint8Array; names: string[] } {
  const ordered = orderPackDocuments(files, profile.documentOrder);
  const names = ordered.map((f, i) =>
    packFileName(profile.filenamePattern, {
      seq: i + 1,
      documentTypeCode: f.documentTypeCode,
      party: f.party,
      originalFileName: f.originalFileName,
      mimeType: f.mimeType,
    }),
  );
  const entries: Record<string, [Uint8Array, { mtime: Date }]> = {};
  ordered.forEach((f, i) => (entries[names[i]!] = [f.bytes, { mtime: frozenAt }]));
  return { zip: zipSync(entries), names };
}

const unavailable = (d: FrozenPackageDocument, issue: string): ErrorDetail => ({
  field: 'documents',
  issue,
  meta: { checklistItemId: d.checklistItemId, documentTypeCode: d.documentTypeCode },
});

async function resolveFiles(
  tx: Tx,
  deps: ApiDeps,
  tenantId: string,
  applicationId: string,
  frozenAt: Date,
  documents: readonly FrozenPackageDocument[],
): Promise<PackFile[]> {
  const docs = documentDeps(deps);
  const ids = documents.map((d) => d.documentId);
  const itemIds = documents.map((d) => d.checklistItemId);
  const parties = new Map(
    (
      await sql<Row>`
        select ci.id, ap.role from checklist_item ci left join application_party ap on ap.id = ci.party_id
         where ci.application_id = ${applicationId} and ci.id = any(${itemIds}::text[])`.execute(tx)
    ).rows.map((r) => [String(r.id), (r.role as PackParty) ?? null]),
  );
  // MOD-DOC versions uploaded by staff, newest first; only clean, unpurged, not rejected, and in place when the package froze.
  const versions = (
    await sql<Row>`
      select d.id as document_id, v.id, v.object_key, v.file_name, v.detected_mime, v.sha256
        from document d join document_version v on v.document_id = d.id
       where d.id = any(${ids}::text[]) and d.application_id = ${applicationId}
         and v.scan_status = 'CLEAN' and v.purged_at is null and v.review_status <> 'REJECTED' and v.created_at <= ${frozenAt}
       order by d.id, v.version_no desc`.execute(tx)
  ).rows;
  // Files a customer uploaded through an upload link (document-sharing).
  const uploads = new Map(
    (
      await sql<Row>`
        select id, file_name, mime_type, storage_path, sha256_hash from uploaded_document
         where id = any(${ids}::text[]) and application_id = ${applicationId} and scan_status = 'CLEAN'`.execute(
        tx,
      )
    ).rows.map((r) => [String(r.id), r]),
  );

  const files: PackFile[] = [];
  const gone: ErrorDetail[] = [];
  const altered: ErrorDetail[] = [];
  for (const d of documents) {
    const party = parties.get(d.checklistItemId) ?? null;
    const candidates = versions.filter((v) => v.document_id === d.documentId);
    const v = d.sha256 ? candidates.find((c) => String(c.sha256).trim() === d.sha256) : candidates[0];
    if (v) {
      const bytes = await docs.store.get(tenantId, String(v.object_key));
      if (!bytes) gone.push(unavailable(d, 'DOCUMENT_UNAVAILABLE'));
      else if (sha256Hex(bytes) !== String(v.sha256).trim()) altered.push(unavailable(d, 'FILE_ALTERED'));
      else
        files.push({
          checklistItemId: d.checklistItemId,
          documentTypeCode: d.documentTypeCode,
          party,
          originalFileName: String(v.file_name),
          mimeType: (v.detected_mime as string | null) ?? null,
          bytes,
          versionId: String(v.id),
        });
      continue;
    }
    const u = uploads.get(d.documentId);
    const hash = u ? String(u.sha256_hash).trim() : '';
    // The stored path must be inside this tenant's folder: the local store does not check it itself.
    const storagePath = u ? String(u.storage_path).replace(/\\/g, '/') : '';
    if (
      !u ||
      (d.sha256 && hash !== d.sha256) ||
      !storagePath.startsWith(`${tenantId}/`) ||
      storagePath.includes('..')
    ) {
      gone.push(unavailable(d, 'DOCUMENT_UNAVAILABLE'));
      continue;
    }
    const bytes = deps.customerUploadStore
      ? await deps.customerUploadStore.get(tenantId, String(u.storage_path))
      : null;
    if (!bytes) gone.push(unavailable(d, 'DOCUMENT_UNAVAILABLE'));
    else if (sha256Hex(bytes) !== hash) altered.push(unavailable(d, 'FILE_ALTERED'));
    else
      files.push({
        checklistItemId: d.checklistItemId,
        documentTypeCode: d.documentTypeCode,
        party,
        originalFileName: String(u.file_name),
        mimeType: (u.mime_type as string | null) ?? null,
        bytes,
        versionId: null,
      });
  }
  if (altered.length)
    throw AppError.of(
      'CONTENT_HASH_MISMATCH',
      'A stored file no longer matches the frozen package.',
      altered,
    );
  if (gone.length)
    throw AppError.of(
      'INVALID_STATE',
      'Some documents in the frozen package are no longer available. Rebuild the package.',
      gone,
    );
  return files;
}

export async function buildLenderPack(
  tx: Tx,
  ctx: RequestContext,
  deps: ApiDeps,
  caseId: string,
): Promise<BuiltPack> {
  if (!deps.lenderCasePackagePort)
    throw AppError.of('DEPENDENCY_UNAVAILABLE', 'Lender case packages are not available.');
  const view = await deps.lenderCasePackagePort.currentPackage(tx, caseId);
  if (!view) throw AppError.of('NOT_FOUND', 'Lender case not found.');
  const inScope = await sql<Row>`
    select id from loan_application where id = ${view.applicationId} and ${applicationScope(ctx, 'lender_case.submit')}`.execute(
    tx,
  );
  if (!inScope.rows[0]) throw AppError.of('NOT_FOUND', 'Lender case not found.');
  if (!view.packageId || !view.frozenAt || !view.manifestSha256) {
    throw AppError.of(
      'INVALID_STATE',
      'The lender case has no frozen submission package yet. Build and freeze it first.',
      [{ field: 'package', issue: view.packageId ? 'PACKAGE_NOT_FROZEN' : 'NO_PACKAGE' }],
    );
  }
  if (!view.manifestIntact) {
    throw AppError.of('CONTENT_HASH_MISMATCH', 'The submission package no longer matches its checksum.', [
      { field: 'package', issue: 'MANIFEST_ALTERED', meta: { packageId: view.packageId } },
    ]);
  }
  if (view.documents.length === 0) {
    throw AppError.of('INVALID_STATE', 'The frozen package lists no documents.', [
      { field: 'package', issue: 'NO_DOCUMENTS' },
    ]);
  }
  const tenantId = ctx.principal.tenantId;
  const profile = await loadPackProfile(tx, view.lenderId);
  if (!profile) throw AppError.of('NOT_FOUND', 'Lender case not found.');
  const files = await resolveFiles(tx, deps, tenantId, view.applicationId, view.frozenAt, view.documents);
  const { zip, names } = zipPack(files, profile, view.frozenAt);

  const purpose = `lender pack ${caseId}`;
  for (const f of files) {
    if (!f.versionId) continue;
    await sql`
      insert into document_access_log (id, tenant_id, version_id, action, principal_id, purpose)
      values (${deps.ids.next('dal')}, ${tenantId}, ${f.versionId}, 'DOWNLOAD', ${ctx.principal.id}, ${purpose})`.execute(
      tx,
    );
  }
  await deps.audit.record(tx, ctx, {
    action: 'lender_case.pack_downloaded',
    entityType: 'LENDER_CASE',
    entityId: caseId,
    after: {
      packageId: view.packageId,
      manifestSha256: view.manifestSha256,
      fileCount: files.length,
      defaultProfile: profile.isDefault,
    },
    permissionUsed: 'lender_case.submit',
  });
  return { packageId: view.packageId, manifestSha256: view.manifestSha256, zip, names };
}

export function registerLenderPackRoutes(router: Router, deps: ApiDeps): void {
  router.get('/lender-cases/:id/pack', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'lender_case.submit');
    const pack = await deps.txRunner.withTenantTx(ctx, (tx) => buildLenderPack(tx, ctx, deps, req.params.id));
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="lender-pack-${req.params.id.replace(/[^A-Za-z0-9_-]/g, '')}.zip"`,
      'Cache-Control': 'no-store',
      'X-Package-Id': pack.packageId,
      'X-Manifest-Sha256': pack.manifestSha256,
    });
    res.status(200).send(Buffer.from(pack.zip));
  });
}
