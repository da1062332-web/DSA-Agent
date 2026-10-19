// Merged migrations are never edited (supabase/MANIFEST.md, rule 1). Owner: Dev 1.
// supabase/migrations.lock.json records the sha256 of every migration file. This check fails when a recorded file changed or
// disappeared, so an edit to an applied migration is caught in CI instead of drifting the hosted schema away from a fresh
// `supabase db reset`. A new migration is recorded with --record, which only ever adds entries and never rewrites one.
//   npm run check:migrations -w @dsa/tools            check
//   npm run check:migrations -w @dsa/tools -- --record  check, then record files not yet in the lock
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface LockCheck {
  changed: string[];
  missing: string[];
  unrecorded: string[];
}

/** Line endings are normalised so a Windows checkout hashes the same as CI. */
export const hashMigration = (sql: string): string =>
  createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');

export function checkLock(files: Record<string, string>, lock: Record<string, string>): LockCheck {
  return {
    changed: Object.keys(lock).filter((f) => f in files && files[f] !== lock[f]),
    missing: Object.keys(lock).filter((f) => !(f in files)),
    unrecorded: Object.keys(files).filter((f) => !(f in lock)),
  };
}

function main(): void {
  const root = path.resolve(import.meta.dirname, '..', 'supabase');
  const dir = path.join(root, 'migrations');
  const lockPath = path.join(root, 'migrations.lock.json');
  const files = Object.fromEntries(
    readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .map((f) => [f, hashMigration(readFileSync(path.join(dir, f), 'utf8'))]),
  );
  const lock: Record<string, string> = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, 'utf8')) : {};
  const result = checkLock(files, lock);

  for (const f of result.changed) console.error(`changed after merge: ${f} (add a new migration instead)`);
  for (const f of result.missing) console.error(`recorded migration is gone: ${f}`);
  if (result.changed.length || result.missing.length) process.exit(1);

  if (result.unrecorded.length) {
    if (process.argv.includes('--record')) {
      const next = { ...lock };
      for (const f of result.unrecorded) next[f] = files[f]!;
      const sorted = Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b)));
      writeFileSync(lockPath, `${JSON.stringify(sorted, null, 2)}\n`);
      console.log(`recorded ${result.unrecorded.length} new migration(s): ${result.unrecorded.join(', ')}`);
    } else {
      for (const f of result.unrecorded) console.error(`not recorded: ${f} (run with --record once it is final)`);
      process.exit(1);
    }
  }
  console.log(`migrations unchanged (${Object.keys(files).length} files)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) main();
