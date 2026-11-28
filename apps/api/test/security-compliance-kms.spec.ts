// apps/api/test/security-compliance-kms.spec.ts — Tests for the envelope encryption (TASK-421). SIEM and CERT-In tests were removed with those features.
import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DeferredKmsPort,
  EnvelopeEncryptionService,
  MasterKeyKmsPort,
  createKmsPortFromEnv,
} from '../src/modules/security/kms';

describe('Module 39 — Security Enhancements (TASK-421)', () => {
  const tenantA = 'ten_01J00000000000000000000000';
  const tenantB = 'ten_01J99999999999999999999999';

  // ==========================================================================
  // TASK-421: KMS & Master Key Envelope Encryption
  // ==========================================================================
  describe('TASK-421: Master Key KEK & Envelope Encryption', () => {
    const rawMasterKey = crypto.randomBytes(32).toString('hex');

    it('MasterKeyKmsPort generates valid 256-bit DEK and unwrap matches', async () => {
      const kms = new MasterKeyKmsPort({ masterKey: rawMasterKey });
      const { plaintextKey, encryptedDataKey, keyVersion } = await kms.generateDataKey(tenantA);

      expect(plaintextKey.length).toBe(32);
      expect(encryptedDataKey.length).toBeGreaterThanOrEqual(60);
      expect(keyVersion).toBe('kek-v1');

      const unwrappedKey = await kms.decryptDataKey(tenantA, encryptedDataKey, keyVersion);
      expect(unwrappedKey).toEqual(plaintextKey);
    });

    it('MasterKeyKmsPort enforces tenant isolation in key unwrapping', async () => {
      const kms = new MasterKeyKmsPort({ masterKey: rawMasterKey });
      const { encryptedDataKey, keyVersion } = await kms.generateDataKey(tenantA);

      // Attempting to unwrap tenantA's key in tenantB context must fail
      await expect(kms.decryptDataKey(tenantB, encryptedDataKey, keyVersion)).rejects.toThrow(
        /Unsupported state or unable to authenticate data/,
      );
    });

    it('EnvelopeEncryptionService completes end-to-end encrypt/decrypt with MasterKeyKmsPort', async () => {
      const kms = new MasterKeyKmsPort({ masterKey: rawMasterKey });
      const envelopeService = new EnvelopeEncryptionService(kms);
      const secretPii = 'CUSTOMER_PAN:ABCDE1234F_AADHAAR:123456789012';

      const envelope = await envelopeService.encrypt(tenantA, secretPii);
      expect(envelope.ciphertext).not.toBe(secretPii);

      const decrypted = await envelopeService.decrypt(tenantA, envelope);
      expect(decrypted).toBe(secretPii);
    });

    it('createKmsPortFromEnv selects MasterKeyKmsPort when env var is present and DeferredKmsPort when absent', async () => {
      const activeKms = createKmsPortFromEnv({ KMS_MASTER_KEY: rawMasterKey });
      expect(activeKms).toBeInstanceOf(MasterKeyKmsPort);

      const deferredKms = createKmsPortFromEnv({});
      expect(deferredKms).toBeInstanceOf(DeferredKmsPort);
      await expect(deferredKms.generateDataKey(tenantA)).rejects.toThrow(/KMS_NOT_PROVISIONED/);
    });
  });

});
