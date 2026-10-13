// Web configuration (owner: Dev 1). Reads exactly three VITE_ variables (TASK-001 §10).
import { z } from 'zod';

const WebConfigSchema = z.object({
  VITE_SUPABASE_URL: z.string().url(),
  VITE_SUPABASE_PUBLISHABLE_KEY: z
    .string()
    .min(1)
    .refine((k) => !k.startsWith('sb_secret_'), 'must be the publishable key, never a secret key'),
  VITE_API_BASE_URL: z.string().url(),
});

export type WebConfig = z.infer<typeof WebConfigSchema>;

export function readConfig(env: Record<string, unknown> = import.meta.env) {
  return WebConfigSchema.safeParse({
    VITE_SUPABASE_URL: env.VITE_SUPABASE_URL,
    VITE_SUPABASE_PUBLISHABLE_KEY: env.VITE_SUPABASE_PUBLISHABLE_KEY,
    VITE_API_BASE_URL: env.VITE_API_BASE_URL,
  });
}
