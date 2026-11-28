// No local copies of the S3 guard or the PAN mask (owner: Dev 1; task P1-01, checklist 4.5.1; TEST-SECRETS-06). The guard that refuses a
// PAN, Aadhaar or account number in free text is defined once, as freeTextNoS3 in packages/contracts/src/s3-text.ts. The log masks are
// defined once, in apps/api/src/http/redact.ts. A new file that writes its own copy of either fails this test.
// Not copies, and never flagged: importing freeTextNoS3, and a format check on one structured field (a PAN pattern on a PAN field, an
// account pattern on an account field), because those hold no second identity pattern.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../..');
const SOURCE_ROOTS = ['apps/', 'packages/', 'tools/', 'seeds/'];

/** The two definitions the rule is about. Every other file refers to them. */
const CANONICAL = new Set(['packages/contracts/src/s3-text.ts', 'apps/api/src/http/redact.ts']);

/**
 * Legacy copies still waiting to be replaced. Empty once the 4.2.3 cleanup is done. A listed copy that is gone fails the test, so this list
 * cannot go stale.
 */
const KNOWN_LOCAL_COPIES: Record<string, string> = {};

/**
 * Dedicated rules that are not copies of the free-text guard and stay. Each one is listed with its reason and checked the same way: if the
 * rule goes, the entry must go too. Anchored format checks (a regex that starts with ^, such as a PAN field's format or the audit rule that
 * stores a whole PAN value as [REDACTED]) are field rules, so the scan does not read them and they are not listed.
 */
const DEDICATED_RULES: Record<string, string> = {};

// The PAN shape as it is written in source: [A-Z]{5} then [0-9]{4} or \d{4}, with an optional closing bracket of a group.
const PAN_SHAPE = /\[(?:A-Z|A-Za-z)\]\{5\}\)?\s*(?:\\d|\[0-9\])\{4\}/;
// The Aadhaar or account shape: 9 to 18 digits, 12 digits, or a 4-4-4 group with optional spaces or hyphens.
const IDENTITY_OR_ACCOUNT_SHAPE =
  /\\d\{9,18\}|\\d\{12\}|\\d\{4\}\[\\s-\]\??\\d\{4\}|\\d\{4\}\\s\??\\d\{4\}|\[2-9\]\\d\{3\}|\\d\{4\}\[ -\]\?\\d\{4\}|\[0-9\]\{9,18\}|\[0-9\]\{12\}|\[2-9\]\[0-9\]\{3\}/;
const MASK_LITERAL = /\*\*\*\*/;
const COMMENT = /^\s*(\/\/|\/\*|\*)/;

export type CopyKind = 'guard' | 'mask';

/**
 * The local copies a source text holds. A guard is a PAN pattern and an identity or account pattern within ten lines of each other.
 * A mask is a PAN pattern on a line that writes four stars. Comments are ignored.
 */
export function copyKinds(source: string): CopyKind[] {
  const lines = source.split(/\r?\n/).map((line) => (COMMENT.test(line) ? '' : line));
  const pan: number[] = [];
  const identity: number[] = [];
  lines.forEach((line, i) => {
    // An anchored regex (/^...$) is a format check on one field, not a free-text guard: it is not read here.
    if (/\/\^/.test(line)) return;
    if (PAN_SHAPE.test(line)) pan.push(i);
    if (IDENTITY_OR_ACCOUNT_SHAPE.test(line)) identity.push(i);
  });
  const kinds: CopyKind[] = [];
  if (pan.some((p) => identity.some((q) => Math.abs(p - q) <= 10))) kinds.push('guard');
  if (pan.some((p) => MASK_LITERAL.test(lines[p] ?? ''))) kinds.push('mask');
  return kinds;
}

/** Production source files git tracks, plus new ones it would track. Tests, fixtures, generated output and dependencies are not scanned. */
function productionSources(): string[] {
  const listing = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: ROOT,
    maxBuffer: 64 * 1024 * 1024,
  }).toString('utf8');
  return listing
    .split('\u0000')
    .filter(Boolean)
    .map((file) => file.replace(/\\/g, '/'))
    .filter(
      (file) =>
        SOURCE_ROOTS.some((root) => file.startsWith(root)) &&
        /\.(ts|tsx|js|mjs|cjs)$/.test(file) &&
        !/\.d\.ts$/.test(file) &&
        !/\.(spec|test|int\.spec)\./.test(file) &&
        !/\/(test|e2e|__tests__|dist|node_modules)\//.test(file),
    );
}

/** Every local copy in the repository, as "file · kind", outside the canonical definitions. */
function currentCopies(): string[] {
  const out: string[] = [];
  for (const rel of productionSources()) {
    if (CANONICAL.has(rel)) continue;
    for (const kind of copyKinds(readFileSync(path.join(ROOT, rel), 'utf8'))) out.push(`${rel} · ${kind}`);
  }
  return out.sort();
}

describe('no local copies of the S3 guard or the PAN mask', () => {
  it('TEST-SECRETS-06 no production file defines its own guard or mask beyond the recorded legacy copies and dedicated rules', () => {
    const found = currentCopies();
    const allowed = [...Object.keys(KNOWN_LOCAL_COPIES), ...Object.keys(DEDICATED_RULES)].sort();
    expect(found.filter((copy) => !allowed.includes(copy))).toEqual([]);
    expect(allowed.filter((copy) => !found.includes(copy))).toEqual([]);
  });

  it('TEST-SECRETS-06 the detector flags a guard and a mask, and not a single-field format check or an import', () => {
    expect(copyKinds(String.raw`const NO_S3 = [/[A-Z]{5}[0-9]{4}[A-Z]/i, /\b\d{9,18}\b/];`)).toEqual(['guard']);
    expect(copyKinds(String.raw`s.replace(/\b([A-Z]{5})\d{4}([A-Z])\b/g, '$1****$2')`)).toEqual(['mask']);
    expect(copyKinds(String.raw`export const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;`)).toEqual([]);
    expect(
      copyKinds(String.raw`accountNumber: z.string().regex(/^\d{9,18}$/, 'Account number must be 9 to 18 digits')`),
    ).toEqual([]);
    expect(copyKinds(`import { freeTextNoS3 } from '@dsa/contracts';`)).toEqual([]);
    // A comment that names the shapes is not code.
    expect(copyKinds(`// PAN [A-Z]{5}[0-9]{4}[A-Z] and \\d{9,18}`)).toEqual([]);
    // A multi-check guard written with [0-9] and spread over several lines is still a guard.
    expect(
      copyKinds(
        [
          `function assertNoS3(text: string) {`,
          String.raw`  if (/[A-Z]{5}[0-9]{4}[A-Z]/i.test(text)) throw new Error('pan');`,
          `  // Aadhaar`,
          String.raw`  if (/\b[2-9][0-9]{3}\s?[0-9]{4}\s?[0-9]{4}\b/.test(text)) throw new Error('aadhaar');`,
          `}`,
        ].join('\n'),
      ),
    ).toEqual(['guard']);
    // Anchored format checks on single fields, one of each kind, are not guards.
    expect(
      copyKinds(
        [
          String.raw`idNumber: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'INVALID_PAN_FORMAT'),`,
          String.raw`accountNumber: z.string().regex(/^[0-9]{9,18}$/, 'INVALID_ACCOUNT_NUMBER'),`,
        ].join('\n'),
      ),
    ).toEqual([]);
  });
});
