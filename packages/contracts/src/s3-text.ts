// Free-text guard for S3 data (owner: Vaibhav, task P1-01). One definition shared by the API and the web app, so every free-text box
// refuses the same things. A PAN (ABCDE1234F, any letter case), an Aadhaar-shaped 12-digit number (spaces or hyphens allowed) or a
// 9 to 18 digit account-like number is refused with 422 VALIDATION_ERROR on the API and blocked on the screen.

/** Patterns that identify S3 data in free text. Keep this the only copy in the repository. */
export const S3_FREE_TEXT_PATTERNS: readonly RegExp[] = [
  /[A-Z]{5}[0-9]{4}[A-Z]/i,
  /\b\d{4}[\s-]*\d{4}[\s-]*\d{4}\b/,
  /\b\d{9,18}\b/,
];

/** True when the text contains identity or account-number shaped data. */
export function freeTextNoS3(text: string): boolean {
  return S3_FREE_TEXT_PATTERNS.some((pattern) => pattern.test(text));
}
