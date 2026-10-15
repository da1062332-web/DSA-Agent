// apps/api/src/modules/platform-admin/openapi.ts
// OpenAPI registration for Module 30: Administration and Platform Operations (MOD-ADM)
import {
  ApproveDataCorrectionRequestSchema,
  ApproveSupportAccessRequestSchema,
  CreateDataCorrectionRequestSchema,
  CreateSupportAccessRequestSchema,
  DataCorrectionRequestSchema,
  DeadLetterItemSchema,
  FeatureFlagSchema,
  JobQueueInfoSchema,
  ListPlatformTenantsQuerySchema,
  MasterDataImportRequestSchema,
  MasterDataItemSchema,
  PauseQueueRequestSchema,
  PlatformTenantSummarySchema,
  ReleaseRegisterItemSchema,
  ResumeQueueRequestSchema,
  SupportAccessGrantSchema,
  SystemHealthReportSchema,
  UpdateFeatureFlagRequestSchema,
} from '@dsa/contracts';
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';

export function registerOpenApi(registry: OpenAPIRegistry): void {
  registry.register('PlatformTenantSummary', PlatformTenantSummarySchema);
  registry.register('ListPlatformTenantsQuery', ListPlatformTenantsQuerySchema);
  registry.register('FeatureFlag', FeatureFlagSchema);
  registry.register('UpdateFeatureFlagRequest', UpdateFeatureFlagRequestSchema);
  registry.register('MasterDataItem', MasterDataItemSchema);
  registry.register('MasterDataImportRequest', MasterDataImportRequestSchema);
  registry.register('JobQueueInfo', JobQueueInfoSchema);
  registry.register('DeadLetterItem', DeadLetterItemSchema);
  registry.register('PauseQueueRequest', PauseQueueRequestSchema);
  registry.register('ResumeQueueRequest', ResumeQueueRequestSchema);
  registry.register('SystemHealthReport', SystemHealthReportSchema);
  registry.register('SupportAccessGrant', SupportAccessGrantSchema);
  registry.register('CreateSupportAccessRequest', CreateSupportAccessRequestSchema);
  registry.register('ApproveSupportAccessRequest', ApproveSupportAccessRequestSchema);
  registry.register('DataCorrectionRequest', DataCorrectionRequestSchema);
  registry.register('CreateDataCorrectionRequest', CreateDataCorrectionRequestSchema);
  registry.register('ApproveDataCorrectionRequest', ApproveDataCorrectionRequestSchema);
  registry.register('ReleaseRegisterItem', ReleaseRegisterItemSchema);
}
