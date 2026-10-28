// Production backends for document files (owner: Dev 3; MOD-DOC SUB-DOC.03/.04, audit AUD-013). Chosen by configuration
// (config.ts DOCUMENT_STORE, DOCUMENT_S3_*, CLAMAV_ADDRESS); without it the API keeps files on local disk and checks only
// file signatures, which suits development only.
//   S3DocumentObjectStore         any S3-compatible bucket (AWS S3, the Supabase Storage S3 endpoint, MinIO), signed with
//                                 AWS Signature V4 and the bucket's own access keys. The API never holds the Supabase
//                                 service-role key (ADR-SB-02).
//   EncryptedDocumentObjectStore  AES-256-GCM at rest with a key per tenant derived from APP_SIGNING_SECRET; files written
//                                 before encryption was turned on are still read as they are.
//   ClamAvFileScanner             the file-signature check, then clamd INSTREAM. A scanner that cannot answer fails the
//                                 upload completion with 503 (retryable); nothing is marked clean without a verdict.
import { AppError } from '@dsa/contracts';
import crypto from 'node:crypto';
import net from 'node:net';
import {
  MagicByteFileScanner,
  type FileScannerPort,
  type FileScanResult,
} from '../document-sharing/storage-port';
import type { DocumentObjectStore } from './document-store';

const TENANT_ID = /^[A-Za-z0-9_-]+$/;
const objectName = (name: string) => name.replace(/[^A-Za-z0-9_.-]/g, '_');
const sha256 = (data: Buffer | string) => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer | string, data: string) => crypto.createHmac('sha256', key).update(data).digest();

