// apps/api/src/modules/integrations/vault-port.ts
// Module 28: Integration Management (MOD-INT) — SUB-INT.01 Adapter Framework
// Open Decision OD-INT-001: Enterprise Secrets Management & Vault Strategy

import { AppError } from '@dsa/contracts';

export interface ResolvedCredentials {
  apiKey?: string;
  apiSecret?: string;
  authToken?: string;
  accountSid?: string;
  certificatePem?: string;
  metadata?: Record<string, string>;
}

export interface IVaultPort {
  resolveSecret(tenantId: string, credentialRef: string): Promise<ResolvedCredentials>;
}

/**
 * Development & Test Vault Port:
 * Securely simulates vault secret resolution in non-production environments.
 * Validates strictly that credentialRef adheres to:
 * vault://tenants/{tenant_id}/{sandbox|production}/{provider}/credentials
 */
export class DevelopmentVaultAdapter implements IVaultPort {
  private inMemorySecrets = new Map<string, ResolvedCredentials>();

  constructor() {
    // Seed standard development mock credentials
    this.inMemorySecrets.set('vault://tenants/ten_demo_01/sandbox/twilio/credentials', {
      accountSid: 'AC_dev_mock_account_sid_12345',
      authToken: 'mock_auth_token_secret_value',
    });
    this.inMemorySecrets.set('vault://tenants/ten_demo_01/sandbox/karza/credentials', {
      apiKey: 'mock_karza_api_key_sand_99999',
    });
  }

  setSecret(ref: string, creds: ResolvedCredentials): void {
    this.inMemorySecrets.set(ref, creds);
  }

  async resolveSecret(tenantId: string, credentialRef: string): Promise<ResolvedCredentials> {
    const match = credentialRef.match(
      /^vault:\/\/tenants\/([a-zA-Z0-9_-]+)\/(sandbox|production)\/([a-zA-Z0-9_-]+)\/credentials$/,
    );
    if (!match) {
      throw AppError.of(
        'MALFORMED_REQUEST',
        `Invalid credential reference format: ${credentialRef}. Must follow vault://tenants/{tenant_id}/{env}/{provider}/credentials`,
      );
    }

    const refTenant = match[1];
    if (refTenant !== tenantId) {
      throw AppError.of(
        'FORBIDDEN',
        `Tenant mismatch: credentialRef belongs to ${refTenant}, but context tenant is ${tenantId}`,
      );
    }

    const found = this.inMemorySecrets.get(credentialRef);
    if (found) {
      return found;
    }

    // Default deterministic development credentials for unseeded references
    const provider = match[3];
    return {
      apiKey: `dev_mock_${provider}_key`,
      authToken: `dev_mock_${provider}_token`,
    };
  }
}
