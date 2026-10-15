// apps/web/src/features/privacy/api.ts
// Module 29: Privacy and Consent (MOD-PRV) Client API
import type {
  ListDataSharingRecordsQuery,
  ListDataSharingRecordsResponse,
  PrivacyStats,
  VerifyConsentInput,
  VerifyConsentResult,
} from '@dsa/contracts';
import { apiFetch } from '../../api/client';

export async function fetchPrivacyStats(): Promise<PrivacyStats> {
  return apiFetch<PrivacyStats>('/v1/compliance/stats');
}

export async function fetchDataSharingRecords(
  query: ListDataSharingRecordsQuery = { limit: 50, offset: 0 },
): Promise<ListDataSharingRecordsResponse> {
  const queryParams: Record<string, string | number | undefined> = {
    limit: query.limit,
    offset: query.offset,
    subjectId: query.subjectId,
    recipientType: query.recipientType,
    purpose: query.purpose,
  };
  return apiFetch<ListDataSharingRecordsResponse>('/v1/compliance/data-sharing-records', {
    query: queryParams,
  });
}

export async function checkConsent(input: VerifyConsentInput): Promise<VerifyConsentResult> {
  return apiFetch<VerifyConsentResult>('/v1/compliance/consent-check', {
    method: 'POST',
    body: input,
  });
}
