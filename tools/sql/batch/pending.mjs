/* global process, console */
// Reads the JSON that `supabase db query -f tools/sql/batch/preflight.sql` printed and says which migrations of the batch still have to be
// applied, in order. It never connects to anything.
//
//   node tools/sql/batch/pending.mjs <preflight.json>      prints e.g.  "54 57 59 60 61 58 55 63 64 65"  (or fewer on a re-run)
//
// Exit 1 (and a reason on stderr) if a prerequisite is not PASS or the output cannot be read, so the runner stops instead of guessing.
import { readFileSync } from 'node:fs';

const ORDER = ['54', '57', '59', '60', '61', '58', '55', '63', '64', '65'];
const file = process.argv[2];
if (!file) {
  console.error('usage: node tools/sql/batch/pending.mjs <preflight.json>');
  process.exit(2);
}

const text = readFileSync(file, 'utf8');
const start = text.indexOf('{');
const end = text.lastIndexOf('}');
let rows;
try {
  const parsed = JSON.parse(text.slice(start, end + 1));
  rows = parsed.rows ?? parsed;
  if (!Array.isArray(rows)) throw new Error('no rows');
} catch (error) {
  console.error(`Cannot read the preflight output: ${error.message}`);
  process.exit(1);
}

const failing = rows.filter((r) => String(r.item).startsWith('prerequisite') && r.result !== 'PASS');
if (failing.length > 0 || rows.filter((r) => String(r.item).startsWith('prerequisite')).length === 0) {
  console.error(
    `A prerequisite is missing or failing: ${failing.map((r) => r.item).join('; ') || 'none reported'}`,
  );
  process.exit(1);
}

const answer = (number, wording) => {
  const row = rows.find((r) => String(r.item).startsWith(`00${number} ${wording}`));
  if (!row || (row.result !== 'YES' && row.result !== 'NO')) {
    console.error(`The preflight has no clear answer for 00${number}.`);
    process.exit(1);
  }
  return row.result === 'YES';
};

// Migration 0054 also changes data: it gives ROLE-RM to every active user who has no role (where the tenant has that role) and deactivates
// role-less test accounts. 0054's rollback does not undo that, so the runner stops unless both counts are 0 (hosted on 2026-10-17: 0 and 0)
// or the operator has looked at the numbers and set DSA_ALLOW_0054_DATA_STEPS=1.
const dataStep = (wording) => {
  const row = rows.find((r) => String(r.item).startsWith(`0054 data step: ${wording}`));
  if (!row || !/^\d+$/.test(String(row.result))) {
    console.error('The preflight has no clear count for the data steps of 0054.');
    process.exit(1);
  }
  return Number(row.result);
};
const roleDefaults = dataStep('active users that would be given');
const deactivations = dataStep('role-less test accounts');

const pending = ORDER.filter((n) =>
  n === '65' ? answer(n, 'still needed?') : !answer(n, 'already applied?'),
);
if (
  pending.includes('54') &&
  roleDefaults + deactivations > 0 &&
  process.env.DSA_ALLOW_0054_DATA_STEPS !== '1'
) {
  console.error(
    `Stopping: migration 0054 would give ROLE-RM to ${roleDefaults} user(s) and deactivate ${deactivations} account(s), and its rollback cannot undo that. ` +
      'Look at who they are; if that is intended, run again with DSA_ALLOW_0054_DATA_STEPS=1.',
  );
  process.exit(3);
}
console.log(pending.join(' '));
