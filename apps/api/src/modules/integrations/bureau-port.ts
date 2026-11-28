// apps/api/src/modules/integrations/bureau-port.ts
// Module 28: Integration Management (MOD-INT) — BureauPullPort implementation (P1-05). The verification module pulls credit-bureau summaries
// through this port (POST /v1/customers/{id}/credit-reports). It finds the tenant's active BUREAU.SOFT_PULL connection and calls the adapter
// through the registry, so the production guard (no mock provider, no development vault) applies to every pull. It runs in the caller's
// transaction. A pull is attempted once and every failure is thrown: nothing is recorded and no score is ever invented.
import {
  AppError,
  ERROR_HTTP_STATUS,
  type BureauPullPort,
  type BureauPullResult,
  type ErrorCode,
  type ErrorDetail,
  type IntegrationEnvironment,
} from '@dsa/contracts';
import { sql } from 'kysely';
import type { IntegrationRegistry } from './integration-registry';
import { toConnection } from './integration-service';
import type { BureauInput, BureauPullOutput } from './providers/bureau-adapter';

const CAPABILITY = 'BUREAU.SOFT_PULL';

export interface BureauPullPortOptions {
  registry: IntegrationRegistry;
}

/** An adapter that could not give a report becomes the AppError with the adapter's own code, which is always one of the Contracts §6 codes. */
function adapterFailure(error: { code: string; message: string; details?: unknown } | undefined): AppError {
  const code: ErrorCode =
    error && error.code in ERROR_HTTP_STATUS ? (error.code as ErrorCode) : 'INTERNAL_ERROR';
  const details = Array.isArray(error?.details) ? (error.details as ErrorDetail[]) : [];
  return AppError.of(code, error?.message ?? 'The credit bureau did not return a report.', details);
}

export function createBureauPullPort(options: BureauPullPortOptions): BureauPullPort {
  const { registry } = options;
  return {
    async pull(tx, ctx, request) {
      // Production runs production connections only; every other environment uses the sandbox ones.
      const environment: IntegrationEnvironment = registry.isProductionRuntime() ? 'PRODUCTION' : 'SANDBOX';

      // The person who pulls a report is not an integration admin, so this reads the connection itself and needs no integration.read. The
      // tenant is filtered here as well as by row-level security. If several providers are active, the most recently changed one is used.
      const found = await sql<Record<string, unknown>>`
        SELECT * FROM app.integration_connection
         WHERE tenant_id = ${ctx.principal.tenantId} AND capability = ${CAPABILITY}
           AND environment = ${environment} AND status = 'ACTIVE'
         ORDER BY updated_at DESC, id DESC
         LIMIT 1`.execute(tx);
      const row = found.rows[0];
      if (!row) {
        throw AppError.of(
          'VALIDATION_ERROR',
          'No active credit bureau provider is configured for this tenant.',
          [{ field: 'bureau', issue: 'NO_ACTIVE_CONNECTION' }],
        );
      }
      const connection = toConnection(row);

      const input: BureauInput = {
        bureau: request.bureau,
        name: request.name,
        pan: request.pan,
        dateOfBirth: request.dateOfBirth,
      };
      // The vendor call: the PAN, date of birth and name leave here, and only here. The registry masks them in its call log.
      const result = await registry.executeOperation<BureauInput, BureauPullOutput>(
        connection,
        CAPABILITY,
        input,
        {
          correlationId: request.caseId,
        },
      );
      if (!result.success || !result.data) throw adapterFailure(result.error);

      const output = result.data;
      // No report date from the bureau: the day of the request, in UTC. The clock is the request's, not the machine's.
      const reportDate = output.reportDate ?? ctx.now.toISOString().slice(0, 10);
      const report: BureauPullResult = {
        provider: connection.provider,
        outcome: output.outcome,
        reportDate,
        summary: output.summary,
        vendorRef: output.vendorRef,
        unitCost: output.unitCost,
      };
      return report;
    },
  };
}
