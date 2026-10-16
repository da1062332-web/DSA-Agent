// apps/api/src/modules/security/kms.ts — Module 39: Security (MOD-SEC)
// KMS & Envelope Encryption Port (TASK-421 Implementation)
import * as crypto from 'crypto';

export interface EncryptedEnvelope {
  /** Base64-encoded encrypted data key (wrapped by KMS root KEK) */
  encryptedDataKey: string;
  /** Base64-encoded ciphertext */
  ciphertext: string;
  /** Hex-encoded 12-byte initialization vector */
  iv: string;
  /** Hex-encoded 16-byte GCM authentication tag */
  tag: string;
  /** Key version identifier used for key rotation tracking */
  keyVersion: string;
}

export interface KmsPort {
  /**
   * Generates a unique 256-bit Data Encryption Key (DEK) wrapped by the tenant's KMS Key Encryption Key (KEK).
   */
  generateDataKey(tenantId: string): Promise<{
    plaintextKey: Buffer;
    encryptedDataKey: Buffer;
    keyVersion: string;
  }>;

  /**
   * Unwraps the encrypted Data Encryption Key using the tenant's KMS Key Encryption Key.
   */
  decryptDataKey(tenantId: string, encryptedDataKey: Buffer, keyVersion: string): Promise<Buffer>;
}

/**
 * Standard Envelope Encryption Service using AES-256-GCM.
 * Compatible with AWS KMS, Google Cloud KMS, and HashiCorp Vault.
 */
export class EnvelopeEncryptionService {
  constructor(private readonly kms: KmsPort) {}

  /**
   * Encrypts plaintext using a per-operation or per-tenant Data Encryption Key (DEK).
   */
  async encrypt(tenantId: string, plaintext: string): Promise<EncryptedEnvelope> {
    const { plaintextKey, encryptedDataKey, keyVersion } = await this.kms.generateDataKey(tenantId);

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', plaintextKey, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    // Zero out sensitive plaintext key in memory
    plaintextKey.fill(0);

    return {
      encryptedDataKey: encryptedDataKey.toString('base64'),
      ciphertext: encrypted.toString('base64'),
      iv: iv.toString('hex'),
      tag: tag.toString('hex'),
      keyVersion,
    };
  }

  /**
   * Decrypts ciphertext using envelope unwrapping and verifies authentication tag integrity.
   */
  async decrypt(tenantId: string, envelope: EncryptedEnvelope): Promise<string> {
    const encryptedDataKey = Buffer.from(envelope.encryptedDataKey, 'base64');
    const plaintextKey = await this.kms.decryptDataKey(tenantId, encryptedDataKey, envelope.keyVersion);

    try {
      const iv = Buffer.from(envelope.iv, 'hex');
      const tag = Buffer.from(envelope.tag, 'hex');
      const ciphertext = Buffer.from(envelope.ciphertext, 'base64');

      const decipher = crypto.createDecipheriv('aes-256-gcm', plaintextKey, iv);
      decipher.setAuthTag(tag);
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return decrypted.toString('utf8');
    } finally {
      // Zero out sensitive plaintext key in memory
      plaintextKey.fill(0);
    }
  }
}

/**
 * Master Key Encryption Key (KEK) KMS Port implementation (TASK-421).
 * Uses a 256-bit Master Key (from Cloud KMS / HSM / Vault) and HKDF to derive tenant-isolated KEKs.
 * Securely wraps and unwraps per-record Data Encryption Keys (DEKs) using AES-256-GCM.
 */
export class MasterKeyKmsPort implements KmsPort {
  private readonly masterKey: Buffer;
  private readonly keyVersion: string;

  constructor(opts: { masterKey: Buffer | string; keyVersion?: string }) {
    if (typeof opts.masterKey === 'string') {
      // Decode hex or base64 or sha256 hash if raw string
      if (/^[0-9a-fA-F]{64}$/.test(opts.masterKey)) {
        this.masterKey = Buffer.from(opts.masterKey, 'hex');
      } else {
        this.masterKey = crypto.createHash('sha256').update(opts.masterKey).digest();
      }
    } else {
      this.masterKey = opts.masterKey;
    }

    if (this.masterKey.length !== 32) {
      throw new Error(`Master KEK must be exactly 256 bits (32 bytes), received ${this.masterKey.length} bytes`);
    }

    this.keyVersion = opts.keyVersion ?? 'kek-v1';
  }

  private deriveTenantKek(tenantId: string): Buffer {
    return Buffer.from(
      crypto.hkdfSync(
        'sha256',
        this.masterKey,
        Buffer.from(tenantId, 'utf8'),
        Buffer.from('dsa-crm-kms-kek-v1', 'utf8'),
        32,
      ),
    );
  }

  async generateDataKey(tenantId: string): Promise<{
    plaintextKey: Buffer;
    encryptedDataKey: Buffer;
    keyVersion: string;
  }> {
    const plaintextKey = crypto.randomBytes(32);
    const tenantKek = this.deriveTenantKek(tenantId);

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', tenantKek, iv);
    const wrappedDek = Buffer.concat([cipher.update(plaintextKey), cipher.final()]);
    const tag = cipher.getAuthTag();

    // Packed wrapped key format: 12-byte IV + 16-byte GCM Tag + 32-byte Wrapped DEK (60 bytes)
    const encryptedDataKey = Buffer.concat([iv, tag, wrappedDek]);

    tenantKek.fill(0);

    return {
      plaintextKey,
      encryptedDataKey,
      keyVersion: this.keyVersion,
    };
  }

  async decryptDataKey(tenantId: string, encryptedDataKey: Buffer, keyVersion: string): Promise<Buffer> {
    if (encryptedDataKey.length < 28) {
      throw new Error('Invalid wrapped data key length');
    }

    const tenantKek = this.deriveTenantKek(tenantId);
    try {
      const iv = encryptedDataKey.subarray(0, 12);
      const tag = encryptedDataKey.subarray(12, 28);
      const wrappedDek = encryptedDataKey.subarray(28);

      const decipher = crypto.createDecipheriv('aes-256-gcm', tenantKek, iv);
      decipher.setAuthTag(tag);
      const plaintextKey = Buffer.concat([decipher.update(wrappedDek), decipher.final()]);

      return plaintextKey;
    } finally {
      tenantKek.fill(0);
    }
  }
}

/**
 * Deferred KMS Port representing TASK-421 unprovisioned status.
 * Fails closed if production envelope encryption is requested prior to infrastructure provisioning.
 */
export class DeferredKmsPort implements KmsPort {
  async generateDataKey(_tenantId: string): Promise<never> {
    throw new Error(
      'KMS_NOT_PROVISIONED (TASK-421): Production Cloud KMS / HSM envelope encryption is deferred pending platform provisioning.',
    );
  }

  async decryptDataKey(_tenantId: string, _encryptedDataKey: Buffer, _keyVersion: string): Promise<never> {
    throw new Error(
      'KMS_NOT_PROVISIONED (TASK-421): Production Cloud KMS / HSM envelope encryption is deferred pending platform provisioning.',
    );
  }
}

/**
 * Auto-wires the active KmsPort from environment / Cloud KMS configuration (TASK-421).
 */
export function createKmsPortFromEnv(env: Record<string, string | undefined> = process.env): KmsPort {
  if (env.KMS_MASTER_KEY) {
    return new MasterKeyKmsPort({
      masterKey: env.KMS_MASTER_KEY,
      keyVersion: env.KMS_KEY_VERSION ?? 'kek-v1',
    });
  }

  // Fails closed by default per security architecture policy
  return new DeferredKmsPort();
}
