// apps/api/src/modules/integrations/masking.ts
// Module 28: Integration Management (MOD-INT) — identifier masking shared by the provider adapters and the call-log redactor.
//
// PAN and bank-account masking come from @dsa/contracts (maskPan: ABCDE****F, maskAccountNumber: ********1234). This file adds
// the one identifier those helpers do not cover.

/** GSTIN: 2-digit state code, the holder's 10-character PAN, entity number, "Z", check character. */
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/**
 * Masks the PAN that is embedded in a GSTIN (characters 3 to 12), so a GSTIN can be shown or logged without disclosing the PAN:
 * 27ABCDE1234F1Z5 becomes 27ABCDE****F1Z5. A value that is not shaped like a GSTIN is never echoed.
 */
export function maskGstin(gstin: string): string {
  if (!GSTIN_PATTERN.test(gstin)) return '***';
  return `${gstin.slice(0, 7)}****${gstin.slice(11)}`;
}
