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
import { loadConfig, scrubProvisioningSecrets, type ApiConfig } from './config';
import { resolveTestAuth } from './test-auth';
import { redactSecrets, registerDatabaseUrl, registerSecrets } from './http/redact';
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
import {
  createInvitationAcceptedAudit,
  createUserTransferHandler,
  USER_TRANSFER_JOB,
} from './modules/platform/user-lifecycle';
import { startBackgroundWorker } from './modules/platform/worker';
import { createOutboxSubscribers, createProductionDeps } from './wiring';
import { documentBackendsFromConfig } from './modules/origination/applications/document-backends';
import {
  createDocumentArchiveHandler,
  DOCUMENT_ARCHIVE_JOB,
} from './modules/origination/applications/documents';
import { globalJobQueue } from './modules/platform/job-queue';

// The HTTP API never holds the service-role key (ADR-SB-02, Architecture B): only the provisioning worker does. It is removed from this
// process before anything else reads the environment.
const scrubbedSecrets = scrubProvisioningSecrets();

let config: ApiConfig;
try {
  config = loadConfig();
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

// Secrets the process must never print. A driver message can carry the connection string, and a stack trace repeats the message.
registerDatabaseUrl(config.DATABASE_URL);
registerSecrets([config.SUPABASE_JWT_SECRET, config.APP_SIGNING_SECRET, config.BYPASS_JWT_SECRET]);

// Development prints one readable line per message; other environments keep JSON for the log collector.
const logger = pino({
  level: config.LOG_LEVEL,
  ...(config.NODE_ENV === 'development'
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,req,res,responseTime', singleLine: true },
        },
      }
    : {}),
});
if (config.DISABLE_MFA) logger.warn('DISABLE_MFA is on: MFA is skipped. This is for local development only.');
if (!config.SUPABASE_MFA_ENABLED)
  logger.warn('SUPABASE_MFA_ENABLED=false: no second factor is required. Set this only while authenticator sign-in is off in the Supabase project.');
// Test login is on only when every check in test-auth.ts passes. resolveTestAuth throws rather than offer a bypass for an unsafe setup.
const testAuth = resolveTestAuth(config);
if (testAuth) {
  logger.warn('TEST_AUTH_ENABLED is on: test login with a fixed one-time code is available. Local development and automated tests only.');
}
const db = createDb(config.DATABASE_URL);
const txRunner = createTxRunner(db);
// Signed document links and archive encryption use keys derived from the deployment's JWT secret.
const signingSecret = config.APP_SIGNING_SECRET ?? config.SUPABASE_JWT_SECRET;
if (!signingSecret) {
  logger.warn(
    'APP_SIGNING_SECRET is not set: document links work only until this API restarts, and webhook subscriptions are refused. Set it in apps/api/.env.',
  );
}
if (scrubbedSecrets.length > 0) {
  logger.warn(
    `${scrubbedSecrets.join(', ')} was set in the API environment and has been removed from this process: the API never uses it. Keep it only in the provisioning worker's environment (apps/api/.env.provisioning).`,
  );
}
if (config.IDENTITY_EMAIL_FALLBACK) {
  logger.info('IDENTITY_EMAIL_FALLBACK is on: a token not bound to any user may still match a user by e-mail (see tools/identity-binding.ts).');
}
// Document files (AUD-013): an S3-compatible bucket and clamd when configured, else local disk and the signature check only.
const documentBackends = documentBackendsFromConfig(config);
if (config.NODE_ENV === 'production' && config.DOCUMENT_STORE === 'local') {
  logger.warn('DOCUMENT_STORE is local: document files are on this machine only and are lost on a redeploy. Set DOCUMENT_STORE=s3.');
}
if (config.NODE_ENV === 'production' && !config.CLAMAV_ADDRESS) {
  logger.warn('CLAMAV_ADDRESS is not set: document uploads get the file-signature check only, no malware scan.');
}
// Staff invitations are recorded here and sent by the provisioning worker (tools/provisioning-worker.ts), a separate process.
const deps = createProductionDeps(txRunner, { documentLinkSecret: signingSecret, ...documentBackends });
globalJobQueue.registerHandler(DOCUMENT_ARCHIVE_JOB, createDocumentArchiveHandler(deps));
globalJobQueue.registerHandler(USER_TRANSFER_JOB, createUserTransferHandler(deps));
globalJobQueue.registerHandler(WEBHOOK_DELIVERY_JOB, createWebhookDeliveryHandler(deps));

const app = createApp({
  deps,
  corsAllowedOrigins: config.CORS_ALLOWED_ORIGINS,
  logger,
  testAuth,
  auth: supabaseAuth({
    verifier: createTokenVerifier({
      supabaseUrl: config.SUPABASE_URL,
      jwtSecret: config.SUPABASE_JWT_SECRET,
      bypassSecret: testAuth?.secret,
    }),
    resolver: createPrincipalResolver(txRunner, {
      onInvitationAccepted: createInvitationAcceptedAudit(deps),
      emailFallback: config.IDENTITY_EMAIL_FALLBACK,
      // Each use of the fallback is an account still to bind. The user id is logged, never the e-mail address.
      onEmailFallback: (userId) =>
        logger.warn({ userId }, 'identity resolved by e-mail: bind this account (tools/identity-binding.ts)'),
    }),
  }),
});

const server = app.listen(config.PORT, () => {
  logger.info(`API listening on http://localhost:${config.PORT} (${config.NODE_ENV})`);
  void checkDatabase(db, config.DATABASE_URL).then((status) => {
    if (!status.connected) {
      logger.error(`Database NOT connected (${status.host}, ${status.mode}): ${redactSecrets(status.reason)}`);
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
          { error: redactSecrets(err instanceof Error ? err.message : 'unknown') },
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
      { stage, error: redactSecrets(formatWorkerError(err)) },
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
