// A partner's upload of one requested document: check the file, hash it, ask the API for an upload, send the bytes to the signed link, then
// complete the upload so the API scans it. The network is passed in, so the order of the steps and each failure are tested without a
// server. The file never leaves the browser before the checks, and the partner is shown only what the API returns.
import { apiFetch } from '../../api/client';
import { readConfig } from '../../config';

export interface PartnerDocumentRequest {
  checklistItemId: string;
  documentName: string;
  allowedMime: string[];
  maxSizeBytes: number;
}

export type PartnerUploadStage = 'UPLOADING' | 'SCANNING' | 'ACCEPTED' | 'NOT_ACCEPTED' | 'FAILED';

export interface PartnerUploadPort {
  sha256(file: Blob): Promise<string>;
  requestUpload(
    leadId: string,
    body: { checklistItemId: string; fileName: string; sizeBytes: number; mimeType: string; sha256: string },
  ): Promise<{ uploadIntentId: string; url: string }>;
  sendBytes(url: string, file: Blob, mimeType: string): Promise<void>;
  complete(uploadIntentId: string): Promise<{ status: 'ACCEPTED' | 'NOT_ACCEPTED' }>;
}

/** Why the file cannot be sent, or null when it can. The API checks the same rules; this only saves a round trip. */
export function fileProblem(
  item: PartnerDocumentRequest,
  file: { size: number; type: string },
): string | null {
  if (!item.allowedMime.includes(file.type)) {
    return `${item.documentName} must be a ${item.allowedMime.map((m) => m.replace('application/', '').replace('image/', '').toUpperCase()).join(', ')} file.`;
  }
  if (file.size <= 0) return 'The file is empty.';
  if (file.size > item.maxSizeBytes) {
    return `The file is larger than ${Math.round(item.maxSizeBytes / (1024 * 1024))} MB.`;
  }
  return null;
}

/**
 * Sends one document. `onStage` is told each stage in turn, and the final result is returned. A failure at any step is reported as
 * FAILED with a message, and nothing after it is attempted: in particular the upload is not completed when the bytes were not sent.
 */
export async function sendPartnerDocument(
  leadId: string,
  item: PartnerDocumentRequest,
  file: File,
  port: PartnerUploadPort,
  onStage: (stage: PartnerUploadStage, message?: string) => void,
): Promise<'ACCEPTED' | 'NOT_ACCEPTED' | 'FAILED'> {
  const problem = fileProblem(item, file);
  if (problem) {
    onStage('FAILED', problem);
    return 'FAILED';
  }
  onStage('UPLOADING');
  try {
    const sha256 = await port.sha256(file);
    const intent = await port.requestUpload(leadId, {
      checklistItemId: item.checklistItemId,
      fileName: file.name,
      sizeBytes: file.size,
      mimeType: file.type,
      sha256,
    });
    await port.sendBytes(intent.url, file, file.type);
    onStage('SCANNING');
    const done = await port.complete(intent.uploadIntentId);
    onStage(done.status);
    return done.status;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'The document could not be sent. Try again.';
    onStage('FAILED', message);
    return 'FAILED';
  }
}

const hex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

/** The port the portal uses: the existing portal routes and the signed upload link, as the API issues them. */
export function browserUploadPort(): PartnerUploadPort {
  return {
    sha256: async (file) => hex(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())),
    requestUpload: (leadId, body) =>
      apiFetch<{ uploadIntentId: string; url: string }>(
        `/portal/v1/referrals/${leadId}/documents/upload-intents`,
        {
          method: 'POST',
          body,
        },
      ),
    sendBytes: async (url, file, mimeType) => {
      const config = readConfig();
      if (!config.success) throw new Error('The file could not be sent. Try again.');
      const res = await fetch(`${config.data.VITE_API_BASE_URL}${url}`, {
        method: 'PUT',
        headers: { 'Content-Type': mimeType },
        body: file,
      });
      if (!res.ok) throw new Error('The file could not be sent. Try again.');
    },
    complete: (uploadIntentId) =>
      apiFetch<{ uploadIntentId: string; status: 'ACCEPTED' | 'NOT_ACCEPTED' }>(
        `/portal/v1/upload-intents/${uploadIntentId}/completion`,
        { method: 'POST', body: {} },
      ),
  };
}
