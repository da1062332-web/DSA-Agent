// Process entry point (owner: Dev 1).
import { pino } from 'pino';
import { createApp } from './app';
import { loadConfig, type ApiConfig } from './config';
import { createDb } from './kernel-min/db';
import { createTxRunner } from './kernel-min/tx-runner';

let config: ApiConfig;
try {
  config = loadConfig();
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

const logger = pino({ level: config.LOG_LEVEL });
const db = createDb(config.DATABASE_URL);
const app = createApp({
  deps: { txRunner: createTxRunner(db) },
  corsAllowedOrigins: config.CORS_ALLOWED_ORIGINS,
  logger,
  db,
});

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, 'api listening');
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    logger.info({ signal }, 'shutting down');
    server.close(() => {
      void db.destroy().finally(() => process.exit(0));
    });
  });
}
