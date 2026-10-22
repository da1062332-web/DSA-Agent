// apps/web/src/features/documents/api.ts — API-APP-007, API-APP-008, API-APP-009 and API-DOC-001..006 (owner: Dev 3, MOD-DOC).
import type {
  CompleteUploadResponse,
  DocumentLinkResponse,
  DocumentResource,
  DocumentVersion,
  ReviewDocumentVersionInput,
  UploadIntentResponse,
  WaiveChecklistItemInput,
} from '@dsa/contracts';
import { useQuery } from '@tanstack/react-query';
import { ApiError, apiFetch, newIdempotencyKey } from '../../api/client';
import { readConfig } from '../../config';
import type { ChecklistResponse } from './model';

export const getChecklist = (applicationId: string) =>
  apiFetch<ChecklistResponse>(`/v1/applications/${encodeURIComponent(applicationId)}/checklist`);

export function useChecklist(applicationId: string | null) {
  return useQuery({
    queryKey: ['application-checklist', applicationId],
    queryFn: () => getChecklist(applicationId!),
    enabled: !!applicationId,
  });
}

export const getDocument = (documentId: string) =>
  apiFetch<DocumentResource>(`/v1/documents/${encodeURIComponent(documentId)}`);

/** The version a reviewer acts on: the document's current one. */
export const currentVersion = (doc: DocumentResource): DocumentVersion | undefined =>
  doc.versions.find((v) => v.id === doc.currentVersionId);

const sha256 = async (bytes: ArrayBuffer) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

const apiUrl = (path: string) => {
  const config = readConfig();
  if (!config.success) throw new ApiError('INTERNAL_ERROR', 0, 'Web configuration is invalid.');
  return `${config.data.VITE_API_BASE_URL}${path}`;
};

/**
 * Staff upload for one checklist item: register an intent with the file's size and sha256 (API-DOC-001), PUT the bytes to the
 * signed url, then complete it (API-DOC-002), which scans the file and moves the item to SUBMITTED when it is clean.
 */
export async function uploadChecklistDocument(
  checklistItemId: string,
  file: File,
): Promise<CompleteUploadResponse> {
  const bytes = await file.arrayBuffer();
  const intent = await apiFetch<UploadIntentResponse>('/v1/documents/upload-intents', {
    method: 'POST',
    idempotencyKey: newIdempotencyKey(),
    body: {
      checklistItemId,
      fileName: file.name,
      sizeBytes: file.size,
      mimeType: file.type,
      sha256: await sha256(bytes),
    },
  });
  const put = await fetch(apiUrl(intent.url), {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: bytes,
  });
  if (!put.ok) {
    const env = (await put.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
    throw new ApiError(
      env?.error?.code ?? 'INTERNAL_ERROR',
      put.status,
      env?.error?.message ?? `Upload failed (${put.status}).`,
    );
  }
  return apiFetch<CompleteUploadResponse>(
    `/v1/upload-intents/${encodeURIComponent(intent.uploadIntentId)}/completion`,
    {
      method: 'POST',
    },
  );
}

/** Opens a short-lived, logged view link (API-DOC-004) in a new tab. */
export async function openDocumentVersion(versionId: string): Promise<void> {
  const link = await apiFetch<DocumentLinkResponse>(
    `/v1/document-versions/${encodeURIComponent(versionId)}/view-url`,
    { method: 'POST', body: { purpose: 'Checklist review' } },
  );
  window.open(apiUrl(link.url), '_blank', 'noopener');
}

export const reviewDocumentVersion = (
  versionId: string,
  body: ReviewDocumentVersionInput,
  idempotencyKey: string,
) =>
  apiFetch<DocumentVersion>(`/v1/document-versions/${encodeURIComponent(versionId)}/reviews`, {
    method: 'POST',
    body,
    idempotencyKey,
  });

export const waiveChecklistItem = (
  applicationId: string,
  body: WaiveChecklistItemInput,
  idempotencyKey: string,
) =>
  apiFetch<{ checklistItemId: string; status: string }>(
    `/v1/applications/${encodeURIComponent(applicationId)}/waivers`,
    {
      method: 'POST',
      body,
      idempotencyKey,
    },
  );

export interface CompletenessResult {
  result: 'COMPLETE' | 'INCOMPLETE';
  reasons: { code: string; text: string; checklistItemId?: string }[];
}

export const checkCompleteness = (applicationId: string) =>
  apiFetch<CompletenessResult>(`/v1/applications/${encodeURIComponent(applicationId)}/completeness-checks`, {
    method: 'POST',
  });
