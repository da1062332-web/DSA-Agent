// apps/api/src/modules/integrations/kyc-port.ts
// Module 28: Integration Management (MOD-INT) — KycCheckPort implementation (P1-06). The verification module runs PAN, GST and bank-account
// (penny drop) checks through this port (API-VER-003). It finds the tenant's active provider connection and calls the adapter through the
// registry, so the production guard (no mock provider, no development vault) applies to every check. It runs in the caller's transaction.
import {
  AppError,
  ERROR_HTTP_STATUS,
  type AdapterResult,
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
  BANK_ACCOUNT: 'VERIFICATION.BANK',
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

/**
 * THE MONEY RULE. The penny drop moves Rs 1, so after a failed call the question is whether the transfer may have been sent. This says
 * yes unless the adapter's answer proves the request was refused before the vendor did anything. It is a list of what is known, so
 * anything new or unexpected is treated as unknown (the safe side: a new key is a deliberate new attempt, a repeat is never silent).
 *
 * Known not sent (the caller throws, nothing is stored, the same key can be retried):
 *   - the adapter refused before it called the vendor (no `data`: its own validation, an unusable endpoint, no key in the vault);
 *   - the vendor's own "source busy" and "source unavailable" answers (status-code 104 and 108);
 *   - HTTP 429, 400, 422, 404, 401 and 403 (rate limit, a request the vendor refused, the wrong endpoint, a refused key).
 * Unknown (stored as INCONCLUSIVE, the key is used up): a timeout or a dropped connection, HTTP 408 and 5xx, an answer that cannot be
 * read, an answer the adapter does not recognise, and any other HTTP status.
 * A refused connection or a failed name lookup is also treated as unknown, because the adapter does not say which of the two it was.
 */
export function bankOutcomeIsUnknown(result: AdapterResult<KycCheckOutput>): boolean {
  if (result.success) return false;
  const data = result.data;
  if (!data) return false;
  if (data.reason === 'SOURCE_BUSY' || data.reason === 'SOURCE_UNAVAILABLE') return false;
  if (data.reason === 'UNRECOGNIZED_RESPONSE') return true;

  const code = result.error?.code;
  if (code === 'RATE_LIMITED' || code === 'VALIDATION_ERROR' || code === 'NOT_FOUND') return false;
  const httpStatus = result.metadata?.httpStatus;
  if (code === 'INTERNAL_ERROR' && (httpStatus === 401 || httpStatus === 403)) return false;
  return true;
}

const UNKNOWN_BANK_OUTCOME_TEXT =
  'Bank account check inconclusive: the Rs 1 transfer may or may not have been sent. Confirm with the provider (the case id is in the evidence reference) before starting a new check.';

/** What a penny drop of unknown outcome is stored as: INCONCLUSIVE, with the masked account only. */
function unknownBankOutcome(provider: string, data: KycCheckOutput): KycCheckResult {
  return {
    provider,
    outcome: 'FAILED',
    verificationResult: 'INCONCLUSIVE',
    matchScore: null,
    identifierMasked: data.identifierMasked,
    referenceId: data.referenceId,
    reason: 'OUTCOME_UNKNOWN',
    minimalResult: {
      statusDescription: UNKNOWN_BANK_OUTCOME_TEXT,
      maskedIdentifier: data.identifierMasked,
      discrepancies: ['OUTCOME_UNKNOWN'],
      ...(data.referenceId ? { providerReference: data.referenceId } : {}),
    },
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

      const name = request.name === undefined ? {} : { name: request.name };
      const input: KycInput =
        request.check === 'BANK_ACCOUNT'
          ? { accountNumber: request.accountNumber, ifsc: request.ifsc, ...name }
          : { idNumber: request.idNumber, ...name };
      // The vendor call: the full identifier leaves here, and only here. The registry masks it in its call log.
      const result = await registry.executeOperation<KycInput, KycCheckOutput>(
        connection,
        capability,
        input,
        {
          correlationId: request.caseId,
        },
      );
      if (!result.success || !result.data) {
        if (request.check === 'BANK_ACCOUNT' && result.data && bankOutcomeIsUnknown(result)) {
          return unknownBankOutcome(connection.provider, result.data);
        }
        throw adapterFailure(result.error);
      }
      return toResult(connection.provider, result.data);
    },
  };
}
