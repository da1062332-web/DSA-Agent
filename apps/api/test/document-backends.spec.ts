// Production document backends (owner: Dev 3; MOD-DOC SUB-DOC.03/.04, audit AUD-013): S3-compatible store with Signature V4,
// encryption at rest, the ClamAV scanner and their configuration. No network: fetch and clamd are faked.
import { AppError } from '@dsa/contracts';
import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import {
  ClamAvFileScanner,
  documentBackendsFromConfig,
  EncryptedDocumentObjectStore,
  S3DocumentObjectStore,
  signS3Request,
} from '../src/modules/origination/applications/document-backends';
import type { DocumentObjectStore } from '../src/modules/origination/applications/document-store';

const PDF = Buffer.from('%PDF-1.4\n% synthetic test document\n%%EOF\n');

class MemoryStore implements DocumentObjectStore {
  readonly files = new Map<string, Buffer>();
  async put(tenantId: string, name: string, bytes: Buffer) {
    const key = `${tenantId}/${name}`;
    this.files.set(key, bytes);
    return key;
  }
  async get(_tenantId: string, key: string) {
    return this.files.get(key) ?? null;
  }
}

describe('S3-compatible document store (TEST-DOC-BACKEND-S3)', () => {
  it('TEST-DOC-BACKEND-S3-01 signs a request exactly as the AWS Signature V4 example for GET Object', () => {
    // AWS S3 documentation, "Signature Calculations for the Authorization Header", example GET Object.
    const headers = signS3Request({
      method: 'GET',
      url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
      payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      region: 'us-east-1',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      now: new Date('2013-05-24T00:00:00Z'),
      headers: { Range: 'bytes=0-9' },
    });
    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
        'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, ' +
        'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
  });

  const cfg = {
    endpoint: 'https://store.example.test/storage/v1/s3/',
    region: 'ap-south-1',
    bucket: 'documents',
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'synthetic-secret-key',
  };

  it('TEST-DOC-BACKEND-S3-02 puts and gets under the tenant folder with a signed request, and a missing object is null', async () => {
    const objects = new Map<string, Uint8Array>();
    const calls: { method: string; url: string; auth: string | null }[] = [];
    const fakeFetch = (async (input: URL | string, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      calls.push({ method: init?.method ?? 'GET', url, auth: headers.get('authorization') });
      if (init?.method === 'PUT') {
        objects.set(url, init.body as Uint8Array);
        return new Response(null, { status: 200 });
      }
      const body = objects.get(url);
      return body ? new Response(body, { status: 200 }) : new Response('NoSuchKey', { status: 404 });
    }) as typeof fetch;
    const store = new S3DocumentObjectStore(cfg, fakeFetch, () => new Date('2026-10-28T10:00:00Z'));

    const key = await store.put('ten_a', 'ver 1.pdf', PDF);
    expect(key).toBe('ten_a/ver_1.pdf');
    expect(await store.get('ten_a', key)).toEqual(PDF);
    expect(await store.get('ten_a', 'ten_a/absent.pdf')).toBeNull();
    expect(calls[0]).toMatchObject({
      method: 'PUT',
      url: 'https://store.example.test/storage/v1/s3/documents/ten_a/ver_1.pdf',
    });
    expect(calls[0]!.auth).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20261028\/ap-south-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
  });

  it('TEST-DOC-BACKEND-S3-03 never fetches a key outside the tenant folder, and an unreachable or refusing store is 503', async () => {
    let called = 0;
    const refusing = (async () => {
      called += 1;
      return new Response('AccessDenied', { status: 403 });
    }) as typeof fetch;
    const store = new S3DocumentObjectStore(cfg, refusing);
    expect(await store.get('ten_a', 'ten_b/secret.pdf')).toBeNull();
    expect(await store.get('ten_a', 'ten_a/../ten_b/secret.pdf')).toBeNull();
    expect(called).toBe(0);
    await expect(store.get('ten_a', 'ten_a/x.pdf')).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
    await expect(store.put('ten_a', 'x.pdf', PDF)).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
    const down = new S3DocumentObjectStore(cfg, (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch);
    await expect(down.get('ten_a', 'ten_a/x.pdf')).rejects.toBeInstanceOf(AppError);
  });
});

describe('encryption at rest (TEST-DOC-BACKEND-ENC)', () => {
  const SECRET = 'a'.repeat(64);

  it('TEST-DOC-BACKEND-ENC-01 stores ciphertext and returns the original bytes', async () => {
    const inner = new MemoryStore();
    const store = new EncryptedDocumentObjectStore(inner, SECRET);
    const key = await store.put('ten_a', 'v1.pdf', PDF);
    const stored = inner.files.get(key)!;
    expect(stored.includes(Buffer.from('synthetic test document'))).toBe(false);
    expect(stored.length).toBeGreaterThan(PDF.length);
    expect(await store.get('ten_a', key)).toEqual(PDF);
  });

  it('TEST-DOC-BACKEND-ENC-02 a file written before encryption is still served; a tampered, moved or foreign-key file is not', async () => {
    const inner = new MemoryStore();
    const store = new EncryptedDocumentObjectStore(inner, SECRET);
    inner.files.set('ten_a/legacy.pdf', PDF);
    expect(await store.get('ten_a', 'ten_a/legacy.pdf')).toEqual(PDF);

    const key = await store.put('ten_a', 'v2.pdf', PDF);
    const sealed = Buffer.from(inner.files.get(key)!);
    sealed[sealed.length - 1]! ^= 0xff;
    inner.files.set('ten_a/tampered.pdf', sealed);
    expect(await store.get('ten_a', 'ten_a/tampered.pdf')).toBeNull();
    // The tenant id is bound in: the same bytes read as another tenant do not decrypt.
    expect(await store.get('ten_b', key)).toBeNull();
    expect(await new EncryptedDocumentObjectStore(inner, 'b'.repeat(64)).get('ten_a', key)).toBeNull();
  });
});

describe('ClamAV scanner (TEST-DOC-BACKEND-AV)', () => {
  const servers: net.Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
  });

  /** A clamd stand-in: reads INSTREAM chunks and answers FOUND when the stream holds the EICAR marker. */
  async function fakeClamd(): Promise<{ port: number; streams: Buffer[] }> {
    const streams: Buffer[] = [];
    const server = net.createServer((socket) => {
      let buf = Buffer.alloc(0);
      socket.on('data', (d) => {
        buf = Buffer.concat([buf, d]);
        const cmd = 'zINSTREAM\0';
        if (buf.length < cmd.length) return;
        let at = cmd.length;
        const parts: Buffer[] = [];
        while (buf.length >= at + 4) {
          const size = buf.readUInt32BE(at);
          if (size === 0) {
            const body = Buffer.concat(parts);
            streams.push(body);
            socket.end(
              body.includes(Buffer.from('EICAR-TEST'))
                ? 'stream: Eicar-Test-Signature FOUND\0'
                : 'stream: OK\0',
            );
            return;
          }
          if (buf.length < at + 4 + size) return;
          parts.push(buf.subarray(at + 4, at + 4 + size));
          at += 4 + size;
        }
      });
    });
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    return { port: (server.address() as net.AddressInfo).port, streams };
  }

  it('TEST-DOC-BACKEND-AV-01 a clean file passes; an infected one is marked INFECTED with the threat name', async () => {
    const clamd = await fakeClamd();
    const scanner = new ClamAvFileScanner('127.0.0.1', clamd.port);
    expect(await scanner.scan(PDF, 'v1.pdf', 'application/pdf')).toEqual({
      clean: true,
      scanStatus: 'CLEAN',
    });
    const infected = Buffer.concat([PDF, Buffer.from('EICAR-TEST')]);
    expect(await scanner.scan(infected, 'v2.pdf', 'application/pdf')).toEqual({
      clean: false,
      scanStatus: 'INFECTED',
      detectedThreat: 'Eicar-Test-Signature',
    });
    expect(clamd.streams[0]).toEqual(PDF);
  });

  it('TEST-DOC-BACKEND-AV-02 a file with the wrong signature is refused before clamd; an unreachable clamd is 503', async () => {
    const clamd = await fakeClamd();
    const scanner = new ClamAvFileScanner('127.0.0.1', clamd.port);
    const fake = await scanner.scan(Buffer.from('MZ-not-really-a-pdf-file'), 'v1.pdf', 'application/pdf');
    expect(fake.clean).toBe(false);
    expect(clamd.streams).toHaveLength(0);

    const closed = net.createServer();
    await new Promise<void>((r) => closed.listen(0, '127.0.0.1', r));
    const port = (closed.address() as net.AddressInfo).port;
    await new Promise((r) => closed.close(r));
    await expect(
      new ClamAvFileScanner('127.0.0.1', port).scan(PDF, 'v1.pdf', 'application/pdf'),
    ).rejects.toMatchObject({
      code: 'DEPENDENCY_UNAVAILABLE',
    });
  });
});

