-- Migration 0118 (owner: Bhushan, task P1-02 follow-up): give the roles that build a borrower's file the customer permissions P1-02 needs.
-- Why: on hosted no customer-tenant role held customer.update (only Tenant administrator ever had it, and P0-07 removed it there), so
-- the Profile, Identity and Addresses tabs of P1-02 were read-only for everyone. Loan operations held customer.reveal_sensitive but not
-- customer.read, so it could not open a customer, and the DSA owner lacked customer.reveal_sensitive on hosted.
--
-- Grants (customer tenants only; the platform realm is untouched):
--   ROLE-RM          customer.update                         the RM builds the customer's file (profile, identity, addresses)
--   ROLE-LOAN-OPS    customer.read, customer.update          loan operations completes PAN and date of birth for the lender login
--   ROLE-ORG-OWNER   customer.reveal_sensitive               the owner may reveal a masked PAN or date of birth (reason + step-up)
-- Revealing still needs a reason and a fresh step-up code, and is refused while the project has no second factor.
-- Inserts role grants only; changes and deletes nothing. Idempotent (ON CONFLICT DO NOTHING): safe to run again.

SET search_path = app, extensions, public;

INSERT INTO role_permission (tenant_id, role_id, permission_code)
SELECT r.tenant_id, r.id, g.permission_code
  FROM role r
  JOIN tenant t ON t.id = r.tenant_id AND t.tenant_type <> 'PLATFORM'
  JOIN (VALUES
          ('ROLE-RM', 'customer.update'),
          ('ROLE-LOAN-OPS', 'customer.read'),
          ('ROLE-LOAN-OPS', 'customer.update'),
          ('ROLE-ORG-OWNER', 'customer.reveal_sensitive')
       ) AS g(role_code, permission_code) ON g.role_code = r.code
ON CONFLICT DO NOTHING;
