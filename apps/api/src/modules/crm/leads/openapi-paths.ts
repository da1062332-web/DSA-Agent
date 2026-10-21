// OpenAPI paths for crm/leads (Contracts §1), registered by src/openapi.ts. Request schemas are the ones the routes
// validate with. Every /v1 operation here needs an isolation case naming its operationId (tests/isolation/cases).
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';
import { registerOperation } from '../../../http/openapi-op';
import {
  ApplyLinkCreate,
  BulkLeadAssignment,
  DuplicateResolution,
  DuplicateReviewQuery,
  LeadReroute,
  LeadRestore,
  PublicApplySubmission,
} from './lead-extras';

const tag = 'MOD-LEAD Leads';

export function registerPaths(registry: OpenAPIRegistry): void {
  registerOperation(registry, {
    method: 'post',
    path: '/v1/leads/:id/conversions',
    operationId: 'LEAD-POST-LEADS-BY-ID-CONVERSIONS',
    summary: 'POST /v1/leads/:id/conversions',
    tag,
    idempotent: true,
    ifMatch: true,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/apply-links',
    operationId: 'API-LEAD-010',
    summary: 'Create an Apply Link for public enquiries in a branch (lead.create). The token is shown once',
    tag,
    body: ApplyLinkCreate,
    status: 201,
    idempotent: true,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/public/v1/apply/:token',
    operationId: 'API-LEAD-011',
    summary:
      'Public enquiry through an Apply Link: creates a lead with consent in the link branch (rate limited; honeypot)',
    tag,
    body: PublicApplySubmission,
    status: 201,
    public: true,
  });
  registerOperation(registry, {
    method: 'get',
    path: '/v1/duplicate-reviews',
    operationId: 'API-LEAD-008',
    summary: 'Duplicate review queue (lead.merge; cursor)',
    tag,
    query: DuplicateReviewQuery,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/duplicate-reviews/:id/resolution',
    operationId: 'API-LEAD-009',
    summary: 'Merge (the other lead becomes MERGED) or dismiss a duplicate pair, with a reason (lead.merge)',
    tag,
    body: DuplicateResolution,
    idempotent: true,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/leads/:id/reroute',
    operationId: 'API-LEAD-012',
    summary: 'Re-run the routing decision (DK-lead.assignment) for an open lead (lead.assign)',
    tag,
    body: LeadReroute,
    idempotent: true,
    ifMatch: true,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/leads/bulk-assignments',
    operationId: 'API-LEAD-013',
    summary: 'Assign up to 200 leads to one user or queue, all or nothing (lead.assign)',
    tag,
    body: BulkLeadAssignment,
    idempotent: true,
  });
  registerOperation(registry, {
    method: 'post',
    path: '/v1/leads/:id/restore',
    operationId: 'API-LEAD-014',
    summary: 'Restore an archived lead to the state it was archived from (lead.archive)',
    tag,
    body: LeadRestore,
    ifMatch: true,
  });
}
