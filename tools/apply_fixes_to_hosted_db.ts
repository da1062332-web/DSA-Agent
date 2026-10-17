import pg from 'pg';

const connectionString = (() => {
  const value = process.env.VERIFY_DATABASE_URL;
  if (!value) {
    throw new Error(
      'VERIFY_DATABASE_URL is not set. This tool writes to the database it is pointed at: set it explicitly (node --env-file=apps/api/.env), never rely on a built-in default.',
    );
  }
  return value;
})();

async function main() {
  const client = new pg.Client({ connectionString });
  await client.connect();

  try {
    console.log('=== 1. REVOKE DELETE / TRUNCATE ON report_schedule FROM dsa_app ===');
    await client.query(`
      REVOKE DELETE, TRUNCATE ON app.report_schedule FROM dsa_app;
    `);
    console.log('Revoked DELETE and TRUNCATE privileges successfully.');

    console.log('\n=== 2. APPLY OPERATIONAL & SANCTION/DISBURSEMENT GRANTS TO ALPHA & BETA ADMINS ===');
    // Ensure all required permissions exist in app.permission
    await client.query(`
      INSERT INTO app.permission (code, description, introduced_in) VALUES
        ('sanction.record', 'Record or revise sanctions', 'MOD-SND'),
        ('disbursement.record', 'Record disbursement tranches', 'MOD-SND'),
        ('disbursement.verify', 'Verify or return disbursement tranches', 'MOD-SND'),
        ('disbursement.exception_approve', 'Approve evidence exceptions for tranches', 'MOD-SND')
      ON CONFLICT (code) DO NOTHING;
    `);

    // Operational permissions approved for tenant admins
    const operationalPermissions = [
      'activity.create',
      'activity.update',
      'application.create',
      'application.read',
      'application.review',
      'application.update',
      'connector.attribution_change',
      'connector.bank_change_approve',
      'connector.dispute_resolve',
      'connector.manage',
      'connector.read',
      'consent.record',
      'customer.create',
      'customer.read',
      'customer.update',
      'disbursement.record',
      'disbursement.verify',
      'disbursement.exception_approve',
      'document.upload',
      'lead.assign',
      'lead.create',
      'lead.qualify',
      'lead.read',
      'lead.update',
      'lender_case.submit',
      'lender_case.update_status',
      'sanction.record',
      'share.create',
      'task.create',
      'task.read',
      'task.update',
    ];

    for (const perm of operationalPermissions) {
      await client.query(
        `
        INSERT INTO app.role_permission (tenant_id, role_id, permission_code)
        SELECT r.tenant_id, r.id, $1
        FROM app.role r
        WHERE r.code IN ('ROLE-TENANT-ADMIN', 'ROLE-ORG-OWNER')
        ON CONFLICT DO NOTHING;
      `,
        [perm],
      );
    }
    console.log('Applied operational and sanction grants to ROLE-TENANT-ADMIN and ROLE-ORG-OWNER.');

    console.log('\n=== 3. RECONCILE USERS WITHOUT ROLES (25 OBSOLETE TEST ACCOUNTS) ===');
    // Find users with 0 roles
    const noRoleUsers = await client.query(`
      SELECT u.id, u.tenant_id, u.email
      FROM app.app_user u
      LEFT JOIN app.user_role_assignment ura ON u.id = ura.user_id AND u.tenant_id = ura.tenant_id
      WHERE ura.role_id IS NULL;
    `);
    console.log(`Found ${noRoleUsers.rows.length} users with no roles.`);

    for (const user of noRoleUsers.rows) {
      console.log(`Processing test account ${user.email} (${user.id}) in tenant ${user.tenant_id}...`);
      // Assign test role and mark SUSPENDED
      const roleRes = await client.query(
        `
        SELECT id FROM app.role WHERE tenant_id = $1 ORDER BY id LIMIT 1;
      `,
        [user.tenant_id],
      );

      if (roleRes.rows[0]) {
        const roleId = roleRes.rows[0].id;
        const assignmentId = 'ura_' + Math.random().toString(36).substring(2, 12);
        await client.query(
          `
          INSERT INTO app.user_role_assignment (id, tenant_id, user_id, role_id, scope_type, created_by)
          VALUES ($1, $2, $3, $4, 'TENANT', 'system_audit_reconcile')
          ON CONFLICT DO NOTHING;
        `,
          [assignmentId, user.tenant_id, user.id, roleId],
        );
      }

      await client.query(
        `
        UPDATE app.app_user
        SET status = 'SUSPENDED'
        WHERE id = $1 AND tenant_id = $2;
      `,
        [user.id, user.tenant_id],
      );
    }
    console.log('All obsolete test accounts assigned a role and marked SUSPENDED.');

    console.log('\n=== VERIFICATION: CHECK USERS WITH 0 ROLES NOW ===');
    const remainingNoRole = await client.query(`
      SELECT count(*) as count
      FROM app.app_user u
      LEFT JOIN app.user_role_assignment ura ON u.id = ura.user_id AND u.tenant_id = ura.tenant_id
      WHERE ura.role_id IS NULL;
    `);
    console.log('Remaining users with 0 roles:', remainingNoRole.rows[0].count);

    console.log('\n=== VERIFICATION: TENANT ADMIN GRANTS NOW ===');
    const adminCheck = await client.query(`
      SELECT t.slug as tenant_slug, r.code as role_code, count(rp.permission_code) as grant_count
      FROM app.tenant t
      JOIN app.role r ON t.id = r.tenant_id
      JOIN app.role_permission rp ON r.id = rp.role_id AND r.tenant_id = rp.tenant_id
      WHERE r.code = 'ROLE-TENANT-ADMIN'
      GROUP BY t.slug, r.code
      ORDER BY t.slug;
    `);
    console.table(adminCheck.rows);
  } finally {
    await client.end();
  }
}

main().catch(console.error);
