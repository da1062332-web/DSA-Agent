// The provisioning worker's Supabase Auth port (Architecture B): what each call sends, what it reads back, what it cleans up. fetch is
// faked, so nothing reaches a Supabase project.
import { describe, expect, it } from 'vitest';
import { createSupabaseAuthAdmin, providerCode } from '../src/provisioning/auth-admin';

describe('reading Supabase’s refusal', () => {
  it('TEST-PAUTH-08 the status and the machine code are kept; free text is never', () => {
    expect(
      providerCode({ status: 429, json: { code: 429, error_code: 'over_email_send_rate_limit', msg: 'x' } }),
    ).toBe('429 over_email_send_rate_limit');
    expect(providerCode({ status: 500, json: { error: 'Error sending recovery email to a@b.c' } })).toBe(
      '500',
    );
    expect(providerCode({ status: 502, json: null })).toBe('502');
  });
});

const URL_BASE = 'https://project.example.test';
const KEY = 'service-role-key-that-must-never-leak-0123456789';
const TENANT = 'ten_01AAAAAAAAAAAAAAAAAAAAAAAA';
const REDIRECT = 'http://localhost:5173/accept-invitation';

type Call = { method: string; path: string; body?: Record<string, unknown> };
type RawUser = { id: string; email: string; app_metadata?: Record<string, unknown> };

function fakeAuth(script: {
  users?: RawUser[];
  inviteStatus?: number;
  claimStatus?: number;
  listStatus?: number;
  recoverStatus?: number;
  network?: boolean;
}) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    if (script.network) throw new TypeError('fetch failed');
    const u = new URL(String(input));
    const method = init?.method ?? 'GET';
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    calls.push({ method, path: `${u.pathname}${u.search}`, body });
    const json = (b: unknown, status = 200) =>
      new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    const users = script.users ?? [];
    if (method === 'GET' && u.pathname === '/auth/v1/admin/users') {
      if (script.listStatus) return json({ message: 'boom' }, script.listStatus);
      const page = Number(u.searchParams.get('page') ?? '1');
      return json({ users: page === 1 ? users.slice(0, 200) : users.slice(200) });
    }
    if (method === 'GET' && u.pathname.startsWith('/auth/v1/admin/users/')) {
      const hit = users.find((x) => x.id === decodeURIComponent(u.pathname.split('/').pop()!));
      return hit ? json(hit) : json({ message: 'not found' }, 404);
    }
    if (method === 'POST' && u.pathname === '/auth/v1/invite') {
      if (script.inviteStatus) return json({ message: 'boom' }, script.inviteStatus);
      return json({ id: 'auth-new-1', email: body?.email });
    }
    if (method === 'PUT' && u.pathname.startsWith('/auth/v1/admin/users/'))
      return json({}, script.claimStatus ?? 200);
    if (method === 'DELETE' && u.pathname.startsWith('/auth/v1/admin/users/')) return json({}, 200);
    if (method === 'POST' && u.pathname === '/auth/v1/recover') return json({}, script.recoverStatus ?? 200);
    return json({ message: 'unexpected' }, 404);
  }) as unknown as typeof fetch;
  return { calls, port: createSupabaseAuthAdmin({ supabaseUrl: URL_BASE, serviceRoleKey: KEY, fetchImpl }) };
}

const create = (port: ReturnType<typeof createSupabaseAuthAdmin>) =>
  port.createInvitedAccount({
    email: 'new.staff@example.test',
    displayName: 'New Staff',
    tenantId: TENANT,
    redirectTo: REDIRECT,
  });

describe('the provisioning Auth port', () => {
  it('TEST-PAUTH-01 creating an invitee sends the invitation with the redirect, then writes the tenant claim', async () => {
    const { calls, port } = fakeAuth({});
    expect(await create(port)).toEqual({
      id: 'auth-new-1',
      email: 'new.staff@example.test',
      tenantId: TENANT,
    });
    expect(calls.map((c) => `${c.method} ${c.path.split('?')[0]}`)).toEqual([
      'POST /auth/v1/invite',
      'PUT /auth/v1/admin/users/auth-new-1',
    ]);
    expect(calls[0]?.path).toContain(`redirect_to=${encodeURIComponent(REDIRECT)}`);
    expect(calls[0]?.body).toEqual({ email: 'new.staff@example.test', data: { display_name: 'New Staff' } });
    expect(calls[1]?.body).toEqual({ app_metadata: { tenant_id: TENANT } });
  });

  it('TEST-PAUTH-02 when the tenant claim cannot be written, the new account is deleted and the call fails', async () => {
    const { calls, port } = fakeAuth({ claimStatus: 422 });
    await expect(create(port)).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
    expect(calls.map((c) => c.method)).toEqual(['POST', 'PUT', 'DELETE']);
  });

  it('TEST-PAUTH-03 a refused invitation creates nothing and writes no claim', async () => {
    const { calls, port } = fakeAuth({ inviteStatus: 500 });
    await expect(create(port)).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('TEST-PAUTH-04 an account is found by e-mail on any page, with its tenant claim read as given', async () => {
    const filler = Array.from({ length: 200 }, (_, i) => ({ id: `f${i}`, email: `filler${i}@example.test` }));
    const { port } = fakeAuth({
      users: [
        ...filler,
        { id: 'auth-late', email: 'New.Staff@example.test', app_metadata: { tenant_id: TENANT } },
      ],
    });
    expect(await port.findAccountByEmail('new.staff@example.test')).toEqual({
      id: 'auth-late',
      email: 'new.staff@example.test',
      tenantId: TENANT,
    });
    expect(await port.listAccounts()).toHaveLength(201);
  });

  it('TEST-PAUTH-05 an account without a tenant claim is reported with tenantId null, never guessed', async () => {
    const { port } = fakeAuth({ users: [{ id: 'auth-bare', email: 'bare@example.test' }] });
    expect(await port.getAccount('auth-bare')).toEqual({
      id: 'auth-bare',
      email: 'bare@example.test',
      tenantId: null,
    });
    expect(await port.getAccount('auth-missing')).toBeUndefined();
  });

  it('TEST-PAUTH-06 the set-password e-mail goes to the recovery endpoint with the redirect', async () => {
    const { calls, port } = fakeAuth({});
    await port.sendSetPasswordEmail({ email: 'new.staff@example.test', redirectTo: REDIRECT });
    expect(calls[0]?.path).toBe(`/auth/v1/recover?redirect_to=${encodeURIComponent(REDIRECT)}`);
    expect(calls[0]?.body).toEqual({ email: 'new.staff@example.test' });
    const refused = fakeAuth({ recoverStatus: 500 });
    await expect(
      refused.port.sendSetPasswordEmail({ email: 'new.staff@example.test', redirectTo: REDIRECT }),
    ).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
  });

  it('TEST-PAUTH-07 the service-role key never appears in an error, including a network failure', async () => {
    for (const script of [{ listStatus: 500 }, { network: true }]) {
      const { port } = fakeAuth(script);
      const err = await port.findAccountByEmail('x@example.test').catch((e: unknown) => e);
      expect(JSON.stringify(err)).not.toContain(KEY);
      expect(String((err as Error).message)).not.toContain(KEY);
      expect(err).toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
    }
  });
});
