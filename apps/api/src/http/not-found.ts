import { AppError } from '@dsa/contracts';
import type { RequestHandler } from 'express';

export const notFound: RequestHandler = (_req, _res, next) => {
  next(AppError.of('NOT_FOUND', 'Resource not found.'));
};
