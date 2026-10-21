/* global process, console */
// Reads the JSON that `supabase db query -f tools/sql/audit-batch/preflight.sql` printed and says which migrations of the audit batch
// still have to be applied, in order. It never connects to anything.
//
//   node tools/sql/audit-batch/pending.mjs <preflight.json>   prints e.g. "66 69 70 71 ... 84" (or fewer on a re-run)
//
// Exit 1 (and a reason on stderr) if a prerequisite is not PASS or an answer is missing, so the runner stops instead of guessing.
import { readFileSync } from 'node:fs';

export const ORDER = [
  '66',
  '69',
  '70',
  '71',
  '72',
  '73',
  '74',
  '75',
  '76',
  '77',
  '78',
  '79',
  '80',
  '81',
  '82',
  '83',
  '84',
];

export function pendingFrom(rows) {
  const prerequisites = rows.filter((r) => String(r.item).startsWith('prerequisite'));
  const failing = prerequisites.filter((r) => r.result !== 'PASS');
  if (prerequisites.length === 0 || failing.length > 0) {
    throw new Error(
      `A prerequisite is missing or failing: ${failing.map((r) => r.item).join('; ') || 'none reported'}`,
    );
  }
  return ORDER.filter((n) => {
    const row = rows.find((r) => String(r.item).startsWith(`00${n} still needed`));
    if (!row || (row.result !== 'YES' && row.result !== 'NO'))
      throw new Error(`The preflight has no clear answer for 00${n}.`);
    return row.result === 'YES';
  });
}

if (process.argv[1] && process.argv[1].endsWith('pending.mjs')) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node tools/sql/audit-batch/pending.mjs <preflight.json>');
    process.exit(2);
  }
  const text = readFileSync(file, 'utf8');
  let rows;
  try {
    const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    rows = parsed.rows ?? parsed;
    if (!Array.isArray(rows)) throw new Error('no rows');
    console.log(pendingFrom(rows).join(' '));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
