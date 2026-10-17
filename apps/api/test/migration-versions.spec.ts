// Migration numbering (owner: Dev 1). Tools that key migrations by version (supabase db push, migration repair) treat two files with
// the same number as a duplicate, and the manifest is how the team finds who owns which number.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../../supabase');
const files = readdirSync(path.join(ROOT, 'migrations'))
  .filter((f) => f.endsWith('.sql'))
  .sort();
const manifest = readFileSync(path.join(ROOT, 'MANIFEST.md'), 'utf8');
const rows = [...manifest.matchAll(/^\| (M-\d+) \| `([^`]+\.sql)`/gm)].map((m) => ({
  id: m[1]!,
  file: m[2]!,
}));

// Known duplicates that still have to be renumbered by their owners. Remove an entry when it is fixed (TEST-MIG-04 insists).
// Empty since the security migration moved from 0043 to 0063 (its content is byte-identical).
const KNOWN_DUPLICATES: string[] = [];

const duplicateVersions = () => {
  const byVersion = new Map<string, string[]>();
  for (const f of files) byVersion.set(f.split('_')[0]!, [...(byVersion.get(f.split('_')[0]!) ?? []), f]);
  return [...byVersion].filter(([, fs]) => fs.length > 1);
};

describe('migration numbering', () => {
  it('TEST-MIG-01 every migration has its own version number (the part before the first underscore), apart from the known list', () => {
    const duplicates = duplicateVersions()
      .filter(([v]) => !KNOWN_DUPLICATES.includes(v))
      .map(([v, fs]) => `${v}: ${fs.join(', ')}`);
    expect(duplicates).toEqual([]);
  });

  it('TEST-MIG-04 the known-duplicate list only names versions that are still duplicated', () => {
    const still = duplicateVersions().map(([v]) => v);
    expect(KNOWN_DUPLICATES.filter((v) => !still.includes(v))).toEqual([]);
  });

  it('TEST-MIG-02 every manifest row names a migration that exists, and no M-number is used twice', () => {
    const missing = rows.filter((r) => !files.includes(r.file)).map((r) => `${r.id} ${r.file}`);
    expect(missing).toEqual([]);
    const ids = rows.map((r) => r.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });

  it('TEST-MIG-03 the manifest number matches the migration number', () => {
    const wrong = rows
      .filter((r) => Number(r.id.slice(2)) !== Number(r.file.split('_')[0]!.slice(-3)))
      .map((r) => `${r.id} ${r.file}`);
    expect(wrong).toEqual([]);
  });
});
