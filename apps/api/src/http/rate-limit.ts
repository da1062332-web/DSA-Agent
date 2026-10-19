// Rate limiting (TASK-105, Contracts §5). A token bucket per caller: 600 requests a minute overall and 60 a minute on
// rule-authoring writes. The caller is the authenticated principal (tenant + id); before authentication (the public routes)
// it is the client IP. Over the limit the answer is 429 RATE_LIMITED with Retry-After, and every answer carries
// RateLimit-Limit, RateLimit-Remaining and RateLimit-Reset.
// Buckets live in this process, one store per app instance. Behind several API instances each one enforces its own share,
// which still bounds a caller; a shared store can replace BucketStore without changing callers.
import { AppError } from '@dsa/contracts';
import type { Request, RequestHandler } from 'express';

export interface RateLimitOptions {
  /** Requests per minute for ordinary routes. Default 600. */
  perMinute?: number;
  /** Requests per minute for rule-authoring writes (POST/PUT/PATCH/DELETE under /rule-sets and /rule-set-versions). Default 60. */
  ruleAuthoringPerMinute?: number;
  /** Clock in milliseconds, for tests. */
  now?: () => number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const RULE_AUTHORING = /^\/(rule-sets|rule-set-versions)(\/|$)/;
const MAX_BUCKETS = 50_000;

function callerKey(req: Request): string {
  const p = req.ctx?.principal;
  return p ? `p:${p.tenantId}:${p.id}` : `ip:${req.ip ?? 'unknown'}`;
}

export function rateLimit(opts: RateLimitOptions = {}): RequestHandler {
  const perMinute = opts.perMinute ?? 600;
  const ruleAuthoringPerMinute = opts.ruleAuthoringPerMinute ?? 60;
  const now = opts.now ?? Date.now;
  const buckets = new Map<string, Bucket>();

  const take = (key: string, capacity: number): { allowed: boolean; remaining: number; resetSeconds: number } => {
    const t = now();
    const refillPerMs = capacity / 60_000;
    const existing = buckets.get(key);
    const bucket = existing ?? { tokens: capacity, updatedAt: t };
    bucket.tokens = Math.min(capacity, bucket.tokens + (t - bucket.updatedAt) * refillPerMs);
    bucket.updatedAt = t;
    if (!existing) {
      // Bound memory: drop the oldest entry (Map keeps insertion order) once the table is full.
      if (buckets.size >= MAX_BUCKETS) buckets.delete(buckets.keys().next().value!);
      buckets.set(key, bucket);
    }
    const allowed = bucket.tokens >= 1;
    if (allowed) bucket.tokens -= 1;
    const missing = capacity - bucket.tokens;
    return {
      allowed,
      remaining: Math.floor(bucket.tokens),
      resetSeconds: Math.max(1, Math.ceil(allowed ? missing / refillPerMs / 1000 : (1 - bucket.tokens) / refillPerMs / 1000)),
    };
  };

  return (req, res, next) => {
    const ruleWrite = req.method !== 'GET' && req.method !== 'HEAD' && RULE_AUTHORING.test(req.path);
    const capacity = ruleWrite ? ruleAuthoringPerMinute : perMinute;
    const result = take(`${callerKey(req)}${ruleWrite ? ':rules' : ''}`, capacity);
    res.set('RateLimit-Limit', String(capacity));
    res.set('RateLimit-Remaining', String(result.remaining));
    res.set('RateLimit-Reset', String(result.resetSeconds));
    if (!result.allowed) {
      res.set('Retry-After', String(result.resetSeconds));
      next(AppError.of('RATE_LIMITED', 'Too many requests. Try again shortly.'));
      return;
    }
    next();
  };
}
