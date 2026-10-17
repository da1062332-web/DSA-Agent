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
import { createLenderPort } from './modules/origination/catalogue/lender-port';
import { createProductVersionPort } from './modules/origination/catalogue/product-version-port';
import { createCompositeComplaintSubjectPort } from './modules/crm/leads/subject-port';
import { createApplicationSubjectPort } from './modules/origination/applications/subject-port';
import { PostgresDataSharingPort } from './modules/compliance/data-sharing-port';
import { PgApiClientRepository } from './modules/partner-api/api-client-repository';
import { registeredCorrectionScripts } from './modules/platform-admin/correction-scripts';
import {
  DataCorrectionExecutor,
  startDataCorrectionExecutor,
} from './modules/platform-admin/data-correction-executor';

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
const ids = createIdGenerator();
const audit = createAuditPort(ids);
const complaintSubjectPort = createCompositeComplaintSubjectPort({
  application: createApplicationSubjectPort(),
});

const app = createApp({
  deps: {
    txRunner,
    authz: createAuthz(),
    audit,
    ids,
    userDirectory: createUserDirectory(),
    complaintSubjectPort,
    productVersionPort: createProductVersionPort(),
    // Complaint referrals confirm the lender exists through this port; without it every referral is refused (503).
    lenderPort: createLenderPort(),
    dataSharingPort: new PostgresDataSharingPort(),
    apiClientRepository: new PgApiClientRepository(txRunner, audit),
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

import { startBackgroundWorker } from './modules/platform/worker';

// Carries out APPROVED data corrections. Off unless DATA_CORRECTION_EXECUTOR=true, because it changes tenant data.
if (config.DATA_CORRECTION_EXECUTOR) {
  logger.warn(
    { registeredScripts: registeredCorrectionScripts.size },
    'DATA_CORRECTION_EXECUTOR is on: approved data corrections will be carried out by the reviewed scripts.',
  );
  startDataCorrectionExecutor(
    new DataCorrectionExecutor({ txRunner, audit, scripts: registeredCorrectionScripts }),
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

const worker = startBackgroundWorker({
  txRunner,
  authz: createAuthz(),
  audit: createAuditPort(ids),
  ids,
  userDirectory: createUserDirectory(),
  complaintSubjectPort,
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
