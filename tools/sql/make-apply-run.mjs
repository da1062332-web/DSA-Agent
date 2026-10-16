/* global process, console */
// Builds the wrapper that is applied to the hosted database for ONE migration (owner: Dev 1; migration runbooks, see tools/sql/0050 and 0054).
// The wrapper is BEGIN; + the migration file, byte for byte, + COMMIT;, so the whole migration succeeds or none of it does.
// It is generated from the migration at the moment you run this, never kept as a hand-maintained copy that could drift, and it is written
// OUTSIDE the repository. This tool only writes a file: it never connects to any database.
//
//   node tools/sql/make-apply-run.mjs <migration.sql> <output-dir>
//
// It prints the SHA-256 of the migration and of the wrapper and proves the wrapper's body equals the migration. Refuses to overwrite.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [migrationArg, outArg] = process.argv.slice(2);
if (!migrationArg || !outArg) {
  console.error('usage: node tools/sql/make-apply-run.mjs <migration.sql> <output-dir>');
  process.exit(2);
}

const repoRoot = path.resolve(import.meta.dirname, '../..');
const migrationPath = path.resolve(migrationArg);
const outDir = path.resolve(outArg.replace(/^~(?=$|[\\/])/, os.homedir()));
if (outDir.startsWith(repoRoot + path.sep) || outDir === repoRoot) {
  console.error(
    'Refusing: the output directory is inside the repository. Wrappers and backups stay outside it (for example ~/dsa-backups/<n>/).',
  );
  process.exit(2);
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const migration = readFileSync(migrationPath);
const name = path.basename(migrationPath);
const wrapper = Buffer.concat([
  Buffer.from(
    `-- Apply wrapper for ${name}\n-- Generated ${new Date().toISOString()} from the migration file below, unchanged. One transaction: all of it or none of it.\nBEGIN;\n\n`,
  ),
  migration,
  Buffer.from(migration.at(-1) === 0x0a ? '\nCOMMIT;\n' : '\n\nCOMMIT;\n'),
]);

mkdirSync(outDir, { recursive: true });
const target = path.join(outDir, 'apply-run.sql');
if (existsSync(target)) {
  console.error(`Refusing to overwrite ${target}. Move or delete it yourself first.`);
  process.exit(2);
}
writeFileSync(target, wrapper);

// Prove it: the migration must be found, byte for byte, between BEGIN; and COMMIT;
const written = readFileSync(target);
const start = written.indexOf(Buffer.from('BEGIN;\n\n')) + 'BEGIN;\n\n'.length;
const end = written.lastIndexOf(Buffer.from('COMMIT;'));
const body = written.subarray(start, end).toString('utf8').replace(/\s+$/, '');
const same = body === migration.toString('utf8').replace(/\s+$/, '');
console.log(`migration : ${name}`);
console.log(`source    : ${sha256(migration)}`);
console.log(`wrapper   : ${sha256(written)}  (${target})`);
console.log(`body equals the migration: ${same ? 'YES' : 'NO - do not use this file'}`);
process.exit(same ? 0 : 1);
