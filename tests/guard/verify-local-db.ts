// Run before a suite uses a database: proves that the connection string the tests will use points at the throwaway
// container this process just started, on this machine, and not at any other database. It writes the container's id into
// the database as a setting, then reads it back over the given connection string. A hosted database cannot answer with an id
// that only exists in this process. Any mismatch throws, so the whole suite stops before a single test runs.
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';

const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|\[?::1\]?)$/i;

export async function assertThrowawayDatabase(
  container: StartedPostgreSqlContainer,
  admin: pg.Client,
  connectionUrls: string[],
): Promise<void> {
  const id = container.getId();
  // The database name comes from the container itself; it is not user input.
  await admin.query(`ALTER DATABASE "${container.getDatabase()}" SET dsa.test_container = '${id}'`);

  for (const url of connectionUrls) {
    const host = new URL(url).hostname;
    if (!LOOPBACK.test(host)) {
      throw new Error(`Test database check failed: the connection string points at "${host}", not at the local machine.`);
    }
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      const { rows } = await client.query<{ marker: string | null }>(`SELECT current_setting('dsa.test_container', true) AS marker`);
      if (rows[0]?.marker !== id) {
        throw new Error('Test database check failed: the database behind this connection string is not the throwaway container.');
      }
    } finally {
      await client.end();
    }
  }
}
