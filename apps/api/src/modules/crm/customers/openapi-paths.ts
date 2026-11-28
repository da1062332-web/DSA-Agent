// OpenAPI paths for crm/customers (Contracts §1), registered by src/openapi.ts. Request schemas are the ones the routes
// validate with. Every /v1 operation here needs an isolation case naming its operationId (tests/isolation/cases).
import {
  CustomerAddress,
  CustomerAddressCreate,
  CustomerAddressUpdate,
  CustomerIdentity,
  CustomerIdentityUpsert,
  CustomerProfile,
  CustomerProfileUpsert,
  CustomerRevealRequest,
  CustomerRevealResponse,
} from '@dsa/contracts';
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';
import { registerOperation } from '../../../http/openapi-op';
import { ContactPointCreate, CustomerMerge } from './customer-extras';
import { CustomerSearchSchema } from './types';

const tag = 'MOD-CUST Customers';

export function registerPaths(registry: OpenAPIRegistry): void {
  registerOperation(registry, {
    method: 'post',
    path: '/v1/customers/search',
    operationId: 'CUST-POST-CUSTOMERS-SEARCH',
    summary:
      'Find active customers by a 10-digit mobile (exact, keyed hash) or part of the name, inside the caller scope; masked results, no-store. The term is in the body so it never reaches a URL (customer.read)',
    tag,
    body: CustomerSearchSchema,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/customers/:id/reveal',
    operationId: 'CUST-POST-CUSTOMERS-BY-ID-REVEAL',
    summary:
      'API-CUST-006 reveal one masked field (PAN or date of birth) with a reason and a fresh step-up; audited, no-store (customer.reveal_sensitive; P1-02)',
    tag,
    body: CustomerRevealRequest,
    response: CustomerRevealResponse,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/customers/:id/profile',
    operationId: 'CUST-GET-CUSTOMERS-BY-ID-PROFILE',
    summary: 'Customer profile: constitution, employment, income and obligations (customer.read; P1-02)',
    tag,
    response: CustomerProfile,
  });
  registerOperation(registry, {
    method: 'put',
    path: '/v1/customers/:id/profile',
    operationId: 'CUST-PUT-CUSTOMERS-BY-ID-PROFILE',
    summary:
      'Save the customer profile; a field left out keeps its value, null clears it (customer.update; P1-02)',
    tag,
    body: CustomerProfileUpsert,
    response: CustomerProfile,
    ifMatch: true,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/customers/:id/identity',
    operationId: 'CUST-GET-CUSTOMERS-BY-ID-IDENTITY',
    summary: 'Masked PAN, birth year and whether a date of birth is stored (customer.read; P1-02)',
    tag,
    response: CustomerIdentity,
  });
  registerOperation(registry, {
    method: 'put',
    path: '/v1/customers/:id/identity',
    operationId: 'CUST-PUT-CUSTOMERS-BY-ID-IDENTITY',
    summary:
      'Store PAN and date of birth encrypted; returned masked; a PAN another customer holds is flagged, never merged (customer.update; P1-02)',
    tag,
    body: CustomerIdentityUpsert,
    response: CustomerIdentity,
    ifMatch: true,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/customers/:id/addresses',
    operationId: 'CUST-GET-CUSTOMERS-BY-ID-ADDRESSES',
    summary: 'Live addresses of the customer: CURRENT, PERMANENT, OFFICE (customer.read; P1-02)',
    tag,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/customers/:id/addresses',
    operationId: 'CUST-POST-CUSTOMERS-BY-ID-ADDRESSES',
    summary: 'Add an address; one live address per type (customer.update; P1-02)',
    tag,
    body: CustomerAddressCreate,
    response: CustomerAddress,
    status: 201,
    idempotent: true,
  });
  registerOperation(registry, {
    method: 'patch',
    path: '/v1/customers/:id/addresses/:addressId',
    operationId: 'CUST-PATCH-CUSTOMERS-BY-ID-ADDRESSES-BY-ADDRESSID',
    summary: 'Edit an address (customer.update; P1-02)',
    tag,
    body: CustomerAddressUpdate,
    response: CustomerAddress,
    ifMatch: true,
  });
  registerOperation(registry, {
    method: 'delete',
    path: '/v1/customers/:id/addresses/:addressId',
    operationId: 'CUST-DELETE-CUSTOMERS-BY-ID-ADDRESSES-BY-ADDRESSID',
    summary: 'Remove an address (soft delete; customer.update; P1-02)',
    tag,
    status: 204,
    ifMatch: true,
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
