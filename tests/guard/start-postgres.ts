// Starts a throwaway PostgreSQL container for the integration and rehearsal suites (owner: Dev 1).
// Docker Desktop on Windows sometimes answers the container inspection before the published port exists, and Testcontainers then throws
// "No host port found for host IP" even though nothing is wrong with the test (seen on 2026-10-17 in a four-process run). That one start-up
// error, and only that one, is retried. Anything else, and every failure inside a test, is thrown as it is: nothing here hides a real failure.
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

const KNOWN_STARTUP_RACE = /No host port found/i;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function startPostgres(image?: string): Promise<StartedPostgreSqlContainer> {
  const wanted = image ?? process.env.DSA_PG_IMAGE ?? 'postgres:16';
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await new PostgreSqlContainer(wanted).start();
    } catch (error) {
      lastError = error;
      if (!KNOWN_STARTUP_RACE.test(String((error as Error)?.message ?? error))) throw error;
      await sleep(2_000 * attempt);
    }
  }
  throw lastError;
}
