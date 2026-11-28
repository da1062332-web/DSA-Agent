// LenderCasePackagePort (owner: Dipanshu, guest file in Dev 4's MOD-LCS; task P2-04). Read-only: the lender case and its current
// submission package, for the pack download in origination/applications. Runs in the caller's transaction (row-level security).
// manifestIntact re-hashes the stored manifest the way buildPackage (service.ts) hashed it: JSON.stringify of the object in the
// builder's key order. jsonb does not keep key order, so the object is rebuilt in that order first. If buildPackage changes the
// manifest's shape, change canonicalManifest with it (package-port.int test TEST-PACK-INT-002 fails until both agree).
import type { FrozenPackageDocument, LenderCasePackagePort, LenderCasePackageView, Tx } from '@dsa/contracts';
import { createHash } from 'crypto';
import { sql } from 'kysely';

type Row = Record<string, unknown>;
type ManifestDocument = {
  checklistItemId?: unknown;
  documentTypeCode?: unknown;
  documentId?: unknown;
  sha256?: unknown;
};

/** The manifest exactly as buildPackage serialised it before hashing. */
export function canonicalManifest(m: Record<string, unknown>): string {
  const docs = Array.isArray(m.documents) ? (m.documents as ManifestDocument[]) : [];
  return JSON.stringify({
    applicationId: m.applicationId,
    lenderId: m.lenderId,
    productVersionId: m.productVersionId,
    attemptNo: m.attemptNo,
    documents: docs.map((d) => ({
      checklistItemId: d.checklistItemId,
      documentTypeCode: d.documentTypeCode,
      documentId: d.documentId,
      sha256: d.sha256,
    })),
    waivers: m.waivers,
    builtAt: m.builtAt,
  });
}

export function createLenderCasePackagePort(): LenderCasePackagePort {
  return {
    async currentPackage(tx: Tx, lenderCaseId: string): Promise<LenderCasePackageView | null> {
      const c = (
        await sql<Row>`select id, lender_id, application_id, package_id from lender_case where id = ${lenderCaseId}`.execute(
          tx,
        )
      ).rows[0];
      if (!c) return null;
      const view: LenderCasePackageView = {
        lenderCaseId: String(c.id),
        lenderId: String(c.lender_id),
        applicationId: String(c.application_id),
        packageId: null,
        frozenAt: null,
        manifestSha256: null,
        manifestIntact: false,
        documents: [],
      };
      if (!c.package_id) return view;
      const p = (
        await sql<Row>`select id, manifest, manifest_sha256, frozen_at from submission_package
                        where id = ${String(c.package_id)} and lender_case_id = ${view.lenderCaseId}`.execute(
          tx,
        )
      ).rows[0];
      if (!p) return view;
      const manifest = (p.manifest ?? {}) as Record<string, unknown>;
      const sha = String(p.manifest_sha256).trim();
      const docs = Array.isArray(manifest.documents) ? (manifest.documents as ManifestDocument[]) : [];
      return {
        ...view,
        packageId: String(p.id),
        frozenAt: p.frozen_at ? new Date(p.frozen_at as string | Date) : null,
        manifestSha256: sha,
        manifestIntact: createHash('sha256').update(canonicalManifest(manifest)).digest('hex') === sha,
        documents: docs
          .filter((d) => typeof d.documentId === 'string' && d.documentId !== '')
          .map((d): FrozenPackageDocument => ({
            checklistItemId: String(d.checklistItemId),
            documentTypeCode: String(d.documentTypeCode),
            documentId: String(d.documentId),
            sha256: typeof d.sha256 === 'string' && d.sha256 !== '' ? d.sha256 : null,
          })),
      };
    },
  };
}
