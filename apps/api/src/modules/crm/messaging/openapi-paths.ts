// OpenAPI paths for crm/messaging (Contracts §1), registered by src/openapi.ts. Request schemas are the ones the routes
// validate with. Every /v1 operation here needs an isolation case naming its operationId (tests/isolation/cases).
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';
import { registerOperation } from '../../../http/openapi-op';

const tag = 'MOD-MSG Messaging';

export function registerPaths(registry: OpenAPIRegistry): void {
  registerOperation(registry, {
    method: 'post',
    path: '/public/v1/webhooks/messaging/:provider/:connectionPathId',
    operationId: 'MSG-POST-PUBLIC-WEBHOOKS-MESSAGING-BY-ID-BY-ID',
    summary: 'POST /public/v1/webhooks/messaging/:provider/:connectionPathId',
    tag,
    public: true,
  });
}
