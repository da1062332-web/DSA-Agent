// Error responses and logs never carry a connection string or a secret (owner: Dev 1). A driver error that names the database URL leaves
// the response with the stable code only, and every log line that carries it is redacted.
import express from 'express';
import type { Logger } from 'pino';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../src/http/error-handler';
import { registerDatabaseUrl } from '../src/http/redact';

const URL_WITH_PASSWORD = 'postgresql://dsa_api:leaked-pass-1234@localhost:5432/postgres';
registerDatabaseUrl(URL_WITH_PASSWORD);

function appThrowing(error: unknown) {
  const app = express();
  app.get('/boom', () => {
    throw error;
  });
  const logger = { error: vi.fn() };
  app.use(errorHandler(logger as unknown as Logger));
  return { app, logger };
}

describe('error responses and logs never carry a connection string', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('TEST-LEAK-01 an internal error answers with the generic message and no driver text', async () => {
    const { app } = appThrowing(new Error(`could not connect to ${URL_WITH_PASSWORD}`));
    const res = await request(app).get('/boom');

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(res.body.error.message).toBe('An unexpected error occurred.');
    expect(JSON.stringify(res.body)).not.toMatch(/leaked-pass|postgresql:\/\//);
  });

  it('TEST-LEAK-02 a network failure keeps its code and drops the driver text', async () => {
    const error = Object.assign(new Error(`getaddrinfo ENOTFOUND ${URL_WITH_PASSWORD}`), { code: 'ENOTFOUND' });
    const { app } = appThrowing(error);
    const res = await request(app).get('/boom');

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('DEPENDENCY_UNAVAILABLE');
    expect(res.body.error.message).toBe('Database connection unavailable (ENOTFOUND).');
    expect(JSON.stringify(res.body)).not.toMatch(/leaked-pass|postgresql:\/\//);
  });

  it('TEST-LEAK-03 the console and the structured log carry no password, in the message or the stack', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { app, logger } = appThrowing(new Error(`could not connect to ${URL_WITH_PASSWORD}`));
    await request(app).get('/boom');

    const written = JSON.stringify([consoleError.mock.calls, logger.error.mock.calls]);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(written).not.toMatch(/leaked-pass/);
    expect(written).not.toMatch(/postgresql:\/\/dsa_api:/);
  });

  it('TEST-LEAK-04 a token in the request URL is masked in the console line', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { app } = appThrowing(new Error('boom'));
    await request(app).get('/boom?token=query-token-value-9');

    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('query-token-value-9');
  });
});
