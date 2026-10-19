// The hosted batch runner's decision logic (owner: Dev 1). No database and no network: it feeds the preflight helper sample outputs and
// checks the runner script for the guards it must keep.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../..');
const HELPER = path.join(ROOT, 'tools/sql/batch/pending.mjs');
const RUNNER = readFileSync(path.join(ROOT, 'tools/sql/batch/run-batch.sh'), 'utf8');

const preflight = (over: Record<string, string> = {}) => {
  const rows = [
    ...[
      'platform realm',
      'flags and master data',
      'data corrections',
      'assignments',
      'rules tables',
      'dsa_app',
    ].map((n) => ({ item: `prerequisite: ${n}`, result: 'PASS' })),
    ...['54', '55', '57', '58', '59', '60', '61', '62', '63', '64'].map((n) => ({
      item: `00${n} already applied? (x)`,
      result: over[n] ?? 'NO',
    })),
    { item: '0065 still needed? (x)', result: over['65'] ?? 'YES' },
    { item: '0054 data step: active users that would be given ROLE-RM (must be 0)', result: over.rm ?? '0' },
    {
      item: '0054 data step: role-less test accounts that would be deactivated (must be 0)',
      result: over.deact ?? '0',
    },
  ];
  if (over.prereq) rows[0] = { item: 'prerequisite: platform realm', result: over.prereq };
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dsa-pre-'));
  const file = path.join(dir, 'preflight.json');
  writeFileSync(file, JSON.stringify({ rows }));
  return file;
};
const pending = (file: string) => spawnSync('node', [HELPER, file], { encoding: 'utf8' });

describe('hosted batch runner', () => {
  it('TEST-RUNNER-01 on the untouched hosted state every migration is pending, in the planned order', () => {
    const r = pending(preflight());
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('54 57 59 60 61 58 55 63 64 65');
  });

  it('TEST-RUNNER-02 after a stop, the migrations already applied are left out and the rest keep their order', () => {
    expect(pending(preflight({ '54': 'YES', '57': 'YES', '59': 'YES' })).stdout.trim()).toBe(
      '60 61 58 55 63 64 65',
    );
    expect(pending(preflight({ '65': 'NO' })).stdout.trim()).toBe('54 57 59 60 61 58 55 63 64');
  });

  it('TEST-RUNNER-03 when everything is applied nothing is pending', () => {
    const all = Object.fromEntries(
      ['54', '55', '57', '58', '59', '60', '61', '63', '64'].map((n) => [n, 'YES']),
    );
    expect(pending(preflight({ ...all, '65': 'NO' })).stdout.trim()).toBe('');
  });

  it('TEST-RUNNER-04 a failing prerequisite, an unreadable output or a missing answer stops the run (exit 1) instead of guessing', () => {
    expect(pending(preflight({ prereq: 'FAIL' })).status).toBe(1);
    const dir = mkdtempSync(path.join(os.tmpdir(), 'dsa-pre-'));
    writeFileSync(path.join(dir, 'bad.json'), 'not json');
    expect(pending(path.join(dir, 'bad.json')).status).toBe(1);
    writeFileSync(
      path.join(dir, 'short.json'),
      JSON.stringify({ rows: [{ item: 'prerequisite: x', result: 'PASS' }] }),
    );
    expect(pending(path.join(dir, 'short.json')).status).toBe(1);
  });

  it('TEST-RUNNER-04b the data steps of 0054 (a default role for role-less users, deactivating orphan test accounts) stop the run unless the operator allows them', () => {
    const blocked = pending(preflight({ rm: '27' }));
    expect(blocked.status).toBe(3);
    expect(blocked.stderr).toMatch(/give ROLE-RM to 27 user/);
    expect(pending(preflight({ deact: '2' })).status).toBe(3);
    const allowed = spawnSync('node', [HELPER, preflight({ rm: '27' })], {
      encoding: 'utf8',
      env: { ...process.env, DSA_ALLOW_0054_DATA_STEPS: '1' },
    });
    expect(allowed.status).toBe(0);
    // once 0054 is applied the counts no longer matter
    expect(pending(preflight({ rm: '27', '54': 'YES' })).status).toBe(0);
  });

  it('TEST-RUNNER-05 the runner refuses any project but the development one, stops on the first error, never reuses a wrapper, and is valid shell', () => {
    expect(RUNNER).toContain('set -euo pipefail');
    expect(RUNNER).toContain('mlpkwwhnagxzinaohdxg');
    expect(RUNNER).toMatch(/Refusing: the linked project/);
    expect(RUNNER).toMatch(/run-\$\(date \+%H%M%S\)/); // a new folder per run
    expect(RUNNER).toMatch(/body equals the migration: YES/);
    expect(RUNNER).toMatch(/grep -q '"FAIL"'/);
    if (process.platform !== 'win32') {
      execFileSync('bash', ['-n', path.join(ROOT, 'tools/sql/batch/run-batch.sh')]);
    }
  });

  it('TEST-RUNNER-06 every migration the runner applies has a verify and a rollback script (0054 has its own)', () => {
    for (const n of ['55', '57', '58', '59', '60', '61', '63', '64', '65']) {
      for (const kind of ['verify', 'rollback'])
        expect(() => readFileSync(path.join(ROOT, `tools/sql/batch/${n}.${kind}.sql`))).not.toThrow();
    }
    for (const f of ['verify.sql', 'rollback.sql'])
      expect(() => readFileSync(path.join(ROOT, 'tools/sql/0054', f))).not.toThrow();
  });
});
