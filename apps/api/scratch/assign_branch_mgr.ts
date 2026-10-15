import { createDb } from '../src/kernel-min/db';
import { sql } from 'kysely';
import { monotonicFactory } from 'ulid';

const nextUlid = monotonicFactory();

async function assign() {
  const db = createDb(process.env.VERIFY_DATABASE_URL!);
  const userId = 'usr_01M4X5JZPDFBBDJPWFSVK0KXTA';
  const roleId = 'role_01M4SXZDBV65D8Z8VAQC9GR51P'; // ROLE-BRANCH-MGR
  const tenantId = 'ten_01M4SXZ9E66W8T6DNJYBVNS3FA';

  const existing = await sql<{ id: string }>`
    SELECT id FROM app.user_role_assignment
    WHERE user_id = ${userId} AND role_id = ${roleId}
  `.execute(db);

  if (existing.rows.length === 0) {
    const id = `ura_${nextUlid()}`;
    await sql`
      INSERT INTO app.user_role_assignment (
        id, tenant_id, user_id, role_id, scope_type, scope_branch_ids,
        effective_range, created_by
      ) VALUES (
        ${id}, ${tenantId}, ${userId}, ${roleId}, 'TENANT', ARRAY[]::text[],
        tstzrange(now(), NULL, '[)'), 'SYSTEM:platform'
      )
    `.execute(db);
    console.log(`Assigned ROLE-BRANCH-MGR to ${userId} with id ${id}`);
  } else {
    console.log(`User already has ROLE-BRANCH-MGR`);
  }

  await db.destroy();
}

assign().catch(console.error);
