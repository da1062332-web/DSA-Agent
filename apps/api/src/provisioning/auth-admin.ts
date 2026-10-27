// Supabase Auth administration for staff invitations (owner: platform, API-USR-001; Architecture B). Used only by the provisioning
// worker (tools/provisioning-worker.ts) and the identity-binding tool, separate processes that hold the service-role key. The HTTP API
// never imports this folder (apps/api/test/service-key-boundary.spec.ts). The tenant is written to the account's app_metadata, the
// trusted claim ADR-SB-02 reserves for provisioning tooling; it is always the tenant of the invitation row, never a value from a request.
import { AppError } from '@dsa/contracts';

export interface AuthAccount {
  /** The Supabase Auth user id: the immutable subject of every token the account receives. */
  id: string;
  /** The account's e-mail address in lower case, or null. */
  email: string | null;
  /** app_metadata.tenant_id when it is a string, else null (no claim). */
  tenantId: string | null;
}

export interface AuthAdminPort {
  findAccountByEmail(email: string): Promise<AuthAccount | undefined>;
  getAccount(id: string): Promise<AuthAccount | undefined>;
  /** Every account in the project, page by page. */
  listAccounts(): Promise<AuthAccount[]>;
  /**
   * Creates the account and asks Supabase to send the invitation e-mail, then writes the tenant claim. If the claim cannot be written,
   * the account is deleted again, so no invitation leads to an account without its tenant.
   */
  createInvitedAccount(input: {
    email: string;
    displayName: string;
    tenantId: string;
    redirectTo: string;
  }): Promise<AuthAccount>;
  /** Asks Supabase to send a set-password (recovery) e-mail to an existing account. */
  sendSetPasswordEmail(input: { email: string; redirectTo: string }): Promise<void>;
  /** Deletes an account for good. An account that no longer exists counts as deleted. */
  deleteAccount(id: string): Promise<void>;
}

export interface SupabaseAuthAdminOptions {
  supabaseUrl: string;
  serviceRoleKey: string;
  fetchImpl?: typeof fetch;
}

const PAGE_SIZE = 200;

/** The JSON body of a response, or null when there is none. Each field is checked where it is read. */
type Json = Record<string, unknown> | null;

function toAccount(raw: unknown): AuthAccount | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const u = raw as { id?: unknown; email?: unknown; app_metadata?: { tenant_id?: unknown } | null };
  if (typeof u.id !== 'string') return undefined;
  return {
    id: u.id,
    email: typeof u.email === 'string' ? u.email.toLowerCase() : null,
    tenantId: typeof u.app_metadata?.tenant_id === 'string' ? u.app_metadata.tenant_id : null,
  };
}

/** "<HTTP status> <provider code>", where the code is kept only if it is a plain snake_case token. */
export function providerCode(r: { status: number; json: Json }): string {
  const raw = r.json?.error_code ?? r.json?.error;
  const code = typeof raw === 'string' && /^[a-z0-9_]{1,64}$/.test(raw) ? ` ${raw}` : '';
  return `${r.status}${code}`;
}

/** Errors carry a fixed message: never the key, never a provider response body. */
export function createSupabaseAuthAdmin(opts: SupabaseAuthAdminOptions): AuthAdminPort {
  const base = opts.supabaseUrl.replace(/\/+$/, '');
  const fetchImpl = opts.fetchImpl ?? fetch;
  const headers = {
    apikey: opts.serviceRoleKey,
    Authorization: `Bearer ${opts.serviceRoleKey}`,
    'Content-Type': 'application/json',
  };

  async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: Json }> {
    let res: Response;
    try {
      res = await fetchImpl(`${base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw unavailable();
    }
    const json = (await res.json().catch(() => null)) as Json;
    return { status: res.status, json };
  }

  // The provider's HTTP status and machine code (for example "429 over_email_send_rate_limit") travel in the error's details so the
  // worker can log why a send failed. Never the response text: it can repeat the address.
  const unavailable = (r?: { status: number; json: Json }) =>
    AppError.of(
      'DEPENDENCY_UNAVAILABLE',
      'The sign-in service did not accept the request.',
      r ? [{ field: 'supabase', issue: providerCode(r) }] : [{ field: 'supabase', issue: 'network_error' }],
    );

  async function listAccounts(): Promise<AuthAccount[]> {
    const all: AuthAccount[] = [];
    for (let page = 1; ; page++) {
      const r = await call('GET', `/auth/v1/admin/users?page=${page}&per_page=${PAGE_SIZE}`);
      if (r.status !== 200) throw unavailable(r);
      const listed = r.json?.users;
      const users = Array.isArray(listed) ? listed : [];
      for (const u of users) {
        const account = toAccount(u);
        if (account) all.push(account);
      }
      if (users.length < PAGE_SIZE) return all;
    }
  }

  return {
    listAccounts,

    async findAccountByEmail(email) {
      const wanted = email.toLowerCase();
      for (let page = 1; ; page++) {
        const r = await call('GET', `/auth/v1/admin/users?page=${page}&per_page=${PAGE_SIZE}`);
        if (r.status !== 200) throw unavailable(r);
        const listed = r.json?.users;
        const users = Array.isArray(listed) ? listed : [];
        for (const u of users) {
          const account = toAccount(u);
          if (account?.email === wanted) return account;
        }
        if (users.length < PAGE_SIZE) return undefined;
      }
    },

    async getAccount(id) {
      const r = await call('GET', `/auth/v1/admin/users/${encodeURIComponent(id)}`);
      if (r.status === 404) return undefined;
      if (r.status !== 200) throw unavailable(r);
      return toAccount(r.json);
    },

    async createInvitedAccount({ email, displayName, tenantId, redirectTo }) {
      const invited = await call('POST', `/auth/v1/invite?redirect_to=${encodeURIComponent(redirectTo)}`, {
        email,
        data: { display_name: displayName },
      });
      const account = invited.status < 300 ? toAccount(invited.json) : undefined;
      if (!account) throw unavailable(invited);

      const claim = await call('PUT', `/auth/v1/admin/users/${encodeURIComponent(account.id)}`, {
        app_metadata: { tenant_id: tenantId },
      });
      if (claim.status >= 300) {
        await call('DELETE', `/auth/v1/admin/users/${encodeURIComponent(account.id)}`).catch(() => undefined);
        throw unavailable(claim);
      }
      return { ...account, tenantId };
    },

    async sendSetPasswordEmail({ email, redirectTo }) {
      const sent = await call('POST', `/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`, {
        email,
      });
      if (sent.status >= 300) throw unavailable(sent);
    },

    async deleteAccount(id) {
      const r = await call('DELETE', `/auth/v1/admin/users/${encodeURIComponent(id)}`);
      if (r.status >= 300 && r.status !== 404) throw unavailable(r);
    },
  };
}
