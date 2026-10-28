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
import { getSupabase, getSupabaseStorageClient } from '../../auth/supabase';
import { readConfig } from '../../config';
import type { ChecklistResponse } from './model';

export interface SupabaseStorageFile {
  name: string;
  id?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  last_accessed_at?: string | null;
  metadata?: {
    size?: number;
    mimetype?: string;
    eTag?: string;
    lastModified?: string;
    [key: string]: unknown;
  } | null;
}

export const getChecklist = (applicationId: string) =>
  apiFetch<ChecklistResponse>(`/v1/applications/${encodeURIComponent(applicationId)}/checklist`);

export const generateChecklist = (applicationId: string) =>
  apiFetch<ChecklistResponse>(`/v1/applications/${encodeURIComponent(applicationId)}/checklist/generate`, {
    method: 'POST',
  });

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

function normalizeDocumentMimeType(file: File): 'application/pdf' | 'image/jpeg' | 'image/png' {
  const t = file.type?.toLowerCase();
  if (t === 'application/pdf') return 'application/pdf';
  if (t === 'image/jpeg' || t === 'image/jpg' || t === 'image/pjpeg') return 'image/jpeg';
  if (t === 'image/png') return 'image/png';

  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';

  throw new ApiError(
    'VALIDATION_ERROR',
    422,
    `Unsupported file format (${file.type || ext || 'unknown'}). Only PDF, JPEG, and PNG files are accepted.`,
  );
}

/**
 * Staff upload for one checklist item: register an intent with the file's size and sha256 (API-DOC-001), PUT the bytes to the
 * signed url, then complete it (API-DOC-002), which scans the file and moves the item to SUBMITTED when it is clean.
 */
