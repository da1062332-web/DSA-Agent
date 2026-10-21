// Document object storage and signed links (owner: Dev 3; MOD-DOC SUB-DOC.03 and SUB-DOC.07). Bytes live outside the database;
// rows hold the object key and sha256. Keys are always under the tenant's own folder, and a read checks that prefix, so one
// tenant's key can never fetch another tenant's file. Links to download a version are signed (HMAC-SHA256) and short-lived;
// the signing key is derived from the deployment secret, so links work across API instances and nothing is stored per link.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export interface DocumentObjectStore {
  put(tenantId: string, name: string, bytes: Buffer): Promise<string>;
  get(tenantId: string, objectKey: string): Promise<Buffer | null>;
}

export class LocalDocumentObjectStore implements DocumentObjectStore {
  private readonly baseDir: string;

  constructor(baseDir = process.env.DOCUMENT_STORAGE_DIR ?? './uploads/documents-v2') {
    this.baseDir = path.resolve(baseDir);
  }

  private within(tenantId: string, key: string): string | null {
    if (!/^[A-Za-z0-9_-]+$/.test(tenantId)) return null;
    const full = path.resolve(this.baseDir, key);
    const tenantRoot = path.resolve(this.baseDir, tenantId) + path.sep;
    return full.startsWith(tenantRoot) ? full : null;
  }

  async put(tenantId: string, name: string, bytes: Buffer): Promise<string> {
    const key = `${tenantId}/${name.replace(/[^A-Za-z0-9_.-]/g, '_')}`;
    const full = this.within(tenantId, key);
    if (!full) throw new Error('Invalid object key.');
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, bytes);
    return key;
  }

  async get(tenantId: string, objectKey: string): Promise<Buffer | null> {
    const full = this.within(tenantId, objectKey);
    if (!full) return null;
    try {
      return await fs.readFile(full);
    } catch {
      return null;
    }
  }
}

export const sha256Hex = (bytes: Buffer | string) => crypto.createHash('sha256').update(bytes).digest('hex');

export interface FileLinkClaims {
  /** tenant */
  t: string;
  /** what: 'v' = a document version, 'a' = an archive */
  k: 'v' | 'a';
  /** id of the version or archive */
  i: string;
  /** disposition: inline (view) or attachment (download) */
  d: 'inline' | 'attachment';
  /** expiry, epoch seconds */
  e: number;
}

export class FileLinkSigner {
  private readonly key: Buffer;

  constructor(secret: string) {
    // A dedicated key, so a link signature is never usable for anything else signed with the deployment secret.
    this.key = crypto.createHmac('sha256', secret).update('dsa:document-links:v1').digest();
  }

  sign(claims: FileLinkClaims): string {
    const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const sig = crypto.createHmac('sha256', this.key).update(body).digest('base64url');
    return `${body}.${sig}`;
  }

  verify(token: string, nowSeconds: number): FileLinkClaims | null {
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;
    const expected = crypto.createHmac('sha256', this.key).update(body).digest();
    const given = Buffer.from(sig, 'base64url');
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
    try {
      const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as FileLinkClaims;
      return claims.e > nowSeconds ? claims : null;
    } catch {
      return null;
    }
  }
}

/** AES-256-GCM at rest for archives: iv (12) + tag (16) + ciphertext. */
export function encryptArchive(plain: Buffer, secret: string): Buffer {
  const key = crypto.createHmac('sha256', secret).update('dsa:document-archives:v1').digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]);
}

export function decryptArchive(sealed: Buffer, secret: string): Buffer {
  const key = crypto.createHmac('sha256', secret).update('dsa:document-archives:v1').digest();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, sealed.subarray(0, 12));
  decipher.setAuthTag(sealed.subarray(12, 28));
  return Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]);
}
