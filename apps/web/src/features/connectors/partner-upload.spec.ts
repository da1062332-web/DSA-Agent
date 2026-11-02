// The partner's document upload: the checks before anything is sent, the order of the steps, and each failure (TEST-CPT-UPL).
import { describe, expect, it } from 'vitest';
import {
  browserUploadPort,
  fileProblem,
  sendPartnerDocument,
  type PartnerUploadPort,
} from './partner-upload';

const item = {
  checklistItemId: 'chk_1',
  documentName: 'PAN card',
  allowedMime: ['application/pdf', 'image/png'],
  maxSizeBytes: 1024 * 1024,
};
const pdf = (size = 100) => new File([new Uint8Array(size)], 'pan.pdf', { type: 'application/pdf' });

function fakePort(overrides: Partial<PartnerUploadPort> = {}) {
  const calls: string[] = [];
  const port: PartnerUploadPort = {
    sha256: async () => {
      calls.push('sha256');
      return 'a'.repeat(64);
    },
    requestUpload: async (leadId, body) => {
      calls.push(`requestUpload:${leadId}:${body.checklistItemId}:${body.sha256.length}`);
      return { uploadIntentId: 'upi_1', url: '/public/v1/document-uploads/token' };
    },
    sendBytes: async () => {
      calls.push('sendBytes');
    },
    complete: async () => {
      calls.push('complete');
      return { status: 'ACCEPTED' };
    },
    ...overrides,
  };
  return { port, calls };
}

describe('partner document upload (TEST-CPT-UPL)', () => {
  it('TEST-CPT-UPL-01 a file of the wrong type, empty, or too large is refused before anything is sent', () => {
    expect(fileProblem(item, { size: 100, type: 'image/gif' })).toMatch(/must be a PDF, PNG file/);
    expect(fileProblem(item, { size: 0, type: 'application/pdf' })).toBe('The file is empty.');
    expect(fileProblem(item, { size: 2 * 1024 * 1024, type: 'application/pdf' })).toMatch(/larger than 1 MB/);
    expect(fileProblem(item, { size: 100, type: 'application/pdf' })).toBeNull();
  });

  it('TEST-CPT-UPL-02 a file the checks refuse is never hashed, requested, sent or completed', async () => {
    const { port, calls } = fakePort();
    const stages: string[] = [];
    const result = await sendPartnerDocument(
      'lead_1',
      item,
      new File(['x'], 'a.gif', { type: 'image/gif' }),
      port,
      (s) => stages.push(s),
    );
    expect(result).toBe('FAILED');
    expect(calls).toEqual([]);
    expect(stages).toEqual(['FAILED']);
  });

  it('TEST-CPT-UPL-03 an accepted file goes through hash, request, bytes, scan and completion, in that order', async () => {
    const { port, calls } = fakePort();
    const stages: string[] = [];
    const result = await sendPartnerDocument('lead_1', item, pdf(), port, (s) => stages.push(s));
    expect(result).toBe('ACCEPTED');
    expect(calls).toEqual(['sha256', 'requestUpload:lead_1:chk_1:64', 'sendBytes', 'complete']);
    expect(stages).toEqual(['UPLOADING', 'SCANNING', 'ACCEPTED']);
  });

  it('TEST-CPT-UPL-04 a file the scan does not pass is reported as rejected, and nothing is shown as accepted', async () => {
    const { port } = fakePort({ complete: async () => ({ status: 'NOT_ACCEPTED' }) });
    const stages: string[] = [];
    const result = await sendPartnerDocument('lead_1', item, pdf(), port, (s) => stages.push(s));
    expect(result).toBe('NOT_ACCEPTED');
    expect(stages).toEqual(['UPLOADING', 'SCANNING', 'NOT_ACCEPTED']);
  });

  it('TEST-CPT-UPL-05 when the bytes do not reach the signed link, the upload is not completed', async () => {
    const { port, calls } = fakePort({
      sendBytes: async () => {
        throw new Error('The file could not be sent. Try again.');
      },
    });
    const stages: Array<[string, string | undefined]> = [];
    const result = await sendPartnerDocument('lead_1', item, pdf(), port, (s, m) => stages.push([s, m]));
    expect(result).toBe('FAILED');
    expect(calls).not.toContain('complete');
    expect(stages.at(-1)).toEqual(['FAILED', 'The file could not be sent. Try again.']);
  });

  it('TEST-CPT-UPL-06 when the API refuses the request, the refusal is shown and nothing is sent', async () => {
    const { port, calls } = fakePort({
      requestUpload: async () => {
        throw new Error(
          'Document uploads are unavailable: the malware scanner is not configured or not responding.',
        );
      },
    });
    const result = await sendPartnerDocument('lead_1', item, pdf(), port, () => undefined);
    expect(result).toBe('FAILED');
    expect(calls).not.toContain('sendBytes');
    expect(calls).not.toContain('complete');
  });

  it('TEST-CPT-UPL-07 the browser hashes the file with SHA-256 as the API expects it', async () => {
    const digest = await browserUploadPort().sha256(new File(['abc'], 'abc.txt', { type: 'text/plain' }));
    expect(digest).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
