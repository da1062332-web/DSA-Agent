// Every /v1 request is 401 until TASK-102 replaces this with Supabase JWT verification.
// Tests inject fakeAuth(principal) through createApp({ auth }).
import { AppError } from '@dsa/contracts';
import type { RequestHandler } from 'express';

export const authPlaceholder: RequestHandler = (_req, _res, next) => {
  next(AppError.of('UNAUTHENTICATED', 'Missing or invalid access token.'));
};
