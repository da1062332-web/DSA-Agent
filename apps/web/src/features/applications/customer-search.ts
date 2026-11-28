// Rules for the customer search box (owner: Bhushan, 2026-11-28). They mirror POST /v1/customers/search, so the box never sends a
// term the API refuses: a 10-digit mobile (optionally with 0, 91 or +91 in front) or at least 2 characters of a name. A long number
// that is not a mobile (a PAN, an Aadhaar or an account number) is never sent.

import { hasRestrictedNumber } from './rules';

const compact = (raw: string) => raw.trim().replace(/[\s\-()]/g, '');

/** True for an Indian mobile number in any of the usual forms. */
export const isMobileTerm = (raw: string): boolean => /^(\+?91|0)?[6-9][0-9]{9}$/.test(compact(raw));

/** Digits only, still short of a full mobile number: the person is typing one. */
const partialMobile = (raw: string): boolean => {
  const c = compact(raw).replace(/^\+/, '');
  return /^\d+$/.test(c) && c.length < 10;
};

/** Why the term cannot be searched, or null when it can, when nothing is typed, or while a mobile is being typed. */
export function searchProblem(raw: string): string | null {
  const t = raw.trim();
  if (!t || isMobileTerm(t) || partialMobile(t)) return null;
  if (/^\+?\d+$/.test(compact(t))) return 'That is not a valid 10-digit mobile number.';
  if (/\d{5,}/.test(compact(t)) || hasRestrictedNumber(t)) {
    return 'Search by a 10-digit mobile number or by name. Do not enter PAN, Aadhaar or account numbers.';
  }
  if (t.length < 2) return 'Type at least 2 letters of the name.';
  return null;
}

/** What the box says while waiting for more input, or null. */
export function searchHint(raw: string): string | null {
  const t = raw.trim();
  if (!t) return 'Type a 10-digit mobile number or at least 2 letters of the name.';
  if (partialMobile(t)) return 'Keep typing: a mobile number has 10 digits.';
  return null;
}

/** The term to send, or null when nothing should be searched. */
export function searchTerm(raw: string): string | null {
  const t = raw.trim();
  if (!t || partialMobile(t) || searchProblem(t)) return null;
  return t;
}
