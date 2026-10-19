// Process entry point (owner: Dev 1). The dependencies come from wiring.ts, the same function the database test harnesses use.
import { createPrincipalResolver, createTokenVerifier } from '@dsa/kernel';
import { pino } from 'pino';
import { createApp } from './app';
import { loadConfig, type ApiConfig } from './config';
import { supabaseAuth } from './http/supabase-auth';
import { createDb } from './kernel-min/db';
import { createTxRunner } from './kernel-min/tx-runner';
import { registeredCorrectionScripts } from './modules/platform-admin/correction-scripts';
import {
  DataCorrectionExecutor,
  startDataCorrectionExecutor,
} from './modules/platform-admin/data-correction-executor';
import { OutboxRelay } from './modules/platform/outbox-relay';
import { startBackgroundWorker } from './modules/platform/worker';
import { createOutboxSubscribers, createProductionDeps } from './wiring';

let config: ApiConfig;
try {
  config = loadConfig();
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

const logger = pino({ level: config.LOG_LEVEL });
if (config.DISABLE_MFA) logger.warn('DISABLE_MFA is on: MFA is skipped. This is for local development only.');
const db = createDb(config.DATABASE_URL);
const txRunner = createTxRunner(db);
const deps = createProductionDeps(txRunner);

const app = createApp({
  deps,
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

// Carries out APPROVED data corrections. Off unless DATA_CORRECTION_EXECUTOR=true, because it changes tenant data.
if (config.DATA_CORRECTION_EXECUTOR) {
  logger.warn(
    { registeredScripts: registeredCorrectionScripts.size },
    'DATA_CORRECTION_EXECUTOR is on: approved data corrections will be carried out by the reviewed scripts.',
  );
  startDataCorrectionExecutor(
    new DataCorrectionExecutor({ txRunner, audit: deps.audit, scripts: registeredCorrectionScripts }),
    {
      onOutcome: (o) =>
        logger.info(
          { correctionId: o.id, tenantId: o.tenantId, outcome: o.outcome },
          'data correction processed',
        ),
      onError: (err) =>
        logger.error(
          { error: err instanceof Error ? err.message : 'unknown' },
          'data correction executor tick failed',
        ),
    },
  );
}

// Publishes outbox events to their subscribers (automation triggers), and runs queued jobs and storage retention.
const worker = startBackgroundWorker({
  txRunner,
  outboxRelay: new OutboxRelay({ txRunner, subscribers: createOutboxSubscribers(deps) }),
  onError: (stage, err) =>
    logger.error({ stage, error: err instanceof Error ? err.message : 'unknown' }, 'background worker tick failed'),
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    logger.info({ signal }, 'shutting down');
    worker.stop();
    server.close(() => {
      void db.destroy().finally(() => process.exit(0));
    });
  });
}
