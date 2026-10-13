// MOD-AUTH Authentication (owner: Dev 1; SUB-AUTH.01…02, .04). Documents the Supabase Auth endpoints the web app
// calls. They are served by Supabase, not by this API, so each operation carries its own `servers` entry that points
// at Supabase. "Try it out" therefore calls Supabase directly. The publishable key goes in the `apikey` header.
import { z } from 'zod';
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';

const LOCAL = 'http://127.0.0.1:54321/auth/v1';
const HOSTED = 'https://<your-project-ref>.supabase.co/auth/v1';
const servers = [
  { url: LOCAL, description: 'Local Supabase (npm run db:start)' },
  { url: HOSTED, description: 'Hosted Supabase project (replace <your-project-ref>)' },
];

const apikey = {
  name: 'apikey',
  in: 'header' as const,
  required: true,
  description: 'Supabase publishable key (VITE_SUPABASE_PUBLISHABLE_KEY). Never the secret key.',
  schema: { type: 'string' as const },
};

const json = <T extends z.ZodTypeAny>(schema: T) => ({ 'application/json': { schema } });

const Session = z.object({
  access_token: z.string().describe('JWT. Send as Authorization: Bearer <token> on /v1 calls.'),
  token_type: z.literal('bearer'),
  expires_in: z.number().int().describe('Seconds until access_token expires (3600 by default).'),
  expires_at: z.number().int(),
  refresh_token: z.string(),
  user: z.object({
    id: z.string().describe('Auth user id. Equals app_user.idp_subject.'),
    email: z.string().email(),
    app_metadata: z.object({ tenant_id: z.string() }).passthrough(),
  }),
});

const Factor = z.object({
  id: z.string(),
  friendly_name: z.string().nullable(),
  factor_type: z.literal('totp'),
  status: z.enum(['unverified', 'verified']),
});

const Enrolled = Factor.extend({
  totp: z.object({
    qr_code: z.string().describe('SVG QR code to scan with Google or Microsoft Authenticator.'),
    secret: z.string().describe('Manual entry key if the QR code cannot be scanned.'),
    uri: z.string(),
  }),
});

const Challenge = z.object({ id: z.string(), expires_at: z.number().int() });

const ErrorBody = z.object({
  code: z.number().int().optional(),
  error_code: z.string().optional(),
  msg: z.string().optional(),
});

const AuthError = {
  description: 'Rejected by Supabase (see error_code, e.g. invalid_credentials)',
  content: json(ErrorBody),
};

/** Operation IDs keep the spec numbering (DSA Notion SUB-AUTH.01…04). */
export function registerAuthOpenApi(registry: OpenAPIRegistry): void {
  const base = { tags: ['MOD-AUTH Authentication'], servers };

  registry.registerPath({
    ...base,
    method: 'post',
    path: '/token',
    operationId: 'API-AUTH-001',
    summary: 'Sign in with email and password',
    description:
      'Used by the login page. Returns a session. Pass grant_type=refresh_token to refresh it (API-AUTH-003).',
    security: [],
    parameters: [
      apikey,
      {
        name: 'grant_type',
        in: 'query',
        required: true,
        schema: { type: 'string', enum: ['password', 'refresh_token'] },
      },
    ],
    request: {
      body: {
        required: true,
        content: {
          'application/json': {
            schema: z.union([
              z
                .object({ email: z.string().email(), password: z.string().min(12) })
                .describe('grant_type=password'),
              z.object({ refresh_token: z.string() }).describe('grant_type=refresh_token'),
            ]),
          },
        },
      },
    },
    responses: { 200: { description: 'Session', content: json(Session) }, 400: AuthError },
  });

  registry.registerPath({
    ...base,
    method: 'post',
    path: '/logout',
    operationId: 'API-AUTH-004',
    summary: 'Sign out',
    description:
      'scope=local signs out this device; others signs out every other device; global signs out everywhere.',
    parameters: [
      apikey,
      { name: 'scope', in: 'query', schema: { type: 'string', enum: ['local', 'others', 'global'] } },
    ],
    responses: { 204: { description: 'Signed out' }, 401: AuthError },
  });

  registry.registerPath({
    ...base,
    method: 'post',
    path: '/recover',
    operationId: 'API-AUTH-007',
    summary: 'Request a password reset email',
    description:
      'Used by /forgot-password. Always returns 200, so the response never reveals whether the email exists.',
    security: [],
    parameters: [apikey],
    request: { body: { required: true, content: json(z.object({ email: z.string().email() })) } },
    responses: { 200: { description: 'Email sent if the account exists' } },
  });

  registry.registerPath({
    ...base,
    method: 'put',
    path: '/user',
    operationId: 'API-AUTH-008',
    summary: 'Set a new password',
    description: 'Used by /reset-password. Authorise with the access token from the reset link.',
    parameters: [apikey],
    request: { body: { required: true, content: json(z.object({ password: z.string().min(12) })) } },
    responses: {
      200: {
        description: 'Password changed',
        content: json(z.object({ id: z.string(), email: z.string() })),
      },
      401: AuthError,
    },
  });

  registry.registerPath({
    ...base,
    method: 'post',
    path: '/factors',
    operationId: 'API-AUTH-010',
    summary: 'Enrol an authenticator app (TOTP)',
    description: 'Used by /mfa on first setup. Show the QR code, then verify with a code (API-AUTH-002).',
    parameters: [apikey],
    request: {
      body: {
        required: true,
        content: json(
          z.object({ factor_type: z.literal('totp'), friendly_name: z.string().max(64).optional() }),
        ),
      },
    },
    responses: {
      200: { description: 'Factor created, unverified', content: json(Enrolled) },
      401: AuthError,
    },
  });

  registry.registerPath({
    ...base,
    method: 'post',
    path: '/factors/{factor_id}/challenge',
    operationId: 'API-AUTH-009a',
    summary: 'Start an MFA challenge',
    description: 'First half of step-up (API-AUTH-009) and of sign-in with MFA.',
    parameters: [apikey, { name: 'factor_id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { 200: { description: 'Challenge', content: json(Challenge) }, 401: AuthError },
  });

  registry.registerPath({
    ...base,
    method: 'post',
    path: '/factors/{factor_id}/verify',
    operationId: 'API-AUTH-002',
    summary: 'Verify a 6-digit authenticator code',
    description:
      'Completes sign-in with MFA, verifies a new authenticator (enrolment), or completes step-up (API-AUTH-009). A successful step-up sets the aal2 session that the API checks for 900 s.',
    parameters: [apikey, { name: 'factor_id', in: 'path', required: true, schema: { type: 'string' } }],
    request: {
      body: {
        required: true,
        content: json(z.object({ challenge_id: z.string(), code: z.string().regex(/^\d{6}$/) })),
      },
    },
    responses: {
      200: { description: 'Session upgraded to aal2', content: json(Session) },
      400: AuthError,
      401: AuthError,
    },
  });

  registry.registerPath({
    ...base,
    method: 'delete',
    path: '/factors/{factor_id}',
    operationId: 'API-AUTH-011',
    summary: 'Remove an authenticator app',
    description:
      'Used by the security page. Needs a session at aal2. Users whose role requires MFA keep at least one.',
    parameters: [apikey, { name: 'factor_id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: {
      200: { description: 'Removed', content: json(z.object({ id: z.string() })) },
      401: AuthError,
    },
  });
}

export const authTags = [
  {
    name: 'MOD-AUTH Authentication',
    description: 'Sign-in, MFA and password reset. Served by Supabase Auth, not by this API.',
  },
];
