// apps/api/src/modules/origination/document-sharing/router.ts
// Module 25: Document Sharing (MOD-DSH)
import { Router, type Request, type Response } from 'express';
import {
  AppError,
  CreateShareSchema,
  CreateUploadLinkSchema,
  ListSharesQuerySchema,
  ListUploadLinksQuerySchema,
  VerifyUploadOtpSchema,
  type RequestContext,
} from '@dsa/contracts';
import type { ApiDeps } from '../../types';
import { DocumentSharingService } from './document-sharing-service';

export function createRouter(deps: ApiDeps, serviceOverride?: DocumentSharingService): Router {
  const router = Router();
  const service = serviceOverride ?? new DocumentSharingService(deps);

  /**
   * API-DSH-001: POST /v1/upload-links
   */
  router.post('/upload-links', async (req: Request, res: Response, next) => {
    try {
      const ctx = req.ctx as RequestContext | undefined;
      if (!ctx || !ctx.principal) throw AppError.of('UNAUTHENTICATED', 'Authentication required.');
      deps.authz.requirePermission(ctx, 'document.upload');

      const idempotencyKey = req.get('Idempotency-Key');
      if (!idempotencyKey) {
        throw AppError.of(
          'VALIDATION_ERROR',
          'Idempotency-Key header is required for creating upload links.',
          [{ field: 'Idempotency-Key', issue: 'REQUIRED' }],
        );
      }
      if (!/^[A-Za-z0-9_-]{8,128}$/.test(idempotencyKey)) {
        throw AppError.of('VALIDATION_ERROR', 'Invalid Idempotency-Key format.', [
          { field: 'Idempotency-Key', issue: 'INVALID_FORMAT' },
        ]);
      }

      const input = CreateUploadLinkSchema.parse(req.body);
      const { link, isReplayed } = await service.createUploadLink(ctx, input, idempotencyKey);

      res.setHeader('ETag', `"${link.lockVersion}"`);
      if (isReplayed) res.setHeader('Idempotent-Replayed', 'true');
      res.status(isReplayed ? 200 : 201).json(link);
    } catch (err) {
      next(err);
    }
  });

  /**
   * Helper: GET /v1/upload-links
   */
  router.get('/upload-links', async (req: Request, res: Response, next) => {
    try {
      const ctx = req.ctx as RequestContext | undefined;
      if (!ctx || !ctx.principal) throw AppError.of('UNAUTHENTICATED', 'Authentication required.');

      const query = ListUploadLinksQuerySchema.parse(req.query);
      const result = await service.listUploadLinks(ctx, query);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  /**
   * API-DSH-002: POST /v1/upload-links/:id/revocation
   */
  router.post('/upload-links/:id/revocation', async (req: Request, res: Response, next) => {
    try {
      const ctx = req.ctx as RequestContext | undefined;
      if (!ctx || !ctx.principal) throw AppError.of('UNAUTHENTICATED', 'Authentication required.');

      const id = String(req.params.id ?? '');
      const result = await service.revokeUploadLink(ctx, id);
      res.setHeader('ETag', `"${result.lockVersion}"`);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  /**
   * API-DSH-006: POST /v1/shares
   */
  router.post('/shares', async (req: Request, res: Response, next) => {
    try {
      const ctx = req.ctx as RequestContext | undefined;
      if (!ctx || !ctx.principal) throw AppError.of('UNAUTHENTICATED', 'Authentication required.');
      deps.authz.requirePermission(ctx, 'share.create');

      const idempotencyKey = req.get('Idempotency-Key');
      if (!idempotencyKey) {
        throw AppError.of(
          'VALIDATION_ERROR',
          'Idempotency-Key header is required for creating share packages.',
          [{ field: 'Idempotency-Key', issue: 'REQUIRED' }],
        );
      }
      if (!/^[A-Za-z0-9_-]{8,128}$/.test(idempotencyKey)) {
        throw AppError.of('VALIDATION_ERROR', 'Invalid Idempotency-Key format.', [
          { field: 'Idempotency-Key', issue: 'INVALID_FORMAT' },
        ]);
      }

      const input = CreateShareSchema.parse(req.body);
      const { share, isReplayed } = await service.createShare(ctx, input, idempotencyKey);

      res.setHeader('ETag', `"${share.lockVersion}"`);
      if (isReplayed) res.setHeader('Idempotent-Replayed', 'true');
      res.status(isReplayed ? 200 : 201).json(share);
    } catch (err) {
      next(err);
    }
  });

  /**
   * API-DSH-007: POST /v1/shares/:id/revocation
   */
  router.post('/shares/:id/revocation', async (req: Request, res: Response, next) => {
    try {
      const ctx = req.ctx as RequestContext | undefined;
      if (!ctx || !ctx.principal) throw AppError.of('UNAUTHENTICATED', 'Authentication required.');

      const id = String(req.params.id ?? '');
      const result = await service.revokeShare(ctx, id);
      res.setHeader('ETag', `"${result.lockVersion}"`);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  /**
   * API-DSH-008: GET /v1/shares
   */
  router.get('/shares', async (req: Request, res: Response, next) => {
    try {
      const ctx = req.ctx as RequestContext | undefined;
      if (!ctx || !ctx.principal) throw AppError.of('UNAUTHENTICATED', 'Authentication required.');

      const query = ListSharesQuerySchema.parse(req.query);
      const result = await service.listShares(ctx, query);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

/**
 * Public router mounted under /public/v1
 */
export function createPublicDocumentSharingRouter(
  deps: ApiDeps,
  serviceOverride?: DocumentSharingService,
): Router {
  const router = Router();
  const service = serviceOverride ?? new DocumentSharingService(deps);

  /**
   * API-DSH-003: GET /public/v1/upload/:token
   */
  router.get('/upload/:token', async (req: Request, res: Response, next) => {
    try {
      const token = String(req.params.token ?? '');
      if (!token) throw AppError.of('NOT_FOUND', 'Upload token required.');

      const status = await service.getPublicUploadStatus(token);
      res.status(200).json(status);
    } catch (err) {
      next(err);
    }
  });

  /**
   * API-DSH-004: POST /public/v1/upload/:token/otp-verification
   */
  router.post('/upload/:token/otp-verification', async (req: Request, res: Response, next) => {
    try {
      const token = String(req.params.token ?? '');
      if (!token) throw AppError.of('NOT_FOUND', 'Upload token required.');

      const { otp } = VerifyUploadOtpSchema.parse(req.body);
      const result = await service.verifyUploadOtp(token, otp);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  /**
   * API-DSH-005: POST /public/v1/upload/:token/files
   */
  router.post('/upload/:token/files', async (req: Request, res: Response, next) => {
    try {
      const token = String(req.params.token ?? '');
      if (!token) throw AppError.of('NOT_FOUND', 'Upload token required.');

      const authHeader = req.get('Authorization') ?? '';
      const sessionToken = authHeader.replace(/^Bearer\s+/i, '') || req.body?.uploadSessionToken;
      if (!sessionToken) {
        throw AppError.of('UNAUTHENTICATED', 'Missing upload session token header.');
      }

      const { checklistItemId, filename, mimeType, contentBase64 } = req.body ?? {};
      if (!checklistItemId || !filename || !mimeType || !contentBase64) {
        throw AppError.of(
          'VALIDATION_ERROR',
          'File payload requires checklistItemId, filename, mimeType, and contentBase64.',
        );
      }

      const fileBuffer = Buffer.from(contentBase64, 'base64');
      const result = await service.uploadPublicFile(
        token,
        sessionToken,
        checklistItemId,
        fileBuffer,
        filename,
        mimeType,
      );

      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
