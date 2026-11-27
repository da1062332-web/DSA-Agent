// apps/api/src/modules/integrations/name-match.ts
// Module 28: Integration Management (MOD-INT) — conservative name matcher for KYC checks (P1-06).
//
// The KYC vendor returns the name registered against a PAN, GSTIN or bank account. The adapter compares it here with the name the
// user typed and returns only the score, so the registered name itself is never copied into a result, a log or a record.
//
// The matcher is deliberately conservative: a wrong "match" would verify the wrong person, a wrong "mismatch" only sends the case to
// manual review. Whole tokens must be equal, or differ by at most one edit in a long token (7+ letters), or be an initial of the
// other name's token. Word order, case, punctuation, honorifics and the usual company-form abbreviations are ignored.

const HONORIFICS = new Set(['MR', 'MRS', 'MS', 'MISS', 'SHRI', 'SMT', 'SRI', 'SHREE', 'DR', 'MESSRS']);
const ABBREVIATIONS: Readonly<Record<string, string>> = { PVT: 'PRIVATE', LTD: 'LIMITED', CO: 'COMPANY' };

/** A token whose similarity to the other token is below this counts as no match (7+ letters allow one edit, shorter ones none). */
const TOKEN_FLOOR = 0.85;
/** "R" against "RAVI": an initial is a weaker match than the full word. */
const INITIAL_SIMILARITY = 0.9;
/** A token the longer name has and the shorter one lacks (a middle name) costs half a token. */
const UNMATCHED_EXTRA_WEIGHT = 0.5;

export function nameTokens(name: string): string[] {
  return name
    .toUpperCase()
    .replace(/\bM\/S\b/g, ' ')
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t.length > 0 && !HONORIFICS.has(t))
    .map((t) => ABBREVIATIONS[t] ?? t);
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      current.push(Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, substitution));
    }
    previous = current;
  }
  return previous[b.length] ?? Math.max(a.length, b.length);
}

function tokenSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length === 1) return long.startsWith(short) ? INITIAL_SIMILARITY : 0;
  const similarity = 1 - editDistance(a, b) / Math.max(a.length, b.length);
  return similarity >= TOKEN_FLOOR ? similarity : 0;
}

/** Score from 0 to 100 matching each token of `shorter` to its best unused token in `longer` (`shorter` has no more tokens). */
function directionalScore(shorter: string[], longer: string[]): number {
  const used = new Set<number>();
  let matched = 0;
  for (const token of shorter) {
    let best = 0;
    let bestIndex = -1;
    for (let index = 0; index < longer.length; index++) {
      if (used.has(index)) continue;
      const similarity = tokenSimilarity(token, longer[index] ?? '');
      if (similarity > best) {
        best = similarity;
        bestIndex = index;
      }
    }
    if (bestIndex >= 0) used.add(bestIndex);
    matched += best;
  }
  const weight = shorter.length + (longer.length - shorter.length) * UNMATCHED_EXTRA_WEIGHT;
  return (100 * matched) / weight;
}

/**
 * Similarity of two names from 0 to 100, to one decimal. Symmetric. 0 when either name has no usable token.
 * Examples: "Ravi Sharma" and "SHARMA RAVI" give 100; "R K Sharma" and "Ravi Kumar Sharma" give 93.3; "Rajesh Kumar" and
 * "Ramesh Kumar" give 50.
 */
export function nameMatchScore(first: string, second: string): number {
  const a = nameTokens(first);
  const b = nameTokens(second);
  if (a.length === 0 || b.length === 0) return 0;
  // With the same number of tokens either name could drive the greedy matching; take the better so the score is symmetric.
  const raw =
    a.length === b.length
      ? Math.max(directionalScore(a, b), directionalScore(b, a))
      : a.length < b.length
        ? directionalScore(a, b)
        : directionalScore(b, a);
  return Math.round(Math.min(100, raw) * 10) / 10;
}
