// apps/api/src/modules/integrations/kyc-port.ts
// Module 28: Integration Management (MOD-INT) — KycCheckPort implementation (P1-06). The verification module runs PAN and GST checks
// through this port (API-VER-003). It finds the tenant's active provider connection and calls the adapter through the registry, so the
// production guard (no mock provider, no development vault) applies to every check. It runs in the caller's transaction.
import {
  AppError,
  ERROR_HTTP_STATUS,
  type ErrorCode,
  type ErrorDetail,
  type IntegrationEnvironment,
  type KycCheckPort,
  type KycCheckResult,
  type KycRunnableCheck,
} from '@dsa/contracts';
import { sql } from 'kysely';
import type { IntegrationRegistry } from './integration-registry';
import { toConnection } from './integration-service';
import type { KycCheckOutput, KycInput } from './providers/karza-adapter';

const CAPABILITY: Record<KycRunnableCheck, string> = {
  PAN: 'VERIFICATION.PAN',
  GST: 'VERIFICATION.GST',
};

export interface KycCheckPortOptions {
  registry: IntegrationRegistry;
}

/** An adapter that could not decide becomes the AppError with the adapter's own code, which is always one of the Contracts §6 codes. */
function adapterFailure(error: { code: string; message: string; details?: unknown } | undefined): AppError {
  const code: ErrorCode =
    error && error.code in ERROR_HTTP_STATUS ? (error.code as ErrorCode) : 'INTERNAL_ERROR';
  const details = Array.isArray(error?.details) ? (error.details as ErrorDetail[]) : [];
  return AppError.of(code, error?.message ?? 'The verification provider did not return a result.', details);
}

function toResult(provider: string, output: KycCheckOutput): KycCheckResult {
  if (output.outcome === 'ERROR' || output.verificationResult === null) {
    throw AppError.of('INTERNAL_ERROR', 'The verification provider returned no decision.');
  }
  return {
    provider,
    outcome: output.outcome,
    verificationResult: output.verificationResult,
    matchScore: output.matchScore,
    identifierMasked: output.identifierMasked,
    referenceId: output.referenceId,
    reason: output.reason,
    minimalResult: output.minimalResult,
  };
}

export function createKycCheckPort(options: KycCheckPortOptions): KycCheckPort {
  const { registry } = options;
  return {
    async run(tx, ctx, request) {
      const capability = CAPABILITY[request.check];
      // Production runs production connections only; every other environment uses the sandbox ones.
      const environment: IntegrationEnvironment = registry.isProductionRuntime() ? 'PRODUCTION' : 'SANDBOX';

      // The person who runs a check is not an integration admin, so this reads the connection itself and needs no integration.read.
      // The tenant is filtered here as well as by row-level security. If several providers are active for the capability, the most
      // recently changed connection is used.
      const found = await sql<Record<string, unknown>>`
        SELECT * FROM app.integration_connection
         WHERE tenant_id = ${ctx.principal.tenantId} AND capability = ${capability}
           AND environment = ${environment} AND status = 'ACTIVE'
         ORDER BY updated_at DESC, id DESC
         LIMIT 1`.execute(tx);
      const row = found.rows[0];
      if (!row) {
        throw AppError.of(
          'VALIDATION_ERROR',
          `No active ${request.check} verification provider is configured for this tenant.`,
          [{ field: 'check', issue: 'NO_ACTIVE_CONNECTION' }],
        );
      }
      const connection = toConnection(row);

      const input: KycInput =
        request.name === undefined
          ? { idNumber: request.idNumber }
          : { idNumber: request.idNumber, name: request.name };
      // The vendor call: the full identifier leaves here, and only here. The registry masks it in its call log.
      const result = await registry.executeOperation<KycInput, KycCheckOutput>(
        connection,
        capability,
        input,
        {
          correlationId: request.caseId,
        },
      );
      if (!result.success || !result.data) throw adapterFailure(result.error);
      return toResult(connection.provider, result.data);
    },
  };
}
