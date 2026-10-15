// tools/sql/0050/restore-grants.mjs — prints SQL that puts back every role_permission row recorded in a 0050 backup.
// Used by the rollback. It reads the backup file produced by backup.sql (either the bare JSON object, or the output of
// `npx supabase db query --linked -f tools/sql/0050/backup.sql`) and writes only INSERT ... ON CONFLICT DO NOTHING statements,
// so it is safe to run more than once. It reads a local file and prints to standard output; it connects to nothing.
//
//   node tools/sql/0050/restore-grants.mjs ~/dsa-backups/0050/backup-before.json > restore-grants.sql
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node restore-grants.mjs <backup.json>');
  process.exit(2);
}

const text = readFileSync(file, 'utf8');
const start = text.indexOf('{');
const end = text.lastIndexOf('}');
if (start < 0 || end < start) {
  console.error('No JSON found in the backup file.');
  process.exit(2);
}
const parsed = JSON.parse(text.slice(start, end + 1));
// The CLI wraps results as { rows: [ { backup: {...} } ] }; the bare backup object is also accepted.
const backup = parsed.rows ? parsed.rows[0]?.backup : parsed.backup ?? parsed;
if (!backup || backup.format !== 'dsa-0050-backup-v1' || !Array.isArray(backup.role_permission)) {
  console.error('This is not a dsa-0050-backup-v1 file.');
  process.exit(2);
}
if (backup.counts && backup.counts.role_permission !== backup.role_permission.length) {
  console.error(`The backup is inconsistent: counts say ${backup.counts.role_permission} role_permission rows, the file has ${backup.role_permission.length}.`);
  process.exit(2);
}

const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
const rows = backup.role_permission.map((r) => `  (${lit(r.tenant_id)}, ${lit(r.role_id)}, ${lit(r.permission_code)})`);
console.log(`-- Restores ${rows.length} role_permission rows from the backup taken ${backup.taken_at}.`);
if (rows.length > 0) {
  console.log('INSERT INTO app.role_permission (tenant_id, role_id, permission_code) VALUES');
  console.log(rows.join(',\n'));
  console.log('ON CONFLICT DO NOTHING;');
}
