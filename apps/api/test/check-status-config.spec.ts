// check_status.cjs reads its hosted connection string from the environment, and refuses to run without it, printing no connection detail.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../../check_status.cjs', import.meta.url));

describe('check_status.cjs configuration (TEST-CHKSTAT)', () => {
  it('TEST-CHKSTAT-01 the script holds no connection string and reads the variable it names', () => {
    const source = readFileSync(SCRIPT, 'utf8');
    expect(source).not.toMatch(/postgres(ql)?:\/\/[^\s'"]*@/);
    expect(source).toContain('process.env.HOSTED_CHECK_DATABASE_URL');
  });

  it('TEST-CHKSTAT-02 without the variable it exits with an error, prints nothing to stdout, and shows no connection detail', () => {
    const env = { ...process.env };
    delete env.HOSTED_CHECK_DATABASE_URL;
    const run = spawnSync(process.execPath, [SCRIPT], { env, encoding: 'utf8', timeout: 20_000 });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('HOSTED_CHECK_DATABASE_URL is not set');
    expect(run.stdout).toBe('');
    expect(run.stderr).not.toMatch(/postgres/i);
  });

  it('TEST-CHKSTAT-03 TLS is always verified: the script never turns certificate checks off', () => {
    const source = readFileSync(SCRIPT, 'utf8');
    expect(source).not.toMatch(/rejectUnauthorized\s*:\s*false/);
    expect(source).toMatch(/rejectUnauthorized\s*:\s*true/);
    expect(source).toContain('HOSTED_CHECK_CA_FILE');
  });

  it('TEST-CHKSTAT-04 a CA file that cannot be read stops the run before any connection is made', () => {
    const env = {
      ...process.env,
      HOSTED_CHECK_DATABASE_URL: 'postgresql://127.0.0.1:1/postgres',
      HOSTED_CHECK_CA_FILE: '/nonexistent/dsa-pooler-ca.pem',
    };
    const run = spawnSync(process.execPath, [SCRIPT], { env, encoding: 'utf8', timeout: 20_000 });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('HOSTED_CHECK_CA_FILE is set but cannot be read');
    expect(run.stderr).not.toMatch(/ECONNREFUSED|connect/i);
    expect(run.stdout).toBe('');
  });
});
