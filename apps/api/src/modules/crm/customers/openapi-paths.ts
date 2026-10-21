// OpenAPI paths for crm/customers (Contracts §1), registered by src/openapi.ts. Request schemas are the ones the routes
// validate with. Every /v1 operation here needs an isolation case naming its operationId (tests/isolation/cases).
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';
import { registerOperation } from '../../../http/openapi-op';
import { ContactPointCreate, CustomerMerge } from './customer-extras';

const tag = 'MOD-CUST Customers';

export function registerPaths(registry: OpenAPIRegistry): void {
  registerOperation(registry, {
    method: 'post',
    path: '/v1/customers/:id/reveal',
    operationId: 'CUST-POST-CUSTOMERS-BY-ID-REVEAL',
    summary: 'POST /v1/customers/:id/reveal',
    tag,
  });
  registerOperation(registry, {
    method: 'put',
    path: '/v1/customers/:id/preferences',
    operationId: 'API-CUST-009',
    summary: 'PUT /v1/customers/:id/preferences',
    tag,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/customers/:id/contact-points',
    operationId: 'API-CUST-007',
    summary:
      'Add a mobile or email to a customer, optionally as the primary one; returned masked (customer.update)',
    tag,
    body: ContactPointCreate,
    status: 201,
    idempotent: true,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/customers/:id/merge',
    operationId: 'API-CUST-008',
    summary:
      'Merge this customer into intoCustomerId: it becomes MERGED, contact points are copied, leads and live applications re-pointed (lead.merge)',
    tag,
    body: CustomerMerge,
    idempotent: true,
  });
}
