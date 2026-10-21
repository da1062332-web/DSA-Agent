// MOD-LND lender contacts (owner: Dev 3; DSA Notion SUB-LND.03, API-LND-006, ENT-042).
//   GET /v1/lenders/{id}/contacts   current contacts (any signed-in staff)
//   PUT /v1/lenders/{id}/contacts   replace the list (config.manage; If-Match on the lender version)
// Replacing closes the previous rows (removed_at) and inserts the new ones, so the history is kept. Contact details
// are personal data: they are never written to the audit log, only counts are.
import { AppError } from '@dsa/contracts';
import type { Router } from 'express';
import { sql } from 'kysely';
import { ifMatchVersion, requireCtx } from '../../../http/request';
import type { ApiDeps } from '../../types';
import { iso, loadForUpdate, updateVersioned, type Row } from './db';
import { ContactsPut, type LenderContact } from './schemas';

export const toContact = (r: Row): LenderContact => ({
  id: String(r.id),
  lenderId: String(r.lender_id),
  name: String(r.name),
  role: (r.role as string | null) ?? null,
  email: (r.email as string | null) ?? null,
  phone: (r.phone as string | null) ?? null,
  channel: (r.channel as string | null) ?? null,
  escalationLevel: Number(r.escalation_level),
  since: iso(r.created_at),
});

function requireAnyPermission(ctx: any, ...codes: string[]): void {
  if (ctx.principal.kind === 'SERVICE') return;
  const has = ctx.principal.grants.some((g: any) => codes.includes(g.code));
  if (!has) {
    throw AppError.of('FORBIDDEN', `One of these permissions is required: ${codes.join(', ')}.`);
  }
}

export function registerContactRoutes(router: Router, deps: ApiDeps): void {
  router.get('/lenders/:id/contacts', async (req, res) => {
    const ctx = requireCtx(req);
    const rows = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const lender = await sql<{ id: string }>`select id from lender where id = ${req.params.id}`.execute(tx);
      if (!lender.rows[0]) throw AppError.of('NOT_FOUND', 'Lender not found.');
      const r = await sql<Row>`
        select * from lender_contact
         where lender_id = ${req.params.id} and removed_at is null
         order by escalation_level, name, id`.execute(tx);
      return r.rows;
    });
    res.json({ data: rows.map(toContact), meta: { nextCursor: null, limit: rows.length } });
  });

  router.put('/lenders/:id/contacts', async (req, res) => {
    const ctx = requireCtx(req);
    requireAnyPermission(ctx, 'lender.manage', 'config.manage');
    const version = ifMatchVersion(req);
    const input = ContactsPut.parse(req.body);

    const result = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const lender = await loadForUpdate(tx, 'lender', req.params.id, 'Lender');
      // Bumps the lender version too, so two editors of the same lender cannot overwrite each other silently.
      const bumped = await updateVersioned(tx, ctx.principal.id, 'lender', lender, version, {});

      const closed = await sql<{ n: string }>`
        with c as (
          update lender_contact set removed_at = now()
           where lender_id = ${lender.id} and removed_at is null
          returning 1)
        select count(*)::text as n from c`.execute(tx);

      for (const c of input.contacts) {
        await sql`
          insert into lender_contact (id, tenant_id, lender_id, name, role, email, phone, channel, escalation_level, created_by)
          values (${deps.ids.next('lct')}, ${ctx.principal.tenantId}, ${lender.id}, ${c.name}, ${c.role ?? null},
                  ${c.email ?? null}, ${c.phone ?? null}, ${c.channel ?? null}, ${c.escalationLevel}, ${ctx.principal.id})`.execute(
          tx,
        );
      }

      await deps.audit.record(tx, ctx, {
        action: 'lender.contacts_replaced',
        entityType: 'LENDER',
        entityId: String(lender.id),
        before: { contactCount: Number(closed.rows[0]?.n ?? 0) },
        after: { contactCount: input.contacts.length },
        permissionUsed: 'config.manage',
      });

      const r = await sql<Row>`
        select * from lender_contact
         where lender_id = ${lender.id} and removed_at is null
         order by escalation_level, name, id`.execute(tx);
      return { rows: r.rows, version: Number(bumped.lock_version) };
    });
    res.set('ETag', `"${result.version}"`);
    res.json({ data: result.rows.map(toContact), meta: { nextCursor: null, limit: result.rows.length } });
  });

  // Removes one contact. The row is kept with removed_at set, so the history stays (no hard delete).
  router.delete('/lenders/:id/contacts/:contactId', async (req, res) => {
    const ctx = requireCtx(req);
    requireAnyPermission(ctx, 'lender.manage', 'config.manage');
    const version = ifMatchVersion(req);

    const result = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const lender = await loadForUpdate(tx, 'lender', req.params.id, 'Lender');
      const bumped = await updateVersioned(tx, ctx.principal.id, 'lender', lender, version, {});

      const found = await sql<Row>`
        select * from lender_contact
         where id = ${req.params.contactId} and lender_id = ${lender.id} and removed_at is null
         for update`.execute(tx);
      const contact = found.rows[0];
      if (!contact) throw AppError.of('NOT_FOUND', 'Contact not found.');

      await sql`update lender_contact set removed_at = now() where id = ${contact.id}`.execute(tx);
      // Audit carries the contact id and escalation level only. Names, emails and phones never reach the log.
      await deps.audit.record(tx, ctx, {
        action: 'lender.contact_removed',
        entityType: 'LENDER',
        entityId: String(lender.id),
        before: { contactId: String(contact.id), escalationLevel: Number(contact.escalation_level) },
        after: { contactId: String(contact.id), removed: true },
        permissionUsed: 'config.manage',
      });
      return { version: Number(bumped.lock_version), removedId: String(contact.id) };
    });
    res.set('ETag', `"${result.version}"`);
    res.json({ removedId: result.removedId, lenderVersion: result.version });
  });
}
