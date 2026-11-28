// Lender pack profile helpers (owner: Dipanshu; task P2-04). Pure: reorder the document type list, check the pattern with the same
// schema the API uses, and preview the file names with the same function the download uses (@dsa/contracts packFileName).
import { PackFilenamePatternSchema, orderPackDocuments, packFileName } from '@dsa/contracts';

/** Moves item i one place up (-1) or down (+1); out of range leaves the list as it is. */
export function move<T>(list: readonly T[], i: number, by: -1 | 1): T[] {
  const j = i + by;
  if (i < 0 || i >= list.length || j < 0 || j >= list.length) return [...list];
  const out = [...list];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}

/** null when the pattern is valid, else the reason in plain words. */
export function patternError(pattern: string): string | null {
  const r = PackFilenamePatternSchema.safeParse(pattern);
  return r.success ? null : (r.error.issues[0]?.message ?? 'Not a valid pattern.');
}

/** Sample files for the preview: the listed types plus one the lender did not list, as a customer upload. */
export function previewNames(documentOrder: readonly string[], pattern: string): string[] {
  if (patternError(pattern)) return [];
  const sample = [
    { documentTypeCode: 'OTHER', originalFileName: 'extra document.pdf' },
    ...documentOrder.map((code) => ({
      documentTypeCode: code,
      originalFileName: `${code.toLowerCase()} scan.pdf`,
    })),
  ];
  return orderPackDocuments(sample, documentOrder).map((d, i) =>
    packFileName(pattern, {
      seq: i + 1,
      documentTypeCode: d.documentTypeCode,
      party: 'PRIMARY',
      originalFileName: d.originalFileName,
      mimeType: 'application/pdf',
    }),
  );
}
