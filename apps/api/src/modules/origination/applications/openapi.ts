// OpenAPI registration for origination/applications (owner: Dev 3). Swagger group: MOD-APP Loan Applications.
import {
  CompleteUploadResponseSchema,
  CreateLegalHoldSchema,
  CreateUploadIntentSchema,
  DocumentArchiveResponseSchema,
  DocumentLinkRequestSchema,
  DocumentLinkResponseSchema,
  DocumentResourceSchema,
  DocumentTypeSchema,
  LegalHoldSchema,
  ReviewDocumentVersionSchema,
  UploadIntentResponseSchema,
  UpsertDocumentTypeSchema,
  WaiveChecklistItemSchema,
  listResponse,
} from '@dsa/contracts';
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';
import { z, type ZodTypeAny } from 'zod';
import { ChecklistResponseSchema } from './checklist-schemas';
import {
  ApplicantInputs,
  ApplicantInputsUpdate,
  EligibilityAssessment,
  EligibilityListQuery,
  OverrideRequest,
} from './eligibility-schemas';
import {
  Application,
  ApplicationHold,
  ApplicationListQuery,
  ApplicationPatch,
  ApplicationAssignment,
  ApplicationCreate,
  ApplicationPartyChange,
  ApplicationTransition,
} from './schemas';

export const tags = [
  {
    name: 'MOD-APP Loan Applications',
    description:
      'Internal loan file (MOD-APP): create from a customer, list, read, edit, hold, transitions, parties, owners, completeness and waivers. Reads need application.read; changes need the permission named on each operation and an If-Match version. Scope: RM sees own, branch roles see their branch, org owner sees the tenant.',
  },
  {
    name: 'MOD-DOC Documents',
    description:
      'Document types, upload intents with signed one-time upload links, immutable versions with a content check, review, short-lived signed view and download links (each logged), encrypted bulk archives (MOD-DOC). Legal holds (MOD-PRV) stop purging.',
  },
  {
    name: 'MOD-ELG Eligibility',
    description:
      'Preliminary eligibility assessment of an application (MOD-ELG), checked against the approved rule set through the decision engine. Running one needs application.update; reading needs application.read; an override needs eligibility.override and a reason. Missing or unusable information never gives a pass. It never promises approval.',
  },
];

const json = (schema: ZodTypeAny) => ({ 'application/json': { schema } });