describe('document backend configuration (TEST-DOC-BACKEND-CFG)', () => {
  const base = {
    DATABASE_URL: 'postgresql://dsa_api:s3cretvalue@localhost:5432/postgres',
    SUPABASE_URL: 'http://127.0.0.1:54321',
  } as NodeJS.ProcessEnv;
  const problems = (env: Record<string, string>) => {
    try {
      loadConfig({ ...base, ...env });
      return '';
    } catch (e) {
      return (e as Error).message;
    }
  };

  it('TEST-DOC-BACKEND-CFG-01 local is the default; s3 needs the endpoint, bucket and both keys; clamd is host or host:port', () => {
    const cfg = loadConfig(base);
    expect(cfg.DOCUMENT_STORE).toBe('local');
    expect(documentBackendsFromConfig(cfg)).toEqual({});
    const missing = problems({ DOCUMENT_STORE: 's3', DOCUMENT_S3_BUCKET: 'documents' });
    for (const name of [
      'DOCUMENT_S3_ENDPOINT',
      'DOCUMENT_S3_ACCESS_KEY_ID',
      'DOCUMENT_S3_SECRET_ACCESS_KEY',
    ]) {
      expect(missing).toContain(name);
    }
    expect(missing).not.toContain('DOCUMENT_S3_BUCKET');
    expect(problems({ CLAMAV_ADDRESS: 'clamd:3310 && rm' })).toContain('CLAMAV_ADDRESS');
  });

  it('TEST-DOC-BACKEND-CFG-02 a complete s3 and clamd configuration builds both backends, and errors never echo the keys', () => {
    const env = {
      DOCUMENT_STORE: 's3',
      DOCUMENT_S3_ENDPOINT: 'https://store.example.test/storage/v1/s3',
      DOCUMENT_S3_BUCKET: 'documents',
      DOCUMENT_S3_ACCESS_KEY_ID: 'AKIDEXAMPLE',
      DOCUMENT_S3_SECRET_ACCESS_KEY: 'synthetic-secret-key',
      CLAMAV_ADDRESS: 'clamd.internal:3310',
    };
    const built = documentBackendsFromConfig(loadConfig({ ...base, ...env }));
    expect(built.documentStore).toBeInstanceOf(S3DocumentObjectStore);
    expect(built.documentScanner).toBeInstanceOf(ClamAvFileScanner);
    expect(problems({ ...env, DOCUMENT_S3_ENDPOINT: 'not a url' })).not.toContain('synthetic-secret-key');
  });
});
