// apps/api/src/modules/origination/document-sharing/openapi.ts
import {
  CreateShareSchema,
  CreateUploadLinkSchema,
  ExternalShareRecordSchema,
  PublicUploadLinkStatusSchema,
  UploadFileResponseSchema,
  UploadLinkRecordSchema,
  VerifyUploadOtpResponseSchema,
  VerifyUploadOtpSchema,
} from '@dsa/contracts';

export function registerOpenApi(registry: any) {
  registry.register('CreateUploadLinkInput', CreateUploadLinkSchema);
  registry.register('UploadLinkRecord', UploadLinkRecordSchema);
  registry.register('PublicUploadLinkStatus', PublicUploadLinkStatusSchema);
  registry.register('VerifyUploadOtpInput', VerifyUploadOtpSchema);
  registry.register('VerifyUploadOtpResponse', VerifyUploadOtpResponseSchema);
  registry.register('UploadFileResponse', UploadFileResponseSchema);
  registry.register('CreateShareInput', CreateShareSchema);
  registry.register('ExternalShareRecord', ExternalShareRecordSchema);
}
