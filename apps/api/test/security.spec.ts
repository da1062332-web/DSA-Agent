// apps/api/test/security.spec.ts — Module 39 (MOD-SEC): field-level encryption and retention. Incident and event tests were removed with the features.
import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { EnvelopeEncryptionService, DeferredKmsPort, type KmsPort } from '../src/modules/security/kms';
import { validateRetentionPurge, assertRetentionCompliance, RETENTION_RULES } from '../src/modules/security/retention';

describe('Module 39: Security (MOD-SEC) encryption and retention', () => {
  const tenantA = 'ten_01J00000000000000000000000';
  const tenantB = 'ten_01J99999999999999999999999';
  // ==========================================================================
  describe('SUB-SEC.04 — Field-Level Encryption & Cryptographic Integrity', () => {
    const ENCRYPTION_KEY = crypto.createHash('sha256').update('dev_dsa_encryption_key_32_bytes!').digest();

    function encryptAesGcm(plaintext: string): Buffer {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
      const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      return Buffer.concat([iv, tag, encrypted]);
    }

    function decryptAesGcm(data: Buffer): string {
      const iv = data.subarray(0, 12);
      const tag = data.subarray(12, 28);
      const ciphertext = data.subarray(28);
      const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
      decipher.setAuthTag(tag);
      return decipher.update(ciphertext) + decipher.final('utf8');
    }

    it('successfully encrypts and decrypts with authenticated AES-256-GCM', () => {
      const pan = 'ABCDE1234F';
      const ciphertext = encryptAesGcm(pan);

      expect(Buffer.isBuffer(ciphertext)).toBe(true);
      expect(ciphertext.toString('utf8')).not.toBe(pan);

      const decrypted = decryptAesGcm(ciphertext);
      expect(decrypted).toBe(pan);
    });

    it('detects ciphertext tampering and fails authenticated decryption', () => {
      const pan = 'ABCDE1234F';
      const ciphertext = encryptAesGcm(pan);

      // Tamper with the ciphertext byte (past IV + tag: byte index 30)
      ciphertext[30] = (ciphertext[30] ?? 0) ^ 0xff;

      expect(() => decryptAesGcm(ciphertext)).toThrow(/Unsupported state or unable to authenticate data/);
    });

    it('detects authentication tag tampering and refuses decryption', () => {
      const pan = 'ABCDE1234F';
      const ciphertext = encryptAesGcm(pan);

      // Tamper with authentication tag (byte index 15)
      ciphertext[15] = (ciphertext[15] ?? 0) ^ 0xff;

      expect(() => decryptAesGcm(ciphertext)).toThrow(/Unsupported state or unable to authenticate data/);
    });

    it('produces deterministic tenant-scoped HMAC-SHA256 blind indexes', () => {
      const pan = 'ABCDE1234F';
      const hmacSecret = 'test_hmac_secret_key';

      const hashTenantA = crypto.createHmac('sha256', `${hmacSecret}:${tenantA}`).update(pan).digest('hex');

      const hashTenantB = crypto.createHmac('sha256', `${hmacSecret}:${tenantB}`).update(pan).digest('hex');

      // Matching within same tenant is deterministic
      const hashTenantA2 = crypto.createHmac('sha256', `${hmacSecret}:${tenantA}`).update(pan).digest('hex');

      expect(hashTenantA).toBe(hashTenantA2);
      // Blind index across different tenants must NOT match
      expect(hashTenantA).not.toBe(hashTenantB);
    });

    it('masks sensitive PAN display format safely', () => {
      function maskPan(pan: string): string {
        const clean = pan.trim().toUpperCase();
        if (clean.length !== 10) return clean;
        return `${clean.slice(0, 5)}****${clean.slice(9)}`;
      }

      expect(maskPan('ABCDE1234F')).toBe('ABCDE****F');
    });

    it('EnvelopeEncryptionService performs authenticated encryption and unwrapping with KmsPort', async () => {
      // Mock KMS key provider (TASK-421 mock test)
      const mockDek = crypto.randomBytes(32);
      const mockKms: KmsPort = {
        async generateDataKey(_tenantId: string) {
          return {
            plaintextKey: Buffer.from(mockDek),
            encryptedDataKey: Buffer.from('mock_encrypted_dek_blob'),
            keyVersion: 'v1',
          };
        },
        async decryptDataKey(_tenantId: string, _encryptedDataKey: Buffer, _keyVersion: string) {
          return Buffer.from(mockDek);
        },
      };

      const envelopeService = new EnvelopeEncryptionService(mockKms);
      const plaintext = 'SENSITIVE_CUSTOMER_PII_001';

      const envelope = await envelopeService.encrypt(tenantA, plaintext);
      expect(envelope.keyVersion).toBe('v1');
      expect(envelope.ciphertext).not.toBe(plaintext);

      const decrypted = await envelopeService.decrypt(tenantA, envelope);
      expect(decrypted).toBe(plaintext);

      // Tampering with ciphertext in envelope fails authentication
      const tamperedCipher = Buffer.from(envelope.ciphertext, 'base64');
      tamperedCipher[0] = (tamperedCipher[0] ?? 0) ^ 0xff;
      const tamperedEnvelope = { ...envelope, ciphertext: tamperedCipher.toString('base64') };

      await expect(envelopeService.decrypt(tenantA, tamperedEnvelope)).rejects.toThrow(
        /Unsupported state or unable to authenticate data/,
      );
    });

    it('DeferredKmsPort fails closed when Cloud KMS is unprovisioned (TASK-421)', async () => {
      const deferredKms = new DeferredKmsPort();
      await expect(deferredKms.generateDataKey(tenantA)).rejects.toThrow(/KMS_NOT_PROVISIONED \(TASK-421\)/);
    });
  });

  // ==========================================================================
  // SUB-SEC.01: SIEM Integration & Alerting (TASK-431)
  describe('PHASE 6 — Retention & CERT-In Compliance', () => {
    it('enforces minimum 180-day retention floor and rejects early purge cutoffs', () => {
      const now = new Date('2026-10-15T00:00:00.000Z');

      // Cutoff only 90 days ago (violates 180-day rule)
      const recentCutoff = new Date('2026-07-17T00:00:00.000Z');
      const check = validateRetentionPurge(recentCutoff, now, RETENTION_RULES.CERT_IN_MINIMUM_DAYS);
      expect(check.allowed).toBe(false);
      expect(check.reason).toMatch(/violates mandatory CERT-In 180-day retention policy/);

      expect(() => assertRetentionCompliance(recentCutoff, now)).toThrow(/violates mandatory CERT-In/);
    });

    it('permits purge cutoffs that exceed the mandatory 180-day floor', () => {
      const now = new Date('2026-10-15T00:00:00.000Z');

      // Cutoff 200 days ago (exceeds 180-day requirement)
      const validCutoff = new Date('2026-03-01T00:00:00.000Z');
      const check = validateRetentionPurge(validCutoff, now, RETENTION_RULES.CERT_IN_MINIMUM_DAYS);
      expect(check.allowed).toBe(true);

      expect(() => assertRetentionCompliance(validCutoff, now)).not.toThrow();
    });
  });
});
