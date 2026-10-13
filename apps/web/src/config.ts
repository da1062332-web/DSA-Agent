// Web configuration (owner: Dev 1). Reads exactly three VITE_ variables (TASK-001 §10).
import { z } from 'zod';

/** Role claim of a legacy JWT-style key (anon or service_role); '' for sb_* keys and anything unparseable. */
function jwtRole(key: string): string {
  const payload = key.split('.')[1];
  if (!key.startsWith('eyJ') || !payload) return '';
  try {
    const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { role?: unknown };
    return typeof claims.role === 'string' ? claims.role : '';
  } catch {
    return '';
  }
}

const WebConfigSchema = z.object({
  VITE_SUPABASE_URL: z.string().url().default('https://mlpkwwhnagxzinaohdxg.supabase.co'),
  VITE_SUPABASE_PUBLISHABLE_KEY: z
    .string()
    .refine((k) => !k.startsWith('sb_secret_'), 'must be the publishable key, never a secret key')
    .refine(
      (k) => !jwtRole(k).startsWith('service'),
      'must be the publishable key, never the service_role key',
    )
    .default('sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH'),
  VITE_API_BASE_URL: z.string().url().default('http://localhost:3000'),
});

export type WebConfig = z.infer<typeof WebConfigSchema>;

export function readConfig(env: Record<string, unknown> = import.meta.env) {
  return WebConfigSchema.safeParse({
    VITE_SUPABASE_URL: env.VITE_SUPABASE_URL,
    VITE_SUPABASE_PUBLISHABLE_KEY: env.VITE_SUPABASE_PUBLISHABLE_KEY,
    VITE_API_BASE_URL: env.VITE_API_BASE_URL,
  });
}
