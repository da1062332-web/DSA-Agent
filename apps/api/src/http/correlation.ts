// X-Correlation-Id: read it or generate a ULID, and always echo it back (Contracts §5).
// TASK-101 moves this into packages/kernel/src/http.
import type { RequestHandler } from 'express';
import { monotonicFactory } from 'ulid';

export const CORRELATION_HEADER = 'X-Correlation-Id';
const VALID_CORRELATION_ID = /^[A-Za-z0-9_-]{8,128}$/;

export function correlation(): RequestHandler {
  const nextUlid = monotonicFactory();
  return (req, res, next) => {
    const incoming = req.get(CORRELATION_HEADER);
    req.correlationId = incoming && VALID_CORRELATION_ID.test(incoming) ? incoming : nextUlid();
    res.setHeader(CORRELATION_HEADER, req.correlationId);
    next();
  };
}
