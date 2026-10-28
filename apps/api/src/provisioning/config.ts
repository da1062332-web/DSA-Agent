// Provisioning worker configuration (owner: platform; Architecture B). Read only by tools/provisioning-worker.ts, from its own
// environment file (apps/api/.env.provisioning, never committed). The HTTP API has no such settings: it never holds the key.
import { z } from 'zod';

// Roles that bypass row-level security; the worker writes as dsa_api, like the API and the provisioning tools (ADR-SB-03).
const FORBIDDEN_DB_USERS = /^(postgres|supabase_admin|service_role)(\..*)?$/;

const Schema = z
  .object({
    /** Explicit switch: the worker refuses to start unless this is exactly "true". */
    PROVISIONING_WORKER_ENABLED: z.literal('true', {
      errorMap: () => ({ message: 'must be "true" to run the provisioning worker' }),
    }),
    DATABASE_URL: z.string().url(),
    SUPABASE_URL: z.string().url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(20, 'is missing or too short'),
    /** Where the e-mail link returns the invitee: the web app's /accept-invitation, on the Supabase redirect allow-list. */
    INVITE_REDIRECT_URL: z.string().url(),
    PROVISIONING_POLL_MS: z.coerce.number().int().min(1000).max(600_000).default(5000),
    /** Names this worker in claims. Defaults to the host and process id. */
    PROVISIONING_WORKER_ID: z
      .string()
      .regex(/^[A-Za-z0-9_.:-]{1,64}$/, 'letters, digits and _ . : - only, at most 64')
      .optional(),
  })
  .superRefine((env, ctx) => {
    // The link goes to a person's inbox: HTTPS, or HTTP on this machine only.
    const redirect = new URL(env.INVITE_REDIRECT_URL);
    const local = redirect.hostname === 'localhost' || redirect.hostname === '127.0.0.1';
    if (redirect.protocol !== 'https:' && !(redirect.protocol === 'http:' && local)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['INVITE_REDIRECT_URL'],
        message: 'must be https, or http on localhost',
      });
    }
    if (!redirect.pathname.endsWith('/accept-invitation')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['INVITE_REDIRECT_URL'],
        message: 'must point at the web app’s /accept-invitation page',
      });
    }
    if (FORBIDDEN_DB_USERS.test(decodeURIComponent(new URL(env.DATABASE_URL).username))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_URL'],
        message: 'must connect as dsa_api, never as postgres or service_role (ADR-SB-03)',
      });
    }
  });

export type ProvisioningConfig = z.infer<typeof Schema>;

/** Parses the worker's environment. The error lists variable names and reasons only, never values. */
export function loadProvisioningConfig(env: NodeJS.ProcessEnv = process.env): ProvisioningConfig {
  const parsed = Schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid provisioning worker configuration:\n${lines.join('\n')}`);
  }
  return parsed.data;
}
