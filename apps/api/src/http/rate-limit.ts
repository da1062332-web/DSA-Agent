// Pass-through placeholder. TODO(TASK-105, Dev 1): token bucket per principal — 600/min overall, 60/min on
// rule-authoring endpoints; 429 RATE_LIMITED with Retry-After and RateLimit-* headers (Contracts §5).
import type { RequestHandler } from 'express';

export function rateLimit(): RequestHandler {
  return (_req, _res, next) => next();
}
