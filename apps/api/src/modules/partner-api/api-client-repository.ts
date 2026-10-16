// Persistence for API clients (owner: Dev 1; Module 36 API management). The routes used to keep clients in a Map inside the service,
// so a restart lost every client and its credentials. PgApiClientRepository stores them in app.api_client through withTenantTx,
// so row-level security keeps each tenant to its own rows; only the SHA-256 hash of the secret is stored. Every change records an audit
// event in the same transaction (ids, names and scopes only, never a secret or a hash). InMemoryApiClientRepository
// backs unit tests only and is the default when no repository is passed in.
import type { AuditPort, RequestContext, TxRunner } from '@dsa/contracts';
import { sql } from 'kysely';
import type { ApiClientRecord } from './service';

export interface ApiClientRepository {
  list(ctx: RequestContext): Promise<ApiClientRecord[]>;
  get(ctx: RequestContext, id: string): Promise<ApiClientRecord | null>;
  create(ctx: RequestContext, record: ApiClientRecord): Promise<void>;
  /** Applies the changes and bumps lock_version; null when the client is not the caller's (or is revoked). */
  update(
    ctx: RequestContext,
    id: string,
    patch: Partial<Pick<ApiClientRecord, 'name' | 'partnerName' | 'status' | 'scopes' | 'rateLimitRpm' | 'allowedIps'>>,
  ): Promise<ApiClientRecord | null>;
  /** Replaces the secret hash and bumps lock_version. */
  rotateSecret(ctx: RequestContext, id: string, clientSecretHash: string): Promise<ApiClientRecord | null>;
  /** Revokes the client: it stops authenticating and disappears from list and get, but the row stays for the record. */
  revoke(ctx: RequestContext, id: string): Promise<boolean>;
}

type Row = {
  id: string;
  tenant_id: string;
  client_id: string;
  client_secret_hash: string;
  name: string;
  partner_name: string;
  status: ApiClientRecord['status'];
  scopes: string[] | null;
  rate_limit_rpm: number | string;
  allowed_ips: string[] | null;
  last_used_at: string | Date | null;
  lock_version: number | string;
  created_at: string | Date;
  updated_at: string | Date;
  created_by: string;
  updated_by: string;
};

const iso = (v: string | Date) => new Date(v).toISOString();

const toRecord = (r: Row): ApiClientRecord => ({
  id: r.id,
  tenantId: r.tenant_id,
  clientId: r.client_id,
  clientSecretHash: r.client_secret_hash,
  name: r.name,
  partnerName: r.partner_name,
  status: r.status,
  scopes: r.scopes ?? [],
  rateLimitRpm: Number(r.rate_limit_rpm),
  allowedIps: r.allowed_ips ?? null,
  lastUsedAt: r.last_used_at ? iso(r.last_used_at) : null,
  lockVersion: Number(r.lock_version),
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
  createdBy: r.created_by,
  updatedBy: r.updated_by,
});

/** Postgres array literal for a text[] parameter. */
const textArray = (values: string[] | null | undefined) => (values == null ? null : values);

export class PgApiClientRepository implements ApiClientRepository {
  constructor(
    private readonly txRunner: TxRunner,
    private readonly auditPort: AuditPort,
  ) {}

  private audit(tx: Parameters<AuditPort['record']>[0], ctx: RequestContext, action: string, id: string, extra: { before?: Record<string, unknown>; after?: Record<string, unknown> } = {}) {
    return this.auditPort.record(tx, ctx, { action, entityType: 'API_CLIENT', entityId: id, permissionUsed: 'api.manage', ...extra });
  }

  list(ctx: RequestContext): Promise<ApiClientRecord[]> {
    return this.txRunner.withTenantTx(ctx, async (tx) => {
      const res = await sql<Row>`
        SELECT * FROM app.api_client WHERE tenant_id = ${ctx.principal.tenantId} AND status <> 'REVOKED' ORDER BY created_at DESC, id`.execute(tx);
      return res.rows.map(toRecord);
    });
  }