export interface S3StoreConfig {
  /** Base URL of the S3 API, e.g. https://<project>.supabase.co/storage/v1/s3 or https://s3.ap-south-1.amazonaws.com */
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/** AWS Signature V4 headers for one S3 request (path-style). `headers` must not hold host or x-amz-*; they are added. */
export function signS3Request(opts: {
  method: string;
  url: URL;
  payloadHash: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  now: Date;
  headers?: Record<string, string>;
}): Record<string, string> {
  const amzDate = opts.now.toISOString().replace(/[-:]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    ...Object.fromEntries(Object.entries(opts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v.trim()])),
    host: opts.url.host,
    'x-amz-content-sha256': opts.payloadHash,
    'x-amz-date': amzDate,
  };
  const names = Object.keys(headers).sort();
  const canonicalQuery = [...opts.url.searchParams]
    .map(([k, v]) => [encodeURIComponent(k), encodeURIComponent(v)])
    .sort(([a], [b]) => (a! < b! ? -1 : a! > b! ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const canonicalRequest = [
    opts.method,
    opts.url.pathname,
    canonicalQuery,
    names.map((n) => `${n}:${headers[n]}\n`).join(''),
    names.join(';'),
    opts.payloadHash,
  ].join('\n');
  const scope = `${day}/${opts.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${opts.secretAccessKey}`, day), opts.region), 's3'),
    'aws4_request',
  );
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${opts.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`,
  };
}

export class S3DocumentObjectStore implements DocumentObjectStore {
  constructor(
    private readonly cfg: S3StoreConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private async send(method: 'GET' | 'PUT', key: string, body?: Buffer): Promise<Response> {
    const url = new URL(`${this.cfg.endpoint.replace(/\/+$/, '')}/${this.cfg.bucket}/${key}`);
    const signed = signS3Request({
      method,
      url,
      payloadHash: sha256(body ?? ''),
      region: this.cfg.region,
      accessKeyId: this.cfg.accessKeyId,
      secretAccessKey: this.cfg.secretAccessKey,
      now: this.clock(),
    });
    // fetch sets Host from the URL itself; the signed value is the same.
    const { host: _host, ...headers } = signed;
    try {
      return await this.fetchImpl(url, { method, headers, body: body ? new Uint8Array(body) : undefined });
    } catch {
      throw AppError.of('DEPENDENCY_UNAVAILABLE', 'The document store is not reachable. Try again.');
    }
  }

  async put(tenantId: string, name: string, bytes: Buffer): Promise<string> {
    if (!TENANT_ID.test(tenantId)) throw new Error('Invalid object key.');
    const key = `${tenantId}/${objectName(name)}`;
    const res = await this.send('PUT', key, bytes);
    if (!res.ok)
      throw AppError.of('DEPENDENCY_UNAVAILABLE', 'The document store refused the file. Try again.');
    return key;
  }

  async get(tenantId: string, objectKey: string): Promise<Buffer | null> {
    // A key outside the tenant's own folder is never fetched, whatever the row says.
    if (!TENANT_ID.test(tenantId) || !objectKey.startsWith(`${tenantId}/`) || objectKey.includes('..'))
      return null;
    const res = await this.send('GET', objectKey);
    if (res.status === 404) return null;
    if (!res.ok)
      throw AppError.of('DEPENDENCY_UNAVAILABLE', 'The document store could not return the file. Try again.');
    return Buffer.from(await res.arrayBuffer());
  }
}

const SEALED = Buffer.from('DSAENC1\0', 'latin1');

/** Encrypts every file at rest with AES-256-GCM: a key per tenant, a fresh IV per file, the tenant id as associated data. */
export class EncryptedDocumentObjectStore implements DocumentObjectStore {
  constructor(
    private readonly inner: DocumentObjectStore,
    private readonly secret: string,
  ) {}

  private key(tenantId: string): Buffer {
    return hmac(this.secret, `dsa:documents-at-rest:v1:${tenantId}`);
  }

  async put(tenantId: string, name: string, bytes: Buffer): Promise<string> {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key(tenantId), iv);
    cipher.setAAD(Buffer.from(tenantId));
    const enc = Buffer.concat([cipher.update(bytes), cipher.final()]);
    return this.inner.put(tenantId, name, Buffer.concat([SEALED, iv, cipher.getAuthTag(), enc]));
  }

  async get(tenantId: string, objectKey: string): Promise<Buffer | null> {
    const stored = await this.inner.get(tenantId, objectKey);
    if (!stored) return null;
    // Written before encryption was turned on: returned as stored.
    if (stored.length < SEALED.length + 28 || !stored.subarray(0, SEALED.length).equals(SEALED))
      return stored;
    const body = stored.subarray(SEALED.length);
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key(tenantId), body.subarray(0, 12));
    decipher.setAAD(Buffer.from(tenantId));
    decipher.setAuthTag(body.subarray(12, 28));
    try {
      return Buffer.concat([decipher.update(body.subarray(28)), decipher.final()]);
    } catch {
      // Tampered, or sealed under another key: never served.
      return null;
    }
  }
}

/** Sends `bytes` to clamd with INSTREAM and returns its one-line answer, e.g. "stream: OK". */
export function clamdInstream(host: string, port: number, bytes: Buffer, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    const chunks: Buffer[] = [];
    socket.setTimeout(timeoutMs, () => socket.destroy(new Error('clamd timed out')));
    socket.on('error', reject);
    socket.on('data', (d) => chunks.push(d));
    socket.on('close', () => resolve(Buffer.concat(chunks).toString('utf8').replace(/\0/g, '').trim()));
    socket.on('connect', () => {
      socket.write('zINSTREAM\0');
      for (let i = 0; i < bytes.length; i += 64 * 1024) {
        const part = bytes.subarray(i, i + 64 * 1024);
        const size = Buffer.alloc(4);
        size.writeUInt32BE(part.length);
        socket.write(size);
        socket.write(part);
      }
      socket.end(Buffer.alloc(4));
    });
  });
}

export class ClamAvFileScanner implements FileScannerPort {
  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly signatureCheck: FileScannerPort = new MagicByteFileScanner(),
    private readonly timeoutMs = 30_000,
  ) {}

  async scan(buffer: Buffer, filename: string, mimeType: string): Promise<FileScanResult> {
    const signature = await this.signatureCheck.scan(buffer, filename, mimeType);
    if (!signature.clean) return signature;
    let answer: string;
    try {
      answer = await clamdInstream(this.host, this.port, buffer, this.timeoutMs);
    } catch {
      throw AppError.of('DEPENDENCY_UNAVAILABLE', 'The malware scanner is not reachable. Try again.');
    }
    if (answer === 'stream: OK') return { clean: true, scanStatus: 'CLEAN' };
    const found = /^stream: (.+) FOUND$/.exec(answer);
    if (found) return { clean: false, scanStatus: 'INFECTED', detectedThreat: found[1] };
    throw AppError.of('DEPENDENCY_UNAVAILABLE', 'The malware scanner did not give a verdict. Try again.');
  }
}

export interface DocumentBackendConfig {
  DOCUMENT_STORE: 'local' | 's3';
  DOCUMENT_S3_ENDPOINT?: string;
  DOCUMENT_S3_REGION: string;
  DOCUMENT_S3_BUCKET?: string;
  DOCUMENT_S3_ACCESS_KEY_ID?: string;
  DOCUMENT_S3_SECRET_ACCESS_KEY?: string;
  CLAMAV_ADDRESS?: string;
}

/** The configured store and scanner; undefined means the local defaults in documentDeps. config.ts checks completeness. */
export function documentBackendsFromConfig(cfg: DocumentBackendConfig): {
  documentStore?: DocumentObjectStore;
  documentScanner?: FileScannerPort;
} {
  const out: { documentStore?: DocumentObjectStore; documentScanner?: FileScannerPort } = {};
  if (cfg.DOCUMENT_STORE === 's3') {
    out.documentStore = new S3DocumentObjectStore({
      endpoint: cfg.DOCUMENT_S3_ENDPOINT!,
      region: cfg.DOCUMENT_S3_REGION,
      bucket: cfg.DOCUMENT_S3_BUCKET!,
      accessKeyId: cfg.DOCUMENT_S3_ACCESS_KEY_ID!,
      secretAccessKey: cfg.DOCUMENT_S3_SECRET_ACCESS_KEY!,
    });
  }
  if (cfg.CLAMAV_ADDRESS) {
    const [host, port] = cfg.CLAMAV_ADDRESS.split(':');
    out.documentScanner = new ClamAvFileScanner(host!, port ? Number(port) : 3310);
  }
  return out;
}
