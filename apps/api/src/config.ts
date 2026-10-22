// API configuration from the environment (owner: Dev 1). Other lanes add their variables by PR.
import { z } from 'zod';
import { mfaMayBeDisabledHere } from './http/mfa-switch';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const isLocalHost = (url: string) => {
  const host = new URL(url).hostname;
  return LOCAL_HOSTS.has(host) || host.endsWith('.localhost');
};

// Roles that bypass RLS; the API must never connect as them (ADR-SB-03).
const FORBIDDEN_DB_USERS = /^(postgres|supabase_admin|service_role)(\..*)?$/;

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    CORS_ALLOWED_ORIGINS: z
      .string()
      .default('')
      .transform((s) =>
        s
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean),
      ),
    DATABASE_URL: z.string().url(),
    SUPABASE_URL: z.string().url(),
    // Empty means unset: hosted projects sign tokens with asymmetric keys and leave this blank.
    SUPABASE_JWT_SECRET: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
    /**
     * Key material for what the API signs or encrypts itself: document view and download links, document archives, webhook signing
     * secrets at rest. At least 32 characters, the same on every API instance, required in production. Generate one with
     * `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
     */
    APP_SIGNING_SECRET: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(32).optional()),
    TEST_TOKENS: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    /**
     * Turns on the data-correction executor (Release 2, SUB-ADM.07): an in-process worker that carries out APPROVED corrections using the
     * reviewed scripts in correction-scripts.ts. Off unless set to true, because it writes to tenant data.
     */
    DATA_CORRECTION_EXECUTOR: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    /** Development switch: skip MFA. Refused unless this is a local Supabase stack outside production (see http/mfa-switch.ts). */
    DISABLE_MFA: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    /** Hardcoded OTP for test bypass authentication. */
    TEST_BYPASS_OTP: z.string().default('000000'),
    /** Secret for HMAC signing and verifying test bypass tokens. */
    BYPASS_JWT_SECRET: z.string().default('dsa-crm-test-bypass-jwt-secret-key-2026'),
  })
  .superRefine((env, ctx) => {
    if (FORBIDDEN_DB_USERS.test(decodeURIComponent(new URL(env.DATABASE_URL).username))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_URL'],
        message: 'must connect as dsa_api, never as postgres or service_role (ADR-SB-03)',
      });
    }
    if (
      env.DISABLE_MFA &&
      !mfaMayBeDisabledHere({ NODE_ENV: env.NODE_ENV, SUPABASE_URL: env.SUPABASE_URL })
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DISABLE_MFA'],
        message:
          'MFA can be disabled only against the local Supabase stack and never in production; remove DISABLE_MFA',
      });
    }
    if (env.NODE_ENV === 'production' && !env.APP_SIGNING_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['APP_SIGNING_SECRET'],
        message:
          'is required in production (document links, archives and webhook secrets are signed or encrypted with it)',
      });
    }
    if (env.TEST_TOKENS && !isLocalHost(env.SUPABASE_URL)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TEST_TOKENS'],
        message: 'test tokens are allowed only against the local Supabase stack (Contracts §7)',
      });
    }
  });

export type ApiConfig = z.infer<typeof EnvSchema>;

/** Parses the environment. The error lists variable names and reasons only, never values. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid API configuration:\n${lines.join('\n')}`);
  }
  return parsed.data;
}
