// Process entry point (owner: Dev 1). The dependencies come from wiring.ts, the same function the database test harnesses use.
import dns from 'node:dns';

// Ensure IPv4 is resolved first on dual-stack networks (prevents ENOTFOUND on Windows with pooler.supabase.com)
try {
  dns.setDefaultResultOrder('ipv4first');
} catch {
  // Ignore on environments where setDefaultResultOrder is unavailable
}

import { createPrincipalResolver, createTokenVerifier } from '@dsa/kernel';
import { pino } from 'pino';
import { createApp } from './app';
import { loadConfig, type ApiConfig } from './config';
import { supabaseAuth } from './http/supabase-auth';
import { createDb } from './kernel-min/db';
import { checkDatabase } from './startup-check';
import { createTxRunner } from './kernel-min/tx-runner';
import { registeredCorrectionScripts } from './modules/platform-admin/correction-scripts';
import {
  DataCorrectionExecutor,
  startDataCorrectionExecutor,
} from './modules/platform-admin/data-correction-executor';
import { OutboxRelay } from './modules/platform/outbox-relay';
import { createWebhookDeliveryHandler, WEBHOOK_DELIVERY_JOB } from './modules/partner-api/webhooks';
import { createUserTransferHandler, USER_TRANSFER_JOB } from './modules/platform/user-lifecycle';
import { startBackgroundWorker } from './modules/platform/worker';
import { createOutboxSubscribers, createProductionDeps } from './wiring';
import {
  createDocumentArchiveHandler,
  DOCUMENT_ARCHIVE_JOB,
} from './modules/origination/applications/documents';
import { globalJobQueue } from './modules/platform/job-queue';

let config: ApiConfig;
try {
  config = loadConfig();
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

// Development prints one readable line per message; other environments keep JSON for the log collector.
const logger = pino({
  level: config.LOG_LEVEL,
  ...(config.NODE_ENV === 'development'
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      }
    : {}),
});
if (config.DISABLE_MFA) logger.warn('DISABLE_MFA is on: MFA is skipped. This is for local development only.');
const db = createDb(config.DATABASE_URL);
const txRunner = createTxRunner(db);
// Signed document links and archive encryption use keys derived from the deployment's JWT secret.
const signingSecret = config.APP_SIGNING_SECRET ?? config.SUPABASE_JWT_SECRET;
if (!signingSecret) {
  logger.warn(
    'APP_SIGNING_SECRET is not set: document links work only until this API restarts, and webhook subscriptions are refused. Set it in apps/api/.env.',
  );
}
const deps = createProductionDeps(txRunner, { documentLinkSecret: signingSecret });
globalJobQueue.registerHandler(DOCUMENT_ARCHIVE_JOB, createDocumentArchiveHandler(deps));
globalJobQueue.registerHandler(USER_TRANSFER_JOB, createUserTransferHandler(deps));
globalJobQueue.registerHandler(WEBHOOK_DELIVERY_JOB, createWebhookDeliveryHandler(deps));

const app = createApp({
  deps,
  corsAllowedOrigins: config.CORS_ALLOWED_ORIGINS,
  logger,
  supabaseUrl: config.SUPABASE_URL,
  bypassSecret: config.BYPASS_JWT_SECRET,
  bypassOtp: config.TEST_BYPASS_OTP,
  auth: supabaseAuth({
    verifier: createTokenVerifier({
      supabaseUrl: config.SUPABASE_URL,
      jwtSecret: config.SUPABASE_JWT_SECRET,
      bypassSecret: config.BYPASS_JWT_SECRET,
    }),
    resolver: createPrincipalResolver(txRunner),
  }),
});

const server = app.listen(config.PORT, () => {
  logger.info(`API listening on http://localhost:${config.PORT} (${config.NODE_ENV})`);
  void checkDatabase(db, config.DATABASE_URL).then((status) => {
    if (!status.connected) {
      logger.error(`Database NOT connected (${status.host}, ${status.mode}): ${status.reason}`);
      return;
    }
    logger.info(`Database connected: ${status.database} on ${status.host} (${status.mode})`);
    if (status.missingMigrations.length > 0) {
      logger.warn(
        `Database is missing migrations ${status.missingMigrations.join(', ')}: the features that need them will fail until they are applied (tools/sql/audit-batch/README.md)`,
      );
    }
  });
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
const formatWorkerError = (err: unknown): string => {
  if (err instanceof Error) {
    return err.message || err.name || 'Error';
  }
  if (typeof err === 'object' && err !== null) {
    return (err as any).message || (err as any).error || JSON.stringify(err);
  }
  return String(err || 'unknown');
};

const worker = startBackgroundWorker({
  txRunner,
  outboxRelay: new OutboxRelay({ txRunner, subscribers: createOutboxSubscribers(deps) }),
  onWarning: (message) => logger.warn(`Background worker: ${message}`),
  onError: (stage, err) =>
    logger.error(
      { stage, error: formatWorkerError(err) },
      'background worker tick failed',
    ),
});

logger.info('Background worker started (outbox relay and jobs, every 2 seconds)');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    logger.info({ signal }, 'shutting down');
    worker.stop();
    server.close(() => {
      void db.destroy().finally(() => process.exit(0));
    });
  });
}
