// Free-text guard for S3 data (owner: Vaibhav, task P1-01). One definition shared by the API and the web app, so every free-text box
// refuses the same things. A PAN (ABCDE1234F, any letter case), an Aadhaar-shaped 12-digit number (spaces or hyphens allowed) or a
// 9 to 18 digit account-like number is refused with 422 VALIDATION_ERROR on the API and blocked on the screen.
// These three patterns are the only copies in the repository. Other rules (a structured payload check, a masking rule) reuse the
// predicates below instead of writing the patterns again.

/** A PAN anywhere in the text, in any letter case. */
export const PAN_IN_TEXT = /[A-Z]{5}[0-9]{4}[A-Z]/i;
/** An Aadhaar-shaped 12-digit number, spaces or hyphens allowed. */
export const AADHAAR_IN_TEXT = /\b\d{4}[\s-]*\d{4}[\s-]*\d{4}\b/;
/** A 9 to 18 digit account-like number. */
export const ACCOUNT_IN_TEXT = /\b\d{9,18}\b/;

/** Patterns that identify S3 data in free text. */
export const S3_FREE_TEXT_PATTERNS: readonly RegExp[] = [PAN_IN_TEXT, AADHAAR_IN_TEXT, ACCOUNT_IN_TEXT];

/** True when the text contains a PAN. */
export const containsPan = (text: string): boolean => PAN_IN_TEXT.test(text);
/** True when the text contains an Aadhaar-shaped number. */
export const containsAadhaar = (text: string): boolean => AADHAAR_IN_TEXT.test(text);
/** True when the text contains a 9 to 18 digit account-like number. */
export const containsAccountNumber = (text: string): boolean => ACCOUNT_IN_TEXT.test(text);

/** True when the text contains identity or account-number shaped data. */
export function freeTextNoS3(text: string): boolean {
  return S3_FREE_TEXT_PATTERNS.some((pattern) => pattern.test(text));
}