  get(ctx: RequestContext, id: string): Promise<ApiClientRecord | null> {
    return this.txRunner.withTenantTx(ctx, async (tx) => {
      const res = await sql<Row>`
        SELECT * FROM app.api_client WHERE id = ${id} AND tenant_id = ${ctx.principal.tenantId} AND status <> 'REVOKED'`.execute(tx);
      return res.rows[0] ? toRecord(res.rows[0]) : null;
    });
  }

  create(ctx: RequestContext, r: ApiClientRecord): Promise<void> {
    return this.txRunner.withTenantTx(ctx, async (tx) => {
      await sql`
        INSERT INTO app.api_client (id, tenant_id, client_id, client_secret_hash, name, partner_name, status, scopes, rate_limit_rpm,
                                    allowed_ips, last_used_at, lock_version, created_at, updated_at, created_by, updated_by)
        VALUES (${r.id}, ${r.tenantId}, ${r.clientId}, ${r.clientSecretHash}, ${r.name}, ${r.partnerName}, ${r.status},
                ${textArray(r.scopes)}, ${r.rateLimitRpm}, ${textArray(r.allowedIps)}, NULL, ${r.lockVersion},
                ${r.createdAt}::timestamptz, ${r.updatedAt}::timestamptz, ${r.createdBy}, ${r.updatedBy})`.execute(tx);
      await this.audit(tx, ctx, 'api_client.created', r.id, {
        after: { clientId: r.clientId, name: r.name, partnerName: r.partnerName, scopes: r.scopes, rateLimitRpm: r.rateLimitRpm },
      });
    });
  }

  update(
    ctx: RequestContext,
    id: string,
    patch: Parameters<ApiClientRepository['update']>[2],
  ): Promise<ApiClientRecord | null> {
    return this.txRunner.withTenantTx(ctx, async (tx) => {
      const current = await sql<Row>`
        SELECT * FROM app.api_client WHERE id = ${id} AND tenant_id = ${ctx.principal.tenantId} AND status <> 'REVOKED' FOR UPDATE`.execute(tx);
      const row = current.rows[0];
      if (!row) return null;
      const next = {
        name: patch.name ?? row.name,
        partner_name: patch.partnerName ?? row.partner_name,
        status: patch.status ?? row.status,
        scopes: patch.scopes ?? row.scopes ?? [],
        rate_limit_rpm: patch.rateLimitRpm ?? Number(row.rate_limit_rpm),
        allowed_ips: patch.allowedIps === undefined ? row.allowed_ips : patch.allowedIps,
      };
      const updated = await sql<Row>`
        UPDATE app.api_client SET name = ${next.name}, partner_name = ${next.partner_name}, status = ${next.status},
               scopes = ${textArray(next.scopes)}, rate_limit_rpm = ${next.rate_limit_rpm}, allowed_ips = ${textArray(next.allowed_ips)},
               lock_version = lock_version + 1, updated_at = ${ctx.now.toISOString()}::timestamptz, updated_by = ${ctx.principal.id}
         WHERE id = ${id} AND tenant_id = ${ctx.principal.tenantId} RETURNING *`.execute(tx);
      if (!updated.rows[0]) return null;
      await this.audit(tx, ctx, 'api_client.updated', id, {
        before: { name: row.name, partnerName: row.partner_name, status: row.status, scopes: row.scopes ?? [], rateLimitRpm: Number(row.rate_limit_rpm) },
        after: { name: next.name, partnerName: next.partner_name, status: next.status, scopes: next.scopes, rateLimitRpm: next.rate_limit_rpm },
      });
      return toRecord(updated.rows[0]);
    });
  }

