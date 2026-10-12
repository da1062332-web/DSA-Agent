import type { RequestContext } from '@dsa/contracts';

declare global {
  namespace Express {
    interface Request {
      /** Set by the correlation middleware on every request. */
      correlationId: string;
      /** Set by the auth middleware for /v1 requests (TASK-102; fakeAuth in tests). */
      ctx?: RequestContext;
    }
  }
}

export {};
