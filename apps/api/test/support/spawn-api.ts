// Starts the REAL API server process (src/server.ts) for restart tests. The child gets an explicit environment: no .env file and no
// hosted URL, only the throwaway database it is told about and a local-looking Supabase URL that is never contacted (test tokens are
// accepted only for local URLs). Kill it with stop(); starting another one afterwards is a restart with an empty memory.
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

const API_DIR = path.resolve(__dirname, '../..');
export const LOCAL_SUPABASE_URL = 'http://127.0.0.1:54321';
export const LOCAL_JWT_SECRET = 'local-restart-test-secret-0123456789abcdef';

export type RunningApi = { port: number; child: ChildProcess; log: () => string; stop: () => Promise<void> };

let nextPort = 39100 + Math.floor(Math.random() * 500);

/** dsa_api's connection string for a harness database (host and port are those of the local container). */
export function apiRoleUrl(admin: { host: string; port: number; database?: string }): string {
  return `postgresql://dsa_api:isolation@${admin.host}:${admin.port}/${admin.database ?? 'postgres'}`;
}

export async function startApi(databaseUrl: string): Promise<RunningApi> {
  const host = new URL(databaseUrl).hostname;
  if (!/^(localhost|127(\.\d{1,3}){3}|\[?::1\]?)$/i.test(host)) throw new Error(`refusing to start the API against a non-local database (${host})`);

  const port = nextPort++;
  let out = '';
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd: API_DIR,
    env: {
      PATH: process.env.PATH ?? '',
      SystemRoot: process.env.SystemRoot ?? '',
      NODE_ENV: 'test',
      PORT: String(port),
      LOG_LEVEL: 'error',
      DATABASE_URL: databaseUrl,
      SUPABASE_URL: LOCAL_SUPABASE_URL,
      SUPABASE_JWT_SECRET: LOCAL_JWT_SECRET,
      TEST_TOKENS: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (d) => (out += d));
  child.stderr?.on('data', (d) => (out += d));
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));

  const deadline = Date.now() + 60_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`server exited early: ${out.slice(-800)}`);
    try {
      if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) {
      child.kill();
      throw new Error(`server did not start: ${out.slice(-800)}`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return {
    port,
    child,
    log: () => out,
    stop: async () => {
      child.kill();
      await exited;
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper: callers read fields of whatever the API returned
type Json = any;

export async function call(
  api: RunningApi,
  token: string,
  method: string,
  p: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Json; etag: string | null }> {
  const r = await fetch(`http://127.0.0.1:${api.port}${p}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `idem-${Date.now()}-${Math.random()}`,
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null, etag: r.headers.get('etag') };
}
