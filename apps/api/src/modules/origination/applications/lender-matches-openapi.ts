// OpenAPI registration for multi-lender matching (owner: Dipanshu; task P1-04). Swagger group: MOD-APP Loan Applications.
import {
  EmiCalculationRequestSchema,
  EmiCalculationSchema,
  LenderMatchPrefillSchema,
  LenderMatchRunRequestSchema,
  LenderMatchRunSchema,
} from '@dsa/contracts';
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';
import { registerOperation } from '../../../http/openapi-op';

export function registerLenderMatchOpenApi(registry: OpenAPIRegistry): void {
  const tag = 'MOD-APP Loan Applications';
  registerOperation(registry, {
    method: 'get',
    path: '/v1/applications/:id/lender-matches/inputs',
    operationId: 'API-APP-LMR-001',
    summary:
      'The inputs a lender match would use now, prefilled from the application and its recorded figures, with the source of each (lender_match.run)',
    tag,
    response: LenderMatchPrefillSchema,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/applications/:id/lender-matches',
    operationId: 'API-APP-LMR-002',
    summary:
      'Match the application against every ACTIVE lender policy for its product category and store the ranked run; body fields override the prefill (lender_match.run)',
    tag,
    body: LenderMatchRunRequestSchema,
    response: LenderMatchRunSchema,
    status: 201,
    idempotent: true,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/applications/:id/lender-matches/latest',
    operationId: 'API-APP-LMR-003',
    summary:
      'The most recent lender match run with its ranked results; 404 NO_MATCH_RUN before the first run (lender_match.run)',
    tag,
    response: LenderMatchRunSchema,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/emi-calculations',
    operationId: 'API-APP-LMR-004',
    summary:
      'Stateless EMI calculator: EMI rounded up to the paisa, total payable and total interest (lender_match.run or lender_policy.read)',
    tag,
    body: EmiCalculationRequestSchema,
    response: EmiCalculationSchema,
  });
}
