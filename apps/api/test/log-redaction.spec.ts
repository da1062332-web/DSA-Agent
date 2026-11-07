// Request logs keep the route and never the bearer token in the path (2026-11-04 containment). An upload token lets whoever holds it
// upload one file, and a signed-file token lets it download one; a log line must not carry either.
import { describe, expect, it } from 'vitest';
import { redactRequestPath } from '../src/http/redact';

describe('request path redaction', () => {
  it('TEST-LOG-01 the token in an upload, signed-file or public upload path is removed; the route stays visible', () => {
    expect(redactRequestPath('/public/v1/document-uploads/AbC123_-xyz?sig=1')).toBe(
      '/public/v1/document-uploads/[redacted]',
    );
    expect(redactRequestPath('/public/v1/document-files/eyJhbGc.payload.signature')).toBe(
      '/public/v1/document-files/[redacted]',
    );
    expect(redactRequestPath('/public/v1/upload/tok_01JTEST/files')).toBe(
      '/public/v1/upload/[redacted]/files',
    );
  });

  it('TEST-LOG-02 other paths and query strings are logged without their values', () => {
    expect(redactRequestPath('/v1/upload-links')).toBe('/v1/upload-links');
    expect(redactRequestPath('/v1/documents/upload-intents')).toBe('/v1/documents/upload-intents');
    expect(redactRequestPath('/public/v1/document-uploads')).toBe('/public/v1/document-uploads');
    expect(redactRequestPath('/v1/users/usr_1?token=abc')).toBe('/v1/users/usr_1');
    expect(redactRequestPath('')).toBe('');
  });
});
