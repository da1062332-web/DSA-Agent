// tools/sql/0050/check-backup.mjs — checks a 0050 backup file against the live database. Reads two local files, connects to nothing.
//   npx supabase db query --linked -f tools/sql/0050/live-counts.sql > ~/dsa-backups/0050/live-now.json
//   node tools/sql/0050/check-backup.mjs ~/dsa-backups/0050/backup-before.json ~/dsa-backups/0050/live-now.json
// Run it right before applying: it fails if anything changed since the backup was taken. Exit code 0 only if every row passes.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const [backupPath, livePath] = process.argv.slice(2);
if (!backupPath || !livePath) {
  console.error('Usage: node check-backup.mjs <backup.json> <live-counts.json>');
  process.exit(2);
}
const json = (p) => {
  const t = readFileSync(p, 'utf8');
  return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
};
const b = json(backupPath).rows?.[0]?.backup ?? json(backupPath).backup;
const live = json(livePath).rows?.[0];
if (!b || !live) {
  console.error('Could not read the backup or the live counts.');
  process.exit(2);
}

const rows = [];
const check = (name, ok, detail = '') =>
  rows.push({ ok, line: `${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}` });
check(
  'file is a dsa-0050-backup-v1 backup with every section',
  b.format === 'dsa-0050-backup-v1' &&
    [
      'role_permission',
      'role',
      'tenant',
      'support_access_grant',
      'data_correction_request',
      'feature_flag',
      'master_data_item',
      'policies',
      'constraints',
      'columns',
      'rls',
      'table_grants',
      'functions',
    ].every((k) => Array.isArray(b[k])),
  `taken ${b.taken_at}`,
);
for (const k of [
  'role_permission',
  'role',
  'tenant',
  'support_access_grant',
  'data_correction_request',
  'feature_flag',
  'master_data_item',
]) {
  check(
    `${k}: rows in file = recorded count = live count`,
    b[k].length === b.counts[k] && b.counts[k] === Number(live[k]),
    `file ${b[k].length}, recorded ${b.counts[k]}, live ${live[k]}`,
  );
}
const md5 = createHash('md5')
  .update(
    b.role_permission
      .map((r) => `${r.tenant_id}|${r.role_id}|${r.permission_code}`)
      .sort()
      .join(','),
  )
  .digest('hex');
check(
  'role_permission rows hash to the same value as the live rows (same content)',
  md5 === live.rp_md5,
  `file ${md5}, live ${live.rp_md5}`,
);
const operator = b.role_permission.filter((r) => /^platform\./.test(r.permission_code)).length;
check(
  'the operator grants the migration deletes are in the backup',
  operator > 0,
  `${operator} found (hosted dev: 30)`,
);
check(
  'the original policies and constraints are recorded',
  b.policies.some((p) => p.tablename === 'support_access_grant' && p.policyname === 'tenant_isolation') &&
    b.constraints.some((c) => c.name === 'tenant_tenant_type_check'),
);
const keys = new Set(
  [
    'role_permission',
    'role',
    'tenant',
    'support_access_grant',
    'data_correction_request',
    'feature_flag',
    'master_data_item',
  ].flatMap((k) => b[k].flatMap((r) => Object.keys(r))),
);
const sensitive = [...keys].filter((k) => /password|secret|token|hash|credential/i.test(k));
check(
  'no row in the file has a password, secret, token or hash column',
  sensitive.length === 0,
  sensitive.join(', '),
);

console.log(rows.map((r) => r.line).join('\n'));
console.log(
  `\nsha256 of the backup file: ${createHash('sha256').update(readFileSync(backupPath)).digest('hex')}`,
);
process.exit(rows.every((r) => r.ok) ? 0 : 1);
