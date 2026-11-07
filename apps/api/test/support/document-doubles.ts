// Test doubles for the document upload path. Test code wires them in; production never does. The production default refuses every
// upload (fail closed, 2026-11-04), so a test that uploads needs either a real clamd or the double below.
import {
  MagicByteFileScanner,
  type FileScanResult,
  type FileScannerPort,
} from '../../src/modules/origination/document-sharing/storage-port';

/** Object storage in memory, so the test writes nothing to disk. Keys start with the tenant id, as the real stores' keys do. */
export class MemoryObjectStore {
  readonly files = new Map<string, Buffer>();
  private n = 0;

  async put(tenantId: string, name: string, bytes: Buffer): Promise<string> {
    const key = `${tenantId}/mem-${++this.n}-${name.replace(/[^A-Za-z0-9_.-]/g, '_')}`;
    this.files.set(key, bytes);
    return key;
  }

  async get(_tenantId: string, objectKey: string): Promise<Buffer | null> {
    return this.files.get(objectKey) ?? null;
  }
}

/**
 * A scanner that is ready and classifies by file signature. It stands in for a working clamd in tests that are about the upload flow, not
 * about malware. It is never the production default.
 */
export class ReadyTestScanner implements FileScannerPort {
  private readonly signatures = new MagicByteFileScanner();

  async ready(): Promise<boolean> {
    return true;
  }

  async scan(buffer: Buffer, filename: string, mimeType: string): Promise<FileScanResult> {
    return this.signatures.scan(buffer, filename, mimeType);
  }
}
