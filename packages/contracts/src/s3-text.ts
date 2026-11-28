// Free-text guard for S3 data (owner: Vaibhav, task P1-01). One definition shared by the API and the web app, so every free-text box
// refuses the same things. A PAN (ABCDE1234F, any letter case), an Aadhaar-shaped 12-digit number (spaces or hyphens allowed), a
// 9 to 18 digit account-like number, or a date of birth written after its key (dob, date of birth) is refused with 422
// VALIDATION_ERROR on the API and blocked on the screen. A bare date with no key is not refused: it is not identity data on its own.
// These patterns are the only copies in the repository. Other rules (a structured payload check, a masking rule) reuse the
// predicates below instead of writing the patterns again.

/** A PAN anywhere in the text, in any letter case. */
export const PAN_IN_TEXT = /[A-Z]{5}[0-9]{4}[A-Z]/i;
/** An Aadhaar-shaped 12-digit number, spaces or hyphens allowed. */
export const AADHAAR_IN_TEXT = /\b\d{4}[\s-]*\d{4}[\s-]*\d{4}\b/;
/** A 9 to 18 digit account-like number. */
export const ACCOUNT_IN_TEXT = /\b\d{9,18}\b/;

/** The key that names a date of birth: dob, date of birth, dateOfBirth, date_of_birth, date-of-birth. Source text, shared with the redactor. */
export const DOB_KEY_SOURCE = 'dob|date[\\s_-]?of[\\s_-]?birth';
/** A date of birth written after its key, with `=` or `:` and any value, or with a space and a numeric date (01/01/1990, 1990-01-01). */
export const DOB_IN_TEXT = new RegExp(
  `\\b(?:${DOB_KEY_SOURCE})(?:\\s*[=:]\\s*["']?[^\\s&;,'"]+|\\s+["']?\\d{1,4}[-/.]\\d{1,2}[-/.]\\d{1,4}\\b)`,
  'i',
);

/** Patterns that identify S3 data in free text. */
export const S3_FREE_TEXT_PATTERNS: readonly RegExp[] = [PAN_IN_TEXT, AADHAAR_IN_TEXT, ACCOUNT_IN_TEXT, DOB_IN_TEXT];

/** True when the text contains a PAN. */
export const containsPan = (text: string): boolean => PAN_IN_TEXT.test(text);
/** True when the text contains an Aadhaar-shaped number. */
export const containsAadhaar = (text: string): boolean => AADHAAR_IN_TEXT.test(text);
/** True when the text contains a 9 to 18 digit account-like number. */
export const containsAccountNumber = (text: string): boolean => ACCOUNT_IN_TEXT.test(text);
/** True when the text contains a date of birth written after its key. */
export const containsDateOfBirth = (text: string): boolean => DOB_IN_TEXT.test(text);

/** True when the text contains identity, account-number or date-of-birth shaped data. */
export function freeTextNoS3(text: string): boolean {
  return S3_FREE_TEXT_PATTERNS.some((pattern) => pattern.test(text));
}
