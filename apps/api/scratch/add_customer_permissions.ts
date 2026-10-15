import { createDb } from '../src/kernel-min/db';
import { sql } from 'kysely';

async function main() {
  const db = createDb(process.env.VERIFY_DATABASE_URL!);
  const tenantId = 'ten_01M4SXZ9E66W8T6DNJYBVNS3FA';
  
  // 1. Insert into app.permission with introduced_in
  await sql`
    INSERT INTO app.permission (code, description, introduced_in)
    VALUES 
      ('customer.create', 'Create party profile / customer', 'M-001'),
      ('customer.update', 'Update customer profile', 'M-001')
    ON CONFLICT (code) DO NOTHING
  `.execute(db);

  // 2. Insert into app.role_permission for TENANT-ADMIN and BRANCH-MGR
  const roleIds = [
    'role_01M4SXZCV20465ZCBDMYGM2410', // ROLE-TENANT-ADMIN
    'role_01M4SXZDBV65D8Z8VAQC9GR51P', // ROLE-BRANCH-MGR
    'role_01M4SXZD1SR1H43RNVNP78KJVN', // ROLE-ORG-OWNER
    'role_01M4SXZEG4C7TG2VBMRE3XC9YQ', // ROLE-RM
  ];

  for (const roleId of roleIds) {
    for (const perm of ['customer.create', 'customer.update']) {
      await sql`
        INSERT INTO app.role_permission (tenant_id, role_id, permission_code)
        VALUES (${tenantId}, ${roleId}, ${perm})
        ON CONFLICT DO NOTHING
      `.execute(db);
    }
  }

  console.log('Successfully registered customer.create and customer.update in permission and role_permission!');
  await db.destroy();
}

main().catch(console.error);
