// apps/api/src/storage/object-storage.ts — owner: Platform Squad (MOD-IMP, TASK-413)
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';

export interface StoredObject {
  storageKey: string;
  sha256Hash: string;
  fileSizeBytes: number;
  mimeType: string;
}

export interface ObjectStoragePort {
  save(
    tenantId: string,
    category: 'quarantine' | 'source' | 'reports' | 'exports',
    filename: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<StoredObject>;
  get(tenantId: string, storageKey: string): Promise<Buffer | null>;
  delete(tenantId: string, storageKey: string): Promise<boolean>;
  cleanupExpired(
    category: 'quarantine' | 'source' | 'reports' | 'exports',
    maxAgeHours: number,
  ): Promise<number>;
}

/**
 * Local filesystem object storage provider with tenant isolation and strict path traversal guards.
 * Follows the pattern established by DocumentStoragePort in origination/document-sharing.
 */
export class LocalObjectStorage implements ObjectStoragePort {
  private readonly baseDir: string;

  constructor(baseDir = './uploads/storage') {
    this.baseDir = path.resolve(baseDir);
  }

  async save(
    tenantId: string,
    category: 'quarantine' | 'source' | 'reports' | 'exports',
    filename: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<StoredObject> {
    // Sanitize filename to prevent directory traversal
    const safeFilename = path.basename(filename).replace(/[^a-zA-Z0-9_.-]/g, '_');
    const targetDir = path.join(this.baseDir, tenantId, category);
    await fs.mkdir(targetDir, { recursive: true });

    const filePath = path.join(targetDir, safeFilename);

    // Verify resolved path is strictly within baseDir
    const resolvedFilePath = path.resolve(filePath);
    if (!resolvedFilePath.toLowerCase().startsWith(this.baseDir.toLowerCase())) {
      throw new Error('Path traversal attempt detected.');
    }

    await fs.writeFile(resolvedFilePath, buffer);

    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const relativeKey = path.relative(this.baseDir, resolvedFilePath).replace(/\\/g, '/');

    return {
      storageKey: relativeKey,
      sha256Hash: hash,
      fileSizeBytes: buffer.length,
      mimeType,
    };
  }

  async get(tenantId: string, storageKey: string): Promise<Buffer | null> {
    const fullPath = path.resolve(this.baseDir, storageKey);

    // Strict path traversal and tenant isolation check
    const expectedPrefix = path.resolve(this.baseDir, tenantId);
    if (!fullPath.toLowerCase().startsWith(expectedPrefix.toLowerCase())) {
      return null;
    }

    try {
      return await fs.readFile(fullPath);
    } catch {
      return null;
    }
  }

  async delete(tenantId: string, storageKey: string): Promise<boolean> {
    const fullPath = path.resolve(this.baseDir, storageKey);
    const expectedPrefix = path.resolve(this.baseDir, tenantId);
    if (!fullPath.toLowerCase().startsWith(expectedPrefix.toLowerCase())) {
      return false;
    }

    try {
      await fs.unlink(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  async cleanupExpired(
    category: 'quarantine' | 'source' | 'reports' | 'exports',
    maxAgeHours: number,
  ): Promise<number> {
    if (!existsSync(this.baseDir)) return 0;
    let deletedCount = 0;
    const now = Date.now();
    const thresholdMs = maxAgeHours * 60 * 60 * 1000;

    try {
      const tenants = await fs.readdir(this.baseDir);
      for (const t of tenants) {
        const catDir = path.join(this.baseDir, t, category);
        try {
          const files = await fs.readdir(catDir);
          for (const f of files) {
            const filePath = path.join(catDir, f);
            const stat = await fs.stat(filePath);
            if (now - stat.mtimeMs > thresholdMs) {
              await fs.unlink(filePath);
              deletedCount++;
            }
          }
        } catch {
          // Category directory may not exist for this tenant
        }
      }
    } catch {
      // Base directory read error
    }

    return deletedCount;
  }
}

// Singleton storage instance for application runtime
export const globalStorage: ObjectStoragePort = new LocalObjectStorage();
