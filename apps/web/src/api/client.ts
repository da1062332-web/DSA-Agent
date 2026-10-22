// Typed API client (owner: Dev 1, UI-PLT-001). Sends the Supabase access token as Bearer, an Idempotency-Key on
// every POST (one key per logical submit, reused on retry), If-Match when a version is given, and parses the
// Contracts §6 error envelope into ApiError. On 401 STEP_UP_REQUIRED it asks the StepUpDialog for a TOTP code,
// refreshes the session and retries once. Screen owners call it through TanStack Query hooks.
import { ErrorEnvelope, type ErrorDetail } from '@dsa/contracts';
import { getSupabase } from '../auth/supabase';
import { readConfig } from '../config';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number,
    message: string,
    readonly correlationId?: string,
    readonly details: ErrorDetail[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiRequest {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  /** The ETag version the edit is based on; sent as If-Match. */
  version?: number;
  /** A raw If-Match value, for callers that hold the ETag string as the API sent it. */
  ifMatch?: string;
  /** Reuse the same key when retrying the same submit. Generated for POSTs when omitted. */
  idempotencyKey?: string;
  query?: Record<string, string | number | undefined>;
}

type StepUpHandler = () => Promise<boolean>;
let stepUpHandler: StepUpHandler | null = null;

/** The StepUpProvider registers the dialog here; the client calls it on 401 STEP_UP_REQUIRED. */
export function registerStepUpHandler(handler: StepUpHandler | null): void {
  stepUpHandler = handler;
}

export const newIdempotencyKey = () => crypto.randomUUID();

export async function apiFetch<T>(path: string, req: ApiRequest = {}): Promise<T> {
  return (await apiRequest<T>(path, req)).data;
}

/** Like apiFetch, and also returns the ETag the API sent (for the next If-Match). */
export async function apiRequest<T>(path: string, req: ApiRequest = {}): Promise<{ data: T; etag?: string }> {
  const method = req.method ?? 'GET';
  const key = req.idempotencyKey ?? (method === 'POST' ? newIdempotencyKey() : undefined);
  try {
    return await send<T>(path, { ...req, method, idempotencyKey: key });
  } catch (err) {
    if (
      err instanceof ApiError &&
      err.code === 'STEP_UP_REQUIRED' &&
      stepUpHandler &&
      (await stepUpHandler())
    ) {
      return send<T>(path, { ...req, method, idempotencyKey: key });
    }
    throw err;
  }
}

async function send<T>(path: string, req: ApiRequest): Promise<{ data: T; etag?: string }> {
  const config = readConfig();
  if (!config.success) throw new ApiError('INTERNAL_ERROR', 0, 'Web configuration is invalid.');

  const { data } = await getSupabase().auth.getSession();
  const headers = new Headers({ Accept: 'application/json' });
  const token = data.session?.access_token;
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (req.headers) {
    for (const [k, v] of Object.entries(req.headers)) {
      headers.set(k, v);
    }
  }
  if (req.body !== undefined) headers.set('Content-Type', 'application/json');
  if (req.idempotencyKey) headers.set('Idempotency-Key', req.idempotencyKey);
  if (req.version !== undefined) headers.set('If-Match', `"${req.version}"`);
  else if (req.ifMatch) headers.set('If-Match', req.ifMatch);

  const url = new URL(`${config.data.VITE_API_BASE_URL}${path}`);
  for (const [k, v] of Object.entries(req.query ?? {}))
    if (v !== undefined && v !== '') url.searchParams.set(k, String(v));

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: req.method,
      headers,
      body:
        req.body === undefined
          ? undefined
          : typeof req.body === 'string'
            ? req.body
            : JSON.stringify(req.body),
      // Never answer from the browser's HTTP cache: responses are per user, and a revalidated cached copy could be
      // the previous user's.
      cache: 'no-store',
    });
  } catch {
    throw new ApiError('DEPENDENCY_UNAVAILABLE', 0, 'Cannot reach the API. Is it running (npm run dev)?');
  }

  const body: unknown = res.status === 204 ? undefined : await res.json().catch(() => undefined);
  if (!res.ok) {
    const env = ErrorEnvelope.safeParse(body);
    if (env.success) {
      const e = env.data.error;
      throw new ApiError(e.code, e.httpStatus, e.message, e.correlationId, e.details ?? []);
    }
    // A partial envelope (a proxy or an older handler) still carries a code and message worth showing.
    const partial = (body as { error?: { code?: unknown; message?: unknown; details?: unknown } } | undefined)
      ?.error;
    if (partial && typeof partial.code === 'string') {
      throw new ApiError(
        partial.code,
        res.status,
        typeof partial.message === 'string' ? partial.message : `Request failed (${res.status}).`,
        undefined,
        Array.isArray(partial.details) ? (partial.details as ErrorDetail[]) : [],
      );
    }
    throw new ApiError('INTERNAL_ERROR', res.status, `Request failed (${res.status}).`);
  }
  return { data: body as T, etag: res.headers?.get('ETag') ?? undefined };
}

