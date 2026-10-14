// apps/api/src/modules/origination/document-sharing/storage-port.ts
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export interface StoredDocument {
  storagePath: string;
  sha256Hash: string;
  fileSizeBytes: number;
}

export interface DocumentStoragePort {
  save(tenantId: string, docId: string, buffer: Buffer, mimeType: string): Promise<StoredDocument>;
  get(tenantId: string, storagePath: string): Promise<Buffer | null>;
  delete(tenantId: string, storagePath: string): Promise<boolean>;
}

export interface FileScanResult {
  clean: boolean;
  scanStatus: 'CLEAN' | 'INFECTED' | 'QUARANTINED';
  detectedThreat?: string;
}

export interface FileScannerPort {
  scan(buffer: Buffer, filename: string, mimeType: string): Promise<FileScanResult>;
}

/**
 * Local filesystem storage provider for development and testing.
 */
export class LocalDocumentStorage implements DocumentStoragePort {
  private baseDir: string;

  constructor(baseDir = './uploads/documents') {
    this.baseDir = path.resolve(baseDir);
  }

  async save(tenantId: string, docId: string, buffer: Buffer, mimeType: string): Promise<StoredDocument> {
    const tenantDir = path.join(this.baseDir, tenantId);
    await fs.mkdir(tenantDir, { recursive: true });

    const ext = mimeType === 'application/pdf' ? '.pdf' : mimeType === 'image/png' ? '.png' : '.jpg';
    const filename = `${docId}${ext}`;
    const filePath = path.join(tenantDir, filename);

    await fs.writeFile(filePath, buffer);

    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    return {
      storagePath: path.relative(this.baseDir, filePath),
      sha256Hash: hash,
      fileSizeBytes: buffer.length,
    };
  }

  async get(tenantId: string, storagePath: string): Promise<Buffer | null> {
    const fullPath = path.join(this.baseDir, storagePath);
    // Path traversal check
    if (!fullPath.startsWith(this.baseDir)) return null;
    try {
      return await fs.readFile(fullPath);
    } catch {
      return null;
    }
  }

  async delete(tenantId: string, storagePath: string): Promise<boolean> {
    const fullPath = path.join(this.baseDir, storagePath);
    if (!fullPath.startsWith(this.baseDir)) return false;
    try {
      await fs.unlink(fullPath);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Magic-byte and signature-based file scanner.
 */
export class MagicByteFileScanner implements FileScannerPort {
  async scan(buffer: Buffer, filename: string, mimeType: string): Promise<FileScanResult> {
    // 1. Minimum and maximum size check
    if (buffer.length < 10) {
      return { clean: false, scanStatus: 'QUARANTINED', detectedThreat: 'File is empty or truncated' };
    }
    if (buffer.length > 20 * 1024 * 1024) {
      return { clean: false, scanStatus: 'QUARANTINED', detectedThreat: 'File exceeds 20MB limit' };
    }

    // 2. Magic byte inspection
    const isPdf = buffer.subarray(0, 4).toString('ascii') === '%PDF';
    const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    const isPng =
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a;

    if (mimeType === 'application/pdf' && !isPdf) {
      return { clean: false, scanStatus: 'QUARANTINED', detectedThreat: 'Magic bytes do not match PDF signature' };
    }
    if ((mimeType === 'image/jpeg' || mimeType === 'image/jpg') && !isJpeg) {
      return { clean: false, scanStatus: 'QUARANTINED', detectedThreat: 'Magic bytes do not match JPEG signature' };
    }
    if (mimeType === 'image/png' && !isPng) {
      return { clean: false, scanStatus: 'QUARANTINED', detectedThreat: 'Magic bytes do not match PNG signature' };
    }

    // 3. Executable / script signature heuristic
    const headAscii = buffer.subarray(0, 512).toString('latin1');
    if (headAscii.startsWith('MZ') || headAscii.startsWith('\x7fELF')) {
      return { clean: false, scanStatus: 'INFECTED', detectedThreat: 'Executable binary signature detected' };
    }

    return { clean: true, scanStatus: 'CLEAN' };
  }
}