export async function uploadChecklistDocument(
  checklistItemId: string,
  file: File,
): Promise<CompleteUploadResponse> {
  const bytes = await file.arrayBuffer();
  const mimeType = normalizeDocumentMimeType(file);
  const cleanFileName = file.name.replace(/^.*[\\/]/, '') || `document.${mimeType === 'application/pdf' ? 'pdf' : mimeType === 'image/png' ? 'png' : 'jpg'}`;

  // Also mirror direct upload to Supabase Storage 'Media' bucket in 'Documents/' folder
  try {
    const supabase = getSupabaseStorageClient();
    const { error: storageError } = await supabase.storage
      .from('Media')
      .upload(`Documents/${checklistItemId}_${cleanFileName}`, file, {
        upsert: true,
        cacheControl: '3600',
      });
    if (storageError) {
      console.warn('Direct Supabase Storage sync notice:', storageError.message);
    }
  } catch (err) {
    // Non-fatal warning if direct Supabase mirror upload encounters any network friction
    console.warn('Direct Supabase Storage sync notice:', err);
  }

  const intent = await apiFetch<UploadIntentResponse>('/v1/documents/upload-intents', {
    method: 'POST',
    idempotencyKey: newIdempotencyKey(),
    body: {
      checklistItemId,
      fileName: cleanFileName,
      sizeBytes: file.size,
      mimeType,
      sha256: await sha256(bytes),
    },
  });
  const put = await fetch(apiUrl(intent.url), {
    method: 'PUT',
    headers: { 'Content-Type': mimeType },
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

/** Opens a short-lived, logged download link (API-DOC-005): the browser saves the file instead of showing it. */
export async function downloadDocumentVersion(versionId: string): Promise<void> {
  const link = await apiFetch<DocumentLinkResponse>(
    `/v1/document-versions/${encodeURIComponent(versionId)}/download-url`,
    { method: 'POST', body: { purpose: 'Checklist download' } },
  );
  window.open(apiUrl(link.url), '_blank', 'noopener');
}

/** Opens a short-lived, logged view link (API-DOC-004) in a new tab. */
export async function openDocumentVersion(versionId: string): Promise<void> {
  const link = await apiFetch<DocumentLinkResponse>(
    `/v1/document-versions/${encodeURIComponent(versionId)}/view-url`,
    { method: 'POST', body: { purpose: 'Checklist review' } },
  );
  window.open(apiUrl(link.url), '_blank', 'noopener');
}

/**
 * Uploads a file directly from the browser into Supabase Storage bucket 'Media'.
 * Bypasses the API server for fast, direct cloud storage.
 */
export async function uploadDirectToSupabase(
  file: File,
  folder = 'Documents',
  customName?: string,
): Promise<{ path: string; fullPath: string }> {
  const supabase = getSupabaseStorageClient();
  const cleanName = (customName || file.name).replace(/[^A-Za-z0-9_.-]/g, '_');
  const path = `${folder}/${cleanName}`;

  const { data, error } = await supabase.storage
    .from('Media')
    .upload(path, file, {
      cacheControl: '3600',
      upsert: true,
    });

  if (error) {
    throw new ApiError('STORAGE_ERROR', 400, `Supabase storage upload failed: ${error.message}`);
  }

  return { path: data.path, fullPath: data.fullPath };
}

/** Lists all files in the Supabase 'Media' bucket inside the given folder (default 'Documents'). */
export async function listSupabaseStorageFiles(folder = 'Documents'): Promise<SupabaseStorageFile[]> {
  const supabase = getSupabaseStorageClient();
  const { data, error } = await supabase.storage
    .from('Media')
    .list(folder, {
      sortBy: { column: 'created_at', order: 'desc' },
    });

  if (error) {
    throw new ApiError('STORAGE_ERROR', 400, `Failed to list files: ${error.message}`);
  }

  return (data || [])
    .filter((f) => f.name && !f.name.startsWith('.'))
    .map((f) => ({ ...f, id: f.id ?? undefined }) as SupabaseStorageFile);
}

/** Generates a secure, temporary signed preview URL for a file in Supabase Storage. */
export async function getSupabaseSignedUrl(path: string, expiresInSeconds = 3600): Promise<string> {
  const supabase = getSupabaseStorageClient();
  const { data, error } = await supabase.storage
    .from('Media')
    .createSignedUrl(path, expiresInSeconds);

  if (error || !data?.signedUrl) {
    throw new ApiError('STORAGE_ERROR', 400, error?.message || 'Could not generate signed preview link.');
  }

  return data.signedUrl;
}

/** Deletes a file from the Supabase 'Media' bucket. */
export async function deleteSupabaseStorageFile(path: string): Promise<void> {
  const supabase = getSupabaseStorageClient();
  const { error } = await supabase.storage
    .from('Media')
    .remove([path]);

  if (error) {
    throw new ApiError('STORAGE_ERROR', 400, `Failed to delete file: ${error.message}`);
  }
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

/** A bulk archive of an application's documents (API-DOC-009): built in the background, then served by a signed link. */
export interface DocumentArchive {
  archiveId: string;
  status: 'QUEUED' | 'READY' | 'FAILED';
  documentCount: number;
  url: string | null;
  expiresAt: string | null;
}

/** Queues an encrypted archive of the application's clean, current document versions (document.download). */
export function requestDocumentArchive(applicationId: string): Promise<DocumentArchive> {
  return apiFetch<DocumentArchive>(`/v1/applications/${encodeURIComponent(applicationId)}/document-archive`, {
    method: 'POST',
    body: {},
  });
}

/** The archive's state, polled until it is READY or FAILED (API-DOC-009-STATUS). */
export function useDocumentArchive(archiveId: string | null) {
  return useQuery({
    queryKey: ['document-archive', archiveId],
    queryFn: () => apiFetch<DocumentArchive>(`/v1/document-archives/${encodeURIComponent(archiveId!)}`),
    enabled: !!archiveId,
    refetchInterval: (q) => (q.state.data?.status === 'QUEUED' ? 3000 : false),
  });
}

/** Opens a signed file link (a ready archive) in a new tab. */
export function openSignedLink(url: string): void {
  window.open(apiUrl(url), '_blank', 'noopener');
}