export function registerOpenApi(registry: OpenAPIRegistry): void {
  const tag = ['MOD-APP Loan Applications'];
  const ifMatch = [{ $ref: '#/components/parameters/IfMatch' }];

  registry.registerPath({
    method: 'get',
    path: '/v1/applications',
    tags: tag,
    operationId: 'API-APP-002',
    summary: 'List applications in the caller scope (application.read)',
    request: { query: ApplicationListQuery as never },
    responses: {
      200: { description: 'Page of applications', content: json(listResponse(Application)) },
      401: { description: 'UNAUTHENTICATED' },
      403: { description: 'FORBIDDEN' },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/applications/{id}',
    tags: tag,
    operationId: 'API-APP-003',
    summary: 'One application in the caller scope (application.read)',
    responses: {
      200: { description: 'Application', content: json(Application) },
      403: { description: 'FORBIDDEN' },
      404: { description: 'NOT_FOUND (also when outside the caller scope)' },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/v1/applications/{id}',
    tags: tag,
    operationId: 'API-APP-004',
    summary:
      'Edit the applicant request while the application is DRAFT or DOCUMENTS_PENDING (application.update)',
    parameters: ifMatch,
    request: { body: { required: true, content: json(ApplicationPatch) } },
    responses: {
      200: { description: 'Updated', content: json(Application) },
      403: { description: 'FORBIDDEN' },
      404: { description: 'NOT_FOUND' },
      409: { description: 'VERSION_CONFLICT or INVALID_STATE (application no longer editable)' },
      422: { description: 'VALIDATION_ERROR' },
    },
  });

  registry.registerPath({
    method: 'put',
    path: '/v1/applications/{id}/hold',
    tags: tag,
    operationId: 'API-APP-010',
    summary: 'Put an application on hold with a reason, or clear the hold (application.update)',
    parameters: ifMatch,
    request: { body: { required: true, content: json(ApplicationHold) } },
    responses: {
      200: { description: 'Hold set or cleared', content: json(Application) },
      403: { description: 'FORBIDDEN' },
      404: { description: 'NOT_FOUND' },
      409: { description: 'VERSION_CONFLICT or INVALID_STATE (terminal application, or no hold to clear)' },
      422: { description: 'VALIDATION_ERROR (a reason is required to hold)' },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/applications/{id}/transitions',
    tags: tag,
    operationId: 'API-APP-005',
    summary:
      'Move an application: T-APP-01 select product and start documents, T-APP-02 send to review, T-APP-04 ready for submission (checklist complete), T-APP-08 withdraw, T-APP-09 reopen, T-APP-10 cancel',
    parameters: [
      { $ref: '#/components/parameters/IdempotencyKey' },
      { $ref: '#/components/parameters/IfMatch' },
    ],
    request: { body: { required: true, content: json(ApplicationTransition) } },
    responses: {
      200: { description: 'Transitioned', content: json(Application) },
      403: { description: 'FORBIDDEN (the permission for this transition is missing)' },
      404: { description: 'NOT_FOUND (also when outside the caller scope)' },
      409: {
        description: 'VERSION_CONFLICT or INVALID_TRANSITION or INVALID_STATE (product version not in force)',
      },
      422: {
        description:
          'VALIDATION_ERROR (unknown product version, wrong category, missing reason) or COMPLETENESS_FAILED (T-APP-04)',
      },
    },
  });

  registerPartyAndDocumentPaths(registry, tag);

  const elg = ['MOD-ELG Eligibility'];
  registry.registerPath({
    method: 'post',
    path: '/v1/applications/{id}/eligibility-assessments',
    tags: elg,
    operationId: 'API-ELG-001',
    summary: 'Run an eligibility assessment against the approved rule set (application.update)',
    parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }],
    responses: {
      201: { description: 'Assessment recorded', content: json(EligibilityAssessment) },
      403: { description: 'FORBIDDEN' },
      404: { description: 'NOT_FOUND (also when outside the caller scope)' },
      409: {
        description:
          'INVALID_STATE (no product chosen, or the application is closed, withdrawn, rejected or cancelled); CONTENT_HASH_MISMATCH (the rule set failed its integrity check, nothing was recorded)',
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/applications/{id}/eligibility-assessments',
    tags: elg,
    operationId: 'API-ELG-002',
    summary: 'Assessment history for the application, oldest first (application.read)',
    request: { query: EligibilityListQuery as never },
    responses: {
      200: { description: 'Page of assessments', content: json(listResponse(EligibilityAssessment)) },
      403: { description: 'FORBIDDEN' },
      404: { description: 'NOT_FOUND (also when outside the caller scope)' },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/eligibility-assessments/{id}/overrides',
    tags: elg,
    operationId: 'API-ELG-003',
    summary: 'Override a failed result with a reason (eligibility.override)',
    parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }],
    request: { body: { required: true, content: json(OverrideRequest) } },
    responses: {
      201: { description: 'Override recorded', content: json(EligibilityAssessment) },
      403: { description: 'FORBIDDEN' },
      404: { description: 'NOT_FOUND (also when outside the caller scope)' },
      409: {
        description:
          'INVALID_STATE (only a FAIL result; only the latest assessment; not twice for the same inputs; not on a closed, withdrawn, rejected or cancelled application)',
      },
      422: { description: 'VALIDATION_ERROR (unknown product version, or reason too short)' },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/applications/{id}/eligibility-assessments/latest',
    tags: elg,
    operationId: 'API-ELG-004',
    summary: 'The newest eligibility assessment of the application (application.read)',
    responses: {
      200: { description: 'The newest assessment', content: json(EligibilityAssessment) },
      403: { description: 'FORBIDDEN' },
      404: { description: 'NOT_FOUND (no assessment has been run yet, or outside the caller scope)' },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/applications/{id}/eligibility-inputs',
    tags: elg,
    operationId: 'API-ELG-005',
    summary: 'Declared and verified income and the credit score of the application (application.update)',
    responses: {
      200: { description: 'Applicant figures; ETag is the version', content: json(ApplicantInputs) },
      403: { description: 'FORBIDDEN' },
      404: { description: 'NOT_FOUND (also when outside the caller scope)' },
    },
  });

  registry.registerPath({
    method: 'put',
    path: '/v1/applications/{id}/eligibility-inputs',
    tags: elg,
    operationId: 'API-ELG-006',
    summary:
      'Record or clear declared income, verified income and manual credit data (application.update, If-Match)',
    parameters: [{ $ref: '#/components/parameters/IfMatch' }],
    request: { body: { required: true, content: json(ApplicantInputsUpdate) } },
    responses: {
      200: { description: 'Updated figures; ETag is the new version', content: json(ApplicantInputs) },
      400: { description: 'MALFORMED_REQUEST (If-Match missing)' },
      403: { description: 'FORBIDDEN' },
      404: { description: 'NOT_FOUND (also when outside the caller scope)' },
      409: {
        description:
          'VERSION_CONFLICT (If-Match is stale) or INVALID_STATE (application closed or past review, or manual credit entry not enabled for the tenant)',
      },
      422: {
        description:
          'VALIDATION_ERROR (a credit date in the future, or income evidence that is not an accepted income document)',
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/applications/{id}/checklist',
    tags: tag,
    operationId: 'API-APP-007',
    summary: 'Document checklist of the application with a completeness summary (application.read)',
    responses: {
      200: { description: 'Checklist items and summary', content: json(ChecklistResponseSchema) },
      401: { description: 'UNAUTHENTICATED' },
      403: { description: 'FORBIDDEN' },
      404: { description: 'NOT_FOUND (also when outside the caller scope)' },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/applications/{id}/checklist/generate',
    tags: tag,
    operationId: 'API-APP-007-GENERATE',
    summary:
      'Build the document checklist from the rule engine if it is missing, then return it with a completeness summary (application.read)',
    responses: {
      200: { description: 'Checklist items and summary', content: json(ChecklistResponseSchema) },
      401: { description: 'UNAUTHENTICATED' },
      403: { description: 'FORBIDDEN' },
      404: { description: 'NOT_FOUND (also when outside the caller scope)' },
    },
  });
}

const Party = z.object({
  id: z.string(),
  customerId: z.string(),
  role: z.enum(['PRIMARY', 'CO_APPLICANT', 'GUARANTOR']),
  partyType: z.enum(['INDIVIDUAL', 'ENTITY']),
  relationshipToPrimary: z.string().nullable(),
  removedAt: z.string().nullable(),
  createdAt: z.string(),
});

/** API-APP-001, 006, 008, 009, 011 and MOD-DOC (API-DOC-001..009, API-PRV-004 legal holds). */
function registerPartyAndDocumentPaths(registry: OpenAPIRegistry, tag: string[]): void {
  const idem = [{ $ref: '#/components/parameters/IdempotencyKey' }];
  const idemIfMatch = [...idem, { $ref: '#/components/parameters/IfMatch' }];

  registry.registerPath({
    method: 'post',
    path: '/v1/applications',
    tags: tag,
    operationId: 'API-APP-001',
    summary:
      'Create a DRAFT application for an existing customer, in a branch the caller may create in (application.create)',
    parameters: idem,
    request: { body: { required: true, content: json(ApplicationCreate) } },
    responses: {
      201: { description: 'Created, with its PRIMARY party', content: json(Application) },
      403: { description: 'FORBIDDEN (no application.create for that branch)' },
      404: { description: 'NOT_FOUND (customer unknown or in another tenant)' },
      422: {
        description:
          'VALIDATION_ERROR (applicant type does not match the customer; owner not active in the branch)',
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/applications/{id}/parties',
    tags: tag,
    operationId: 'API-APP-006-LIST',
    summary:
      'Parties of the application, removed ones included (application.read). ETag is the application version',
    responses: {
      200: { description: 'Parties', content: json(listResponse(Party)) },
      403: { description: 'FORBIDDEN' },
      404: { description: 'NOT_FOUND (also when outside the caller scope)' },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/applications/{id}/parties',
    tags: tag,
    operationId: 'API-APP-006',
    summary:
      'Add a co-applicant or guarantor, or remove one (recorded, never deleted; its open checklist items become NOT_APPLICABLE) (application.update)',
    parameters: idemIfMatch,
    request: { body: { required: true, content: json(ApplicationPartyChange) } },
    responses: {
      200: {
        description: 'Parties after the change',
        content: json(
          z.object({ applicationId: z.string(), parties: z.array(Party), version: z.number().int() }),
        ),
      },
      403: { description: 'FORBIDDEN' },
      404: { description: 'NOT_FOUND' },
      409: {
        description:
          'VERSION_CONFLICT or INVALID_STATE (with a lender already, or removing the PRIMARY party)',
      },
      422: {
        description: 'VALIDATION_ERROR (customer unknown or already a party; party not on the application)',
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/applications/{id}/assignments',
    tags: tag,
    operationId: 'API-APP-011',
    summary: 'Change the sales owner, ops owner or ops queue, with a reason (application.assign)',
    parameters: idemIfMatch,
    request: { body: { required: true, content: json(ApplicationAssignment) } },
    responses: {
      200: { description: 'Reassigned', content: json(Application) },
      403: { description: 'FORBIDDEN' },
      404: { description: 'NOT_FOUND' },
      409: { description: 'VERSION_CONFLICT or INVALID_STATE (terminal application)' },
      422: {
        description: 'VALIDATION_ERROR (user not active in the branch, queue inactive or of another branch)',
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/applications/{id}/completeness-checks',
    tags: tag,
    operationId: 'API-APP-008',
    summary:
      'Evaluate completeness of the checklist and record the result on the application (application.read)',
    responses: {
      200: {
        description: 'COMPLETE or INCOMPLETE with the outstanding items',
        content: json(
          z.object({
            result: z.enum(['COMPLETE', 'INCOMPLETE']),
            reasons: z.array(
              z.object({ code: z.string(), text: z.string(), checklistItemId: z.string().optional() }),
            ),
          }),
        ),
      },
      403: { description: 'FORBIDDEN' },
      404: { description: 'NOT_FOUND' },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/applications/{id}/waivers',
    tags: tag,
    operationId: 'API-APP-009',
    summary: 'Waive a checklist item, or mark it not applicable, with a reason (document.waive)',
    parameters: idem,
    request: { body: { required: true, content: json(WaiveChecklistItemSchema) } },
    responses: {
      200: {
        description: 'Checklist item after the waiver',
        content: json(
          z.object({ checklistItemId: z.string(), status: z.string(), version: z.number().int() }),
        ),
      },
      403: { description: 'FORBIDDEN' },
      404: { description: 'NOT_FOUND (application or checklist item)' },
      409: { description: 'INVALID_STATE (an accepted document cannot be waived)' },
      422: { description: 'VALIDATION_ERROR' },
    },
  });

  const doc = ['MOD-DOC Documents'];
  registry.registerPath({
    method: 'get',
    path: '/v1/document-types',
    tags: doc,
    operationId: 'API-DOC-007',
    summary: 'Document type catalogue (any staff)',
    responses: { 200: { description: 'Document types', content: json(listResponse(DocumentTypeSchema)) } },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/document-types',
    tags: doc,
    operationId: 'API-DOC-008',
    summary: 'Create or update a tenant document type (config.manage)',
    parameters: idem,
    request: { body: { required: true, content: json(UpsertDocumentTypeSchema) } },
    responses: {
      200: { description: 'Updated', content: json(DocumentTypeSchema) },
      201: { description: 'Created', content: json(DocumentTypeSchema) },
      403: { description: 'FORBIDDEN' },
      422: { description: 'VALIDATION_ERROR' },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/documents/upload-intents',
    tags: doc,
    operationId: 'API-DOC-001',
    summary: 'Ask for a one-time signed upload link for a checklist item (document.upload)',
    parameters: idem,
    request: { body: { required: true, content: json(CreateUploadIntentSchema) } },
    responses: {
      201: { description: 'Upload intent with a signed PUT link', content: json(UploadIntentResponseSchema) },
      403: { description: 'FORBIDDEN' },
      404: { description: 'NOT_FOUND (checklist item)' },
      422: { description: 'VALIDATION_ERROR (type, size or mime not allowed)' },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/upload-intents/{id}/completion',
    tags: doc,
    operationId: 'API-DOC-002',
    summary: 'Register the uploaded file as a new immutable document version (document.upload)',
    responses: {
      202: {
        description: 'Version registered with its scan status',
        content: json(CompleteUploadResponseSchema),
      },
      403: { description: 'FORBIDDEN' },
      404: { description: 'NOT_FOUND' },
      409: { description: 'INVALID_STATE (nothing uploaded yet, or already completed)' },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/documents/{id}',
    tags: doc,
    operationId: 'API-DOC-003',
    summary: 'Document and its version metadata (document.view)',
    responses: {
      200: { description: 'Document', content: json(DocumentResourceSchema) },
      403: { description: 'FORBIDDEN' },
      404: { description: 'NOT_FOUND (also when outside the caller scope)' },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/document-versions/{id}/reviews',
    tags: doc,
    operationId: 'API-DOC-006',
    summary: 'Accept or reject a version; the checklist item follows (document.review)',
    parameters: idem,
    request: { body: { required: true, content: json(ReviewDocumentVersionSchema) } },
    responses: {
      200: { description: 'Reviewed', content: json(DocumentResourceSchema) },
      403: { description: 'FORBIDDEN' },
      404: { description: 'NOT_FOUND' },
      409: { description: 'INVALID_STATE (already reviewed) or DOCUMENT_QUARANTINED' },
    },
  });

  for (const [suffix, opId, code] of [
    ['view-url', 'API-DOC-004', 'document.view'],
    ['download-url', 'API-DOC-005', 'document.download'],
  ] as const) {
    registry.registerPath({
      method: 'post',
      path: `/v1/document-versions/{id}/${suffix}`,
      tags: doc,
      operationId: opId,
      summary: `Short-lived signed ${suffix === 'view-url' ? 'view' : 'download'} link; the access is logged (${code})`,
      request: { body: { required: false, content: json(DocumentLinkRequestSchema) } },
      responses: {
        200: { description: 'Signed link', content: json(DocumentLinkResponseSchema) },
        403: { description: 'FORBIDDEN' },
        404: { description: 'NOT_FOUND' },
        409: { description: 'DOCUMENT_QUARANTINED' },
      },
    });
  }

  registry.registerPath({
    method: 'post',
    path: '/v1/applications/{id}/document-archive',
    tags: doc,
    operationId: 'API-DOC-009',
    summary: 'Build an encrypted archive of the application documents in the background (document.download)',
    responses: {
      202: { description: 'Archive requested', content: json(DocumentArchiveResponseSchema) },
      403: { description: 'FORBIDDEN' },
      404: { description: 'NOT_FOUND' },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/document-archives/{id}',
    tags: doc,
    operationId: 'API-DOC-009-STATUS',
    summary: 'Archive status, with a signed download link once READY (document.download)',
    responses: {
      200: { description: 'Archive', content: json(DocumentArchiveResponseSchema) },
      403: { description: 'FORBIDDEN' },
      404: { description: 'NOT_FOUND' },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/legal-holds',
    tags: doc,
    operationId: 'API-PRV-004',
    summary: 'Place a legal hold: nothing in its scope is purged while it is active (privacy.manage)',
    parameters: idem,
    request: { body: { required: true, content: json(CreateLegalHoldSchema) } },
    responses: {
      201: { description: 'Hold placed', content: json(LegalHoldSchema) },
      403: { description: 'FORBIDDEN' },
      422: { description: 'VALIDATION_ERROR' },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/legal-holds',
    tags: doc,
    operationId: 'API-PRV-004-LIST',
    summary: 'Legal holds of the tenant (privacy.manage)',
    responses: {
      200: { description: 'Holds', content: json(listResponse(LegalHoldSchema)) },
      403: { description: 'FORBIDDEN' },
    },
  });

  registry.registerPath({
    method: 'put',
    path: '/public/v1/document-uploads/{token}',
    tags: doc,
    operationId: 'API-DOC-001-PUT',
    summary: 'Upload the file bytes to a signed one-time link (no bearer token; the link is the credential)',
    security: [],
    request: { body: { required: true, content: { 'application/octet-stream': { schema: z.string() } } } },
    responses: {
      204: { description: 'Stored' },
      404: { description: 'NOT_FOUND (link unknown or expired)' },
      409: { description: 'INVALID_STATE (link already used)' },
      422: { description: 'VALIDATION_ERROR (bytes do not match the declared size or sha256)' },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/public/v1/document-files/{token}',
    tags: doc,
    operationId: 'API-DOC-004-GET',
    summary: 'Serve a file from a signed, short-lived view or download link (no bearer token)',
    security: [],
    responses: {
      200: { description: 'The file', content: { 'application/octet-stream': { schema: z.string() } } },
      404: { description: 'NOT_FOUND (link unknown, expired or tampered)' },
    },
  });
}
