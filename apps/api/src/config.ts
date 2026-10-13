// API configuration from the environment (owner: Dev 1). Other lanes add their variables by PR.
import { z } from 'zod';

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
    SUPABASE_JWT_SECRET: z.string().optional(),
    API_JWT_SECRET: z.string().default('dsa_internal_jwt_signing_secret_2026_qloax'),
    TEST_TOKENS: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
  })
  .superRefine((env, ctx) => {
    if (FORBIDDEN_DB_USERS.test(decodeURIComponent(new URL(env.DATABASE_URL).username))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_URL'],
        message: 'must connect as dsa_api, never as postgres or service_role (ADR-SB-03)',
      });
    }
    if (env.TEST_TOKENS && !isLocalHost(env.SUPABASE_URL)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TEST_TOKENS'],
        message: 'test tokens are allowed only against the local Supabase stack (Contracts §7)',
      });
    }
    // One environment per process: a local database with a hosted auth project (or the reverse) is a
    // configuration mistake, and it would let real users sign in against the wrong data.
    const dbLocal = isLocalHost(env.DATABASE_URL);
    if (dbLocal !== isLocalHost(env.SUPABASE_URL)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_URL'],
        message: 'DATABASE_URL and SUPABASE_URL must both point at local or both at hosted services',
      });
    }
    // A hosted project signs with asymmetric keys. Its legacy JWT secret can mint any token, so it must not reach a
    // hosted API process.
    if (!isLocalHost(env.SUPABASE_URL) && env.SUPABASE_JWT_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SUPABASE_JWT_SECRET'],
        message: 'must not be set for a hosted project; hosted tokens are verified through JWKS',
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
