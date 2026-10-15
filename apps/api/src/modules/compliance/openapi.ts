// apps/api/src/modules/compliance/openapi.ts
// OpenAPI registration for module compliance (owner: see router.ts). Register this module's paths with zod schemas;
// tools/gen-openapi.ts writes openapi/openapi.yaml (never hand-edited; CI fails on a diff).
import {
  DataSharingRecordSchema,
  ListDataSharingRecordsQuerySchema,
  ListDataSharingRecordsResponseSchema,
  PrivacyStatsSchema,
  VerifyConsentInputSchema,
  VerifyConsentResultSchema,
} from '@dsa/contracts';
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';

export function registerOpenApi(registry: OpenAPIRegistry): void {
  registry.register('DataSharingRecord', DataSharingRecordSchema);
  registry.register('ListDataSharingRecordsQuery', ListDataSharingRecordsQuerySchema);
  registry.register('ListDataSharingRecordsResponse', ListDataSharingRecordsResponseSchema);
  registry.register('PrivacyStats', PrivacyStatsSchema);
  registry.register('VerifyConsentInput', VerifyConsentInputSchema);
  registry.register('VerifyConsentResult', VerifyConsentResultSchema);
}
