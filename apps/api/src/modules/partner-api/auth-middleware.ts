// apps/api/src/modules/partner-api/auth-middleware.ts — owner: Akash (Module 37: API Development)
import crypto from 'node:crypto';
import { AppError, type PermissionCode, type Principal } from '@dsa/contracts';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ApiDeps } from '../types';

export interface ApiKeyRecord {
  id: string;
  tenantId: string;
  partnerId: string;
  name: string;
  keyPrefix: string;
  keyHash: string;
  scopes: string[];
  allowedIps?: string[] | null;
  rateLimitRpm: number;
  status: 'ACTIVE' | 'REVOKED' | 'EXPIRED';
  expiresAt?: string | null;
}

export interface ApiKeyStore {
  findByHash(hash: string): Promise<ApiKeyRecord | null>;
  touchLastUsed(id: string): Promise<void>;
}

export class InMemoryApiKeyStore implements ApiKeyStore {
  private keys = new Map<string, ApiKeyRecord>();

  constructor(initialKeys: ApiKeyRecord[] = []) {
    for (const k of initialKeys) this.keys.set(k.keyHash, k);
  }

  addKey(key: ApiKeyRecord) {
    this.keys.set(key.keyHash, key);
  }

  async findByHash(hash: string): Promise<ApiKeyRecord | null> {
    return this.keys.get(hash) ?? null;
  }

  async touchLastUsed(_id: string): Promise<void> {}
}

interface KyselyDbLike {
  selectFrom(table: string): {
    select(fields: string[]): {
      where(
        col: string,
        op: string,
        val: string,
      ): {
        executeTakeFirst(): Promise<Record<string, unknown> | undefined>;
      };
    };
  };
  updateTable(table: string): {
    set(values: Record<string, unknown>): {
      where(
        col: string,
        op: string,
        val: string,
      ): {
        execute(): Promise<unknown>;
      };
    };
  };
}

export class DatabaseApiKeyStore implements ApiKeyStore {
  constructor(private deps: ApiDeps) {}

  async findByHash(hash: string): Promise<ApiKeyRecord | null> {
    try {
      // Query database directly if Kysely / sql available
      const db = (this.deps as unknown as { db?: KyselyDbLike }).db;
      if (!db) return null;
      const row = await db
        .selectFrom('app.api_key')
        .select([
          'id',
          'tenant_id as tenantId',
          'partner_id as partnerId',
          'name',
          'key_prefix as keyPrefix',
          'key_hash as keyHash',
          'scopes',
          'allowed_ips as allowedIps',
          'rate_limit_rpm as rateLimitRpm',
          'status',
          'expires_at as expiresAt',
        ])
        .where('key_hash', '=', hash)
        .executeTakeFirst();
      if (!row) return null;
      return {
        ...(row as unknown as ApiKeyRecord),
        scopes: Array.isArray(row.scopes) ? (row.scopes as string[]) : [],
      };
    } catch {
      return null;
    }
  }

  async touchLastUsed(id: string): Promise<void> {
    try {
      const db = (this.deps as unknown as { db?: KyselyDbLike }).db;
      if (!db) return;
      await db.updateTable('app.api_key').set({ last_used_at: new Date() }).where('id', '=', id).execute();
    } catch {
      // Non-critical audit touch error, safely ignored
    }
  }
}

export function hashApiKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey.trim()).digest('hex');
}

export function createPartnerAuthMiddleware(apiKeyStore: ApiKeyStore): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      // 1. Check if user already authenticated via Supabase / fakeAuth
      if (req.ctx?.principal) {
        return next();
      }

      // 2. Extract API Key from X-API-Key or Authorization Bearer header
      const headerKey = req.get('X-API-Key') ?? req.get('x-api-key');
      let rawKey = headerKey;
      if (!rawKey) {
        const auth = req.get('authorization') ?? '';
        if (auth.startsWith('Bearer dsa_live_') || auth.startsWith('Bearer dsa_test_')) {
          rawKey = auth.slice(7);
        }
      }

      if (!rawKey) {
        throw AppError.of(
          'UNAUTHENTICATED',
          'Missing API Key. Provide via X-API-Key header or Bearer token.',
        );
      }

      // 3. Compute hash and lookup
      const hashed = hashApiKey(rawKey);
      const record = await apiKeyStore.findByHash(hashed);

      if (!record) {
        throw AppError.of('UNAUTHENTICATED', 'Invalid or unrecognised API Key.');
      }

      if (record.status === 'REVOKED') {
        throw AppError.of('UNAUTHENTICATED', 'API Key has been revoked.');
      }

      if (record.status === 'EXPIRED' || (record.expiresAt && new Date(record.expiresAt) < new Date())) {
        throw AppError.of('UNAUTHENTICATED', 'API Key has expired.');
      }

      // 4. IP allowlist check if configured
      if (record.allowedIps && record.allowedIps.length > 0) {
        const clientIp = req.ip || req.socket.remoteAddress || '';
        const allowed = record.allowedIps.some((ip) => ip === clientIp || clientIp.includes(ip));
        if (!allowed) {
          throw AppError.of('FORBIDDEN', `Client IP ${clientIp} not permitted for this API Key.`);
        }
      }

      // 5. Establish SERVICE principal RequestContext
      const principal: Principal = {
        kind: 'SERVICE',
        id: record.id,
        tenantId: record.tenantId,
        primaryBranchId: null,
        managedTeamMemberIds: [],
        queueIds: [],
        grants: record.scopes.map((s) => ({
          code: s as PermissionCode,
          scope: 'TENANT',
          branchIds: [],
        })),
        authTime: null,
      };

      req.ctx = {
        principal,
        correlationId: req.correlationId,
        now: new Date(),
        ip: req.ip,
        userAgent: req.get('user-agent'),
      };

      // Asynchronously record last used
      void apiKeyStore.touchLastUsed(record.id);

      next();
    } catch (err) {
      next(err);
    }
  };
}
