// Process entry point (owner: Dev 1).
import {
  createAuditPort,
  createAuthz,
  createIdGenerator,
  createPrincipalResolver,
  createTokenVerifier,
  createUserDirectory,
} from '@dsa/kernel';
import { pino } from 'pino';
import { createApp } from './app';
import { loadConfig, type ApiConfig } from './config';
import { supabaseAuth } from './http/supabase-auth';
import { createDb } from './kernel-min/db';
import { createTxRunner } from './kernel-min/tx-runner';
import { createApplicationSubjectPort } from './modules/origination/applications/subject-port';
import { createLenderPort } from './modules/origination/catalogue/lender-port';
import { createProductVersionPort } from './modules/origination/catalogue/product-version-port';

let config: ApiConfig;
try {
  config = loadConfig();
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

const logger = pino({ level: config.LOG_LEVEL });
const db = createDb(config.DATABASE_URL);
const txRunner = createTxRunner(db);
const ids = createIdGenerator();
const app = createApp({
  deps: {
    txRunner,
    authz: createAuthz(),
    audit: createAuditPort(ids),
    ids,
    userDirectory: createUserDirectory(),
    complaintSubjectPort: createApplicationSubjectPort(),
    productVersionPort: createProductVersionPort(),
    lenderPort: createLenderPort(),
  },
  corsAllowedOrigins: config.CORS_ALLOWED_ORIGINS,
  logger,
  auth: supabaseAuth({
    verifier: createTokenVerifier({
      supabaseUrl: config.SUPABASE_URL,
      jwtSecret: config.SUPABASE_JWT_SECRET,
    }),
    resolver: createPrincipalResolver(txRunner),
  }),
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
