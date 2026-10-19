// OpenAPI paths for invoices (Contracts §1), registered by src/openapi.ts. Request schemas are the ones the routes
// validate with. Every /v1 operation here needs an isolation case naming its operationId (tests/isolation/cases).
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';
import {
  CreateInvoiceInputSchema,
  InvoiceListQuerySchema,
  StatementQuerySchema,
  UpdateInvoiceStatusInputSchema,
} from '@dsa/contracts';
import { registerOperation } from '../../http/openapi-op';

const tag = 'MOD-INV Invoices and Statements';

export function registerPaths(registry: OpenAPIRegistry): void {
  registerOperation(registry, {
    method: 'post',
    path: '/v1/invoices',
    operationId: 'API-INV-001',
    summary: 'POST /v1/invoices',
    tag,
    body: CreateInvoiceInputSchema,
    status: 201,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/invoices',
    operationId: 'API-INV-002',
    summary: 'GET /v1/invoices',
    tag,
    query: InvoiceListQuerySchema,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/invoices/:id',
    operationId: 'INV-GET-INVOICES-BY-ID',
    summary: 'GET /v1/invoices/:id',
    tag,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/invoices/:id/status',
    operationId: 'API-INV-003',
    summary: 'POST /v1/invoices/:id/status',
    tag,
    body: UpdateInvoiceStatusInputSchema,
    ifMatch: true,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/connectors/:id/invoice-statements',
    operationId: 'INV-GET-CONNECTORS-BY-ID-INVOICE-STATEMENTS',
    summary: 'GET /v1/connectors/:id/invoice-statements',
    tag,
    query: StatementQuerySchema,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/portal/connectors/:id/statements',
    operationId: 'API-CPT-004',
    summary: 'GET /v1/portal/connectors/:id/statements',
    tag,
    query: StatementQuerySchema,
  });
}