/** Shown wherever the API refuses a request for lack of permission. */
export const ACCESS_DENIED_TEXT =
  "You don't have access to this. Ask your administrator to grant you the permission.";

const INTERNAL_CLASS_PATTERNS = [
  /System\.(Xml|IO|Data|Web|Net|Collections|Runtime|Threading|Security)/i,
  /XmlElement/i,
  /NullReferenceException|InvalidOperationException|ArgumentNullException/i,
  /\[object\s+Object\]/i,
];

function sanitizeErrorMessage(msg: string): string {
  if (INTERNAL_CLASS_PATTERNS.some((p) => p.test(msg))) {
    return 'An unexpected error occurred.';
  }
  return msg;
}

/** A readable message for an error, including field details from VALIDATION_ERROR. */
export function errorText(err: unknown): string {
  if (!(err instanceof ApiError)) {
    const raw = err instanceof Error ? err.message : 'Something went wrong.';
    return sanitizeErrorMessage(raw);
  }
  if (err.code === 'FORBIDDEN') return ACCESS_DENIED_TEXT;
  const rawMsg = sanitizeErrorMessage(err.message);
  const fields = err.details.filter((d) => d.field).map((d) => `${d.field}: ${d.issue.toLowerCase()}`);
  const ref = err.correlationId ? ` (ref ${err.correlationId})` : '';
  return `${rawMsg}${fields.length ? ` — ${fields.join(', ')}` : ''}${ref}`;
}

/** Opens a streaming response (server-sent events) with the session token; the caller reads res.body. */
export async function apiStream(path: string, signal: AbortSignal): Promise<Response> {
  const config = readConfig();
  if (!config.success) throw new ApiError('INTERNAL_ERROR', 0, 'Web configuration is invalid.');
  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError('UNAUTHENTICATED', 401, 'Not signed in.');
  const res = await fetch(`${config.data.VITE_API_BASE_URL}${path}`, {
    headers: { Accept: 'text/event-stream', Authorization: `Bearer ${token}` },
    cache: 'no-store',
    signal,
  });
  if (!res.ok) throw new ApiError('INTERNAL_ERROR', res.status, `Stream failed (${res.status}).`);
  return res;
}

export async function apiDownload(path: string, defaultFilename: string): Promise<void> {
  const config = readConfig();
  if (!config.success) throw new ApiError('INTERNAL_ERROR', 0, 'Web configuration is invalid.');

  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token;
  const headers = new Headers();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const url = path.startsWith('http') ? new URL(path) : new URL(`${config.data.VITE_API_BASE_URL}${path}`);
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const env = ErrorEnvelope.safeParse(body);
    if (env.success) {
      throw new ApiError(env.data.error.code, env.data.error.httpStatus, env.data.error.message);
    }
    throw new ApiError('INTERNAL_ERROR', res.status, `Download failed (${res.status})`);
  }

  let filename = defaultFilename;
  const disposition = res.headers.get('content-disposition');
  if (disposition && disposition.includes('filename=')) {
    const match = /filename=["']?([^"';]+)["']?/.exec(disposition);
    if (match?.[1]) filename = match[1];
  }

  const blob = await res.blob();
  const blobUrl = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
