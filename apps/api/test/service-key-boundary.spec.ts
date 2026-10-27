// Architecture B boundary (ADR-SB-02): the HTTP API never reads, holds or uses the Supabase service-role key, and never writes a tenant
// claim. Only the provisioning code (src/provisioning, run by tools/provisioning-worker.ts) does. These checks read the source tree, so a
// change that brings the key or the provisioning code into the API fails here.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig, scrubProvisioningSecrets } from '../src/config';

const SRC = path.resolve(import.meta.dirname, '../src');
const PROVISIONING = path.join(SRC, 'provisioning');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return full === PROVISIONING ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

const apiFiles = sourceFiles(SRC);
const rel = (f: string) => path.relative(SRC, f).replace(/\\/g, '/');

describe('the HTTP API holds no service-role key', () => {
  it('TEST-KEYB-01 no API source outside src/provisioning reads SUPABASE_SERVICE_ROLE_KEY except to remove it', () => {
    const readers = apiFiles.filter((f) => readFileSync(f, 'utf8').includes('SUPABASE_SERVICE_ROLE_KEY'));
    // config.ts names it only in PROVISIONING_ONLY_SECRETS, the list the API deletes from its own environment.
    expect(readers.map(rel)).toEqual(['config.ts']);
    expect(readFileSync(path.join(SRC, 'config.ts'), 'utf8')).toMatch(
      /PROVISIONING_ONLY_SECRETS = \['SUPABASE_SERVICE_ROLE_KEY'\]/,
    );
  });

  it('TEST-KEYB-02 no API source imports the provisioning code', () => {
    const importers = apiFiles.filter((f) =>
      /from ['"][^'"]*provisioning['"/]/.test(readFileSync(f, 'utf8')),
    );
    expect(importers.map(rel)).toEqual([]);
  });

  it('TEST-KEYB-03 no API source calls Supabase Auth administration, and none sets a tenant claim on an Auth account', () => {
    const adminCalls = apiFiles.filter((f) =>
      /\/auth\/v1\/(admin|invite|recover)/.test(readFileSync(f, 'utf8')),
    );
    expect(adminCalls.map(rel)).toEqual([]);
    // The only app_metadata in API code is the payload of the test-login token, which the API signs itself for local tests (test-auth.ts
    // gates it). It is not written to any Supabase account.
    const claimWriters = apiFiles.filter((f) => /app_metadata\s*:/.test(readFileSync(f, 'utf8')));
    expect(claimWriters.map(rel)).toEqual(['http/public-auth-router.ts']);
  });

  it('TEST-KEYB-04 the API configuration has no service-role key, and start-up removes one left in the environment', () => {
    const env: NodeJS.ProcessEnv = {
      DATABASE_URL: 'postgres://dsa_api:x@127.0.0.1:5432/postgres',
      SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_SERVICE_ROLE_KEY: 'a-service-role-key-the-api-must-drop-0123',
    };
    expect(Object.keys(loadConfig(env))).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(scrubProvisioningSecrets(env)).toEqual(['SUPABASE_SERVICE_ROLE_KEY']);
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
    expect(scrubProvisioningSecrets(env)).toEqual([]);
  });

  it('TEST-KEYB-05 the server removes the key before it reads its configuration', () => {
    const server = readFileSync(path.join(SRC, 'server.ts'), 'utf8');
    const scrub = server.indexOf('scrubProvisioningSecrets()');
    expect(scrub).toBeGreaterThan(-1);
    expect(scrub).toBeLessThan(server.indexOf('loadConfig()'));
  });
});
