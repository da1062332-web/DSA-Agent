// Dedicated background worker process (owner: Dev 1). Runs outbox relay, platform jobs and storage cleanup.
import dns from 'node:dns';

try {
  dns.setDefaultResultOrder('ipv4first');
} catch {
  // Ignore on environments where setDefaultResultOrder is unavailable
}

import { pino } from 'pino';
import { loadConfig, scrubProvisioningSecrets, type ApiConfig } from './config';
import { redactSecrets, registerDatabaseUrl, registerSecrets } from './http/redact';
import { createDb } from './kernel-min/db';
import { checkDatabase } from './startup-check';
import { createTxRunner } from './kernel-min/tx-runner';
import { OutboxRelay } from './modules/platform/outbox-relay';
import { createWebhookDeliveryHandler, WEBHOOK_DELIVERY_JOB } from './modules/partner-api/webhooks';
import { createUserTransferHandler, USER_TRANSFER_JOB } from './modules/platform/user-lifecycle';
import { startBackgroundWorker } from './modules/platform/worker';
import { createOutboxSubscribers, createProductionDeps } from './wiring';
import {
  FallbackSignatureFileScanner,
  documentBackendsFromConfig,
} from './modules/origination/applications/document-backends';
import {
} from './modules/origination/applications/documents';
import { globalJobQueue } from './modules/platform/job-queue';

// Remove provisioning secrets from memory
scrubProvisioningSecrets();

let config: ApiConfig;
try {
  config = loadConfig();
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

registerDatabaseUrl(config.DATABASE_URL);
registerSecrets([config.SUPABASE_JWT_SECRET, config.APP_SIGNING_SECRET, config.BYPASS_JWT_SECRET]);

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

logger.info(`Starting dedicated background worker (${config.NODE_ENV})...`);

const db = createDb(config.DATABASE_URL);
const txRunner = createTxRunner(db);
const signingSecret = config.APP_SIGNING_SECRET ?? config.SUPABASE_JWT_SECRET;
const documentBackends = documentBackendsFromConfig(config);
let documentScanner = documentBackends.documentScanner;
if (!documentScanner && (config.NODE_ENV !== 'production' || config.ALLOW_INSECURE_UPLOADS)) {
  documentScanner = new FallbackSignatureFileScanner();
}

const deps = createProductionDeps(txRunner, {
  documentLinkSecret: signingSecret,
  ...documentBackends,
  documentScanner,
});
globalJobQueue.registerHandler(USER_TRANSFER_JOB, createUserTransferHandler(deps));
globalJobQueue.registerHandler(WEBHOOK_DELIVERY_JOB, createWebhookDeliveryHandler(deps));

void checkDatabase(db, config.DATABASE_URL).then((status) => {
  if (!status.connected) {
    logger.error(`Database NOT connected (${status.host}): ${redactSecrets(status.reason)}`);
    return;
  }
  logger.info(`Database connected for background worker: ${status.database} on ${status.host}`);
});

const formatWorkerError = (err: unknown): string => {
  if (err instanceof Error) return err.message || err.name || 'Error';
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
      { stage, error: redactSecrets(formatWorkerError(err)) },
      'background worker tick failed',
    ),
});

logger.info('Dedicated background worker is running (interval: 2 seconds)');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    logger.info({ signal }, 'worker shutting down cleanly');
    worker.stop();
    void db.destroy().finally(() => {
      logger.info('worker process exited');
      process.exit(0);
    });
  });
}
