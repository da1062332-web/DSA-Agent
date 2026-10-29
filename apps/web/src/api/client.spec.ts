import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ACCESS_DENIED_TEXT,
  ApiError,
  apiFetch,
  apiStream,
  errorText,
  registerStepUpHandler,
  registerStepUpRefusedHandler,
} from './client';

vi.mock('../config', () => ({
  readConfig: () => ({ success: true, data: { VITE_API_BASE_URL: 'http://api.test' } }),
}));
vi.mock('../auth/supabase', () => ({
  getSupabase: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'a.b.c' } } }) } }),
}));

describe('apiStream', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('TEST-WEB-STREAM-001 keeps the API code and status of a refused stream, so a refusal is not retried like an outage', async () => {
    const envelope = {
      error: {
        code: 'STEP_UP_REQUIRED',
        message: 'Two-step verification is required for your role.',
        httpStatus: 401,
        correlationId: 'corr-1',
        details: [],
        retryable: false,
      },
    };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(envelope), { status: 401 })));
    const err = await apiStream('/v1/notifications/stream', new AbortController().signal).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: 'STEP_UP_REQUIRED', httpStatus: 401, correlationId: 'corr-1' });
  });

  it('TEST-WEB-STREAM-002 still reports the HTTP status when the error body is not the API envelope', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Bad gateway', { status: 502 })));
    const err = await apiStream('/v1/notifications/stream', new AbortController().signal).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'INTERNAL_ERROR', httpStatus: 502 });
  });
});

describe('errorText', () => {
  it('gives one clear message for any refused permission, whatever the API said', () => {
    expect(errorText(new ApiError('FORBIDDEN', 403, 'Principal requires message.send'))).toBe(
      ACCESS_DENIED_TEXT,
    );
  });
  it('keeps field details and the reference for other errors', () => {
    const err = new ApiError('VALIDATION_ERROR', 422, 'Invalid.', 'ref1', [
      { field: 'name', issue: 'REQUIRED' },
    ]);
    expect(errorText(err)).toBe('Invalid. — name: required (ref ref1)');
  });
  it('handles plain errors and unknown values', () => {
    expect(errorText(new Error('boom'))).toBe('boom');
    expect(errorText('x')).toBe('Something went wrong.');
  });
  it('maps internal error class names (e.g. System.Xml.XmlElement) to plain user messages', () => {
    const errWithXml = new ApiError('INTERNAL_ERROR', 500, 'System.Xml.XmlElement');
    expect(errorText(errWithXml)).not.toContain('System.Xml');
    expect(errorText(errWithXml)).toBe('An unexpected error occurred.');

    const plainErrorWithXml = new Error('Unhandled exception: System.Xml.XmlElement');
    expect(errorText(plainErrorWithXml)).not.toContain('System.Xml');
    expect(errorText(plainErrorWithXml)).toBe('An unexpected error occurred.');
  });
});

describe('step-up', () => {
  const stepUpRefusal = () =>
    new Response(
      JSON.stringify({
        error: {
          code: 'STEP_UP_REQUIRED',
          message: 'Two-step verification is required for your role.',
          httpStatus: 401,
          correlationId: 'corr-2',
          details: [],
          retryable: false,
        },
      }),
      { status: 401 },
    );

  afterEach(() => {
    registerStepUpHandler(null);
    registerStepUpRefusedHandler(null);
    vi.unstubAllGlobals();
  });

  it('TEST-WEB-STEPUP-001 tells the shell when a step-up cannot be given, and still fails the request', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => stepUpRefusal()));
    registerStepUpHandler(async () => false);
    const refused = vi.fn();
    registerStepUpRefusedHandler(refused);
    await expect(apiFetch('/v1/leads')).rejects.toMatchObject({ code: 'STEP_UP_REQUIRED', httpStatus: 401 });
    expect(refused).toHaveBeenCalledTimes(1);
  });

  it('TEST-WEB-STEPUP-002 retries the request once after a successful step-up and does not notify the shell', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(stepUpRefusal())
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    registerStepUpHandler(async () => true);
    const refused = vi.fn();
    registerStepUpRefusedHandler(refused);
    await expect(apiFetch('/v1/leads')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(refused).not.toHaveBeenCalled();
  });
});
