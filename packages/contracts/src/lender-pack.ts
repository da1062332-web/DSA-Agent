// packages/contracts/src/lender-pack.ts — owner: Dipanshu (lenders) — P2-04 lender document packs (migration M-121).
// Additive (Contracts §15 change log: 2026-11-28 P2-04). Shared by the API (origination/catalogue for the profile,
// origination/applications for the pack download) and the web app (features/lenders), so the file names the editor previews are
// exactly the names the download uses. Pure: no I/O, no clock.
import { z } from 'zod';

// ---- Profile --------------------------------------------------------------------------------------------------------------------

/** Tokens a filename pattern may use. {seq} is required, so two files can never get the same name. */
export const PACK_FILENAME_TOKENS = ['seq', 'docType', 'party', 'original'] as const;
export type PackFilenameToken = (typeof PACK_FILENAME_TOKENS)[number];

export const DEFAULT_PACK_FILENAME_PATTERN = '{seq}_{docType}';

const DOC_TYPE_CODE = /^[A-Z_]{2,40}$/;
const PATTERN_TEXT = /^(?:\{(?:seq|docType|party|original)\}|[A-Za-z0-9 _.-])+$/;

export const PackFilenamePatternSchema = z
  .string()
  .trim()
  .min(5)
  .max(120)
  .refine((p) => PATTERN_TEXT.test(p), {
    message: 'Use letters, digits, spaces, _ . - and the tokens {seq}, {docType}, {party}, {original}.',
  })
  .refine((p) => p.includes('{seq}'), { message: 'The pattern must contain {seq}.' });

export const PackDocumentOrderSchema = z
  .array(z.string().regex(DOC_TYPE_CODE, 'must be a document type code such as PAN'))
  .max(60)
  .refine((codes) => new Set(codes).size === codes.length, {
    message: 'Each document type may appear once.',
  });

/** PUT /v1/lenders/{id}/pack-profile (If-Match; "0" when the lender still uses the default profile). */
export const LenderPackProfilePutSchema = z
  .object({ documentOrder: PackDocumentOrderSchema, filenamePattern: PackFilenamePatternSchema })
  .strict();
export type LenderPackProfilePut = z.infer<typeof LenderPackProfilePutSchema>;

export const LenderPackProfileSchema = z.object({
  lenderId: z.string(),
  /** true when the lender has no profile of its own and the default below applies. */
  isDefault: z.boolean(),
  documentOrder: z.array(z.string()),
  filenamePattern: z.string(),
  /** lock_version; 0 for the default profile. */
  version: z.number().int(),
  updatedAt: z.string().nullable(),
  updatedBy: z.string().nullable(),
});
export type LenderPackProfile = z.infer<typeof LenderPackProfileSchema>;

export const defaultPackProfile = (lenderId: string): LenderPackProfile => ({
  lenderId,
  isDefault: true,
  documentOrder: [],
  filenamePattern: DEFAULT_PACK_FILENAME_PATTERN,
  version: 0,
  updatedAt: null,
  updatedBy: null,
});

// ---- Ordering and naming --------------------------------------------------------------------------------------------------------

/** The documents in the lender's order: listed types first, in list order; the rest after, in their manifest order. */
export function orderPackDocuments<T extends { documentTypeCode: string }>(
  documents: readonly T[],
  documentOrder: readonly string[],
): T[] {
  const rank = (code: string) => {
    const i = documentOrder.indexOf(code);
    return i === -1 ? documentOrder.length : i;
  };
  return documents
    .map((d, i) => ({ d, i }))
    .sort((a, b) => rank(a.d.documentTypeCode) - rank(b.d.documentTypeCode) || a.i - b.i)
    .map(({ d }) => d);
}

export type PackParty = 'PRIMARY' | 'CO_APPLICANT' | 'GUARANTOR' | null;
const PARTY_TEXT: Record<Exclude<PackParty, null>, string> = {
  PRIMARY: 'Applicant',
  CO_APPLICANT: 'CoApplicant',
  GUARANTOR: 'Guarantor',
};

const MIME_EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/tiff': 'tif',
};

/** Letters, digits and _ . - only; anything else becomes "-", runs collapse, ends are trimmed. */
const clean = (s: string) =>
  s
    .replace(/[^A-Za-z0-9_.-]+/g, '-')
    .replace(/\.{2,}/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');

/** The file's extension: from its original name when it has a short one, otherwise from its type, otherwise "bin". */
export function packFileExtension(originalFileName: string, mimeType: string | null): string {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(originalFileName);
  if (m) return m[1]!.toLowerCase();
  return (mimeType && MIME_EXT[mimeType.toLowerCase()]) || 'bin';
}

/**
 * One file's name in the pack: the pattern with its tokens filled, cleaned, at most 150 characters, plus the extension.
 * {seq} is the 1-based position, {docType} the type code, {party} Applicant / CoApplicant / Guarantor, {original} the uploaded
 * name without its extension. No customer name is a token: names would put personal data into every file name.
 */
export function packFileName(
  pattern: string,
  file: {
    seq: number;
    documentTypeCode: string;
    party: PackParty;
    originalFileName: string;
    mimeType: string | null;
  },
): string {
  const original = file.originalFileName.replace(/\.[A-Za-z0-9]{1,5}$/, '');
  const values: Record<PackFilenameToken, string> = {
    seq: String(file.seq),
    docType: file.documentTypeCode,
    party: file.party ? PARTY_TEXT[file.party] : '',
    original,
  };
  const filled = pattern.replace(/\{(seq|docType|party|original)\}/g, (_, t: PackFilenameToken) => values[t]);
  const base = clean(filled).slice(0, 150) || String(file.seq);
  return `${base}.${packFileExtension(file.originalFileName, file.mimeType)}`;
}
