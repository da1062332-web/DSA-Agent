// apps/api/src/modules/integrations/openapi.ts
// OpenAPI registration for module integrations (MOD-INT)

import {
  CapabilityDescriptorSchema,
  ConfigureIntegrationRequestSchema,
  HealthCheckResultSchema,
  IntegrationConnectionSchema,
  IntegrationEnvironmentSchema,
  IntegrationStatusSchema,
  ListIntegrationsQuerySchema,
} from '@dsa/contracts';
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';

export function registerOpenApi(registry: OpenAPIRegistry): void {
  registry.register('IntegrationEnvironment', IntegrationEnvironmentSchema);
  registry.register('IntegrationStatus', IntegrationStatusSchema);
  registry.register('CapabilityDescriptor', CapabilityDescriptorSchema);
  registry.register('HealthCheckResult', HealthCheckResultSchema);
  registry.register('IntegrationConnection', IntegrationConnectionSchema);
  registry.register('ListIntegrationsQuery', ListIntegrationsQuerySchema);
  registry.register('ConfigureIntegrationRequest', ConfigureIntegrationRequestSchema);
}
