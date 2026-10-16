// The database URL an integration spec may use (owner: Dev 1). It comes ONLY from the environment that tests/guard/local-db.global-setup.ts
// fills in with a throwaway container, and it must point at this machine. There is no fallback: a spec that cannot find its database
// fails here, before any connection, instead of reaching for the shared hosted project.
const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|\[?::1\]?)$/i;

export function requireLocalTestDatabaseUrl(name: 'DATABASE_URL' | 'VERIFY_DATABASE_URL'): string {
  const url = process.env[name];
  if (!url) {
    throw new Error(
      `${name} is not set. Run integration tests with apps/api/vitest.int.config.ts, which starts a throwaway database and sets it.`,
    );
  }
  const host = new URL(url).hostname;
  if (!LOOPBACK.test(host)) {
    throw new Error(
      `${name} points at "${host}", not at this machine. Integration tests only run against the throwaway local database.`,
    );
  }
  return url;
}

/** For specs that skip themselves when no database is configured: undefined when unset, an error when set to anything but this machine. */
export function resolveLocalTestDatabaseUrl(
  name: 'DATABASE_URL' | 'VERIFY_DATABASE_URL',
): string | undefined {
  if (!process.env[name]) return undefined;
  return requireLocalTestDatabaseUrl(name);
}