  rotateSecret(ctx: RequestContext, id: string, clientSecretHash: string): Promise<ApiClientRecord | null> {
    return this.txRunner.withTenantTx(ctx, async (tx) => {
      const res = await sql<Row>`
        UPDATE app.api_client SET client_secret_hash = ${clientSecretHash}, lock_version = lock_version + 1,
               updated_at = ${ctx.now.toISOString()}::timestamptz, updated_by = ${ctx.principal.id}
         WHERE id = ${id} AND tenant_id = ${ctx.principal.tenantId} AND status <> 'REVOKED' RETURNING *`.execute(tx);
      if (!res.rows[0]) return null;
      await this.audit(tx, ctx, 'api_client.secret_rotated', id, { after: { clientId: res.rows[0].client_id } }); // never the secret or its hash
      return toRecord(res.rows[0]);
    });
  }

  revoke(ctx: RequestContext, id: string): Promise<boolean> {
    return this.txRunner.withTenantTx(ctx, async (tx) => {
      const res = await sql<{ id: string }>`
        UPDATE app.api_client SET status = 'REVOKED', lock_version = lock_version + 1,
               updated_at = ${ctx.now.toISOString()}::timestamptz, updated_by = ${ctx.principal.id}
         WHERE id = ${id} AND tenant_id = ${ctx.principal.tenantId} AND status <> 'REVOKED' RETURNING id`.execute(tx);
      if (res.rows.length === 0) return false;
      await this.audit(tx, ctx, 'api_client.revoked', id);
      return true;
    });
  }
}

export class InMemoryApiClientRepository implements ApiClientRepository {
  private readonly clients = new Map<string, ApiClientRecord>();

  async list(ctx: RequestContext): Promise<ApiClientRecord[]> {
    return [...this.clients.values()]
      .filter((c) => c.tenantId === ctx.principal.tenantId && c.status !== 'REVOKED')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map((c) => ({ ...c }));
  }

  async get(ctx: RequestContext, id: string): Promise<ApiClientRecord | null> {
    const c = this.clients.get(id);
    return c && c.tenantId === ctx.principal.tenantId && c.status !== 'REVOKED' ? { ...c } : null;
  }

  async create(_ctx: RequestContext, record: ApiClientRecord): Promise<void> {
    this.clients.set(record.id, { ...record });
  }

  async update(ctx: RequestContext, id: string, patch: Parameters<ApiClientRepository['update']>[2]): Promise<ApiClientRecord | null> {
    const c = this.clients.get(id);
    if (!c || c.tenantId !== ctx.principal.tenantId || c.status === 'REVOKED') return null;
    if (patch.name !== undefined) c.name = patch.name;
    if (patch.partnerName !== undefined) c.partnerName = patch.partnerName;
    if (patch.status !== undefined) c.status = patch.status;
    if (patch.scopes !== undefined) c.scopes = patch.scopes;
    if (patch.rateLimitRpm !== undefined) c.rateLimitRpm = patch.rateLimitRpm;
    if (patch.allowedIps !== undefined) c.allowedIps = patch.allowedIps;
    c.lockVersion += 1;
    c.updatedAt = ctx.now.toISOString();
    c.updatedBy = ctx.principal.id;
    return { ...c };
  }

  async rotateSecret(ctx: RequestContext, id: string, clientSecretHash: string): Promise<ApiClientRecord | null> {
    const c = this.clients.get(id);
    if (!c || c.tenantId !== ctx.principal.tenantId || c.status === 'REVOKED') return null;
    c.clientSecretHash = clientSecretHash;
    c.lockVersion += 1;
    c.updatedAt = ctx.now.toISOString();
    c.updatedBy = ctx.principal.id;
    return { ...c };
  }

  async revoke(ctx: RequestContext, id: string): Promise<boolean> {
    const c = this.clients.get(id);
    if (!c || c.tenantId !== ctx.principal.tenantId || c.status === 'REVOKED') return false;
    c.status = 'REVOKED';
    c.lockVersion += 1;
    c.updatedAt = ctx.now.toISOString();
    c.updatedBy = ctx.principal.id;
    return true;
  }
}
