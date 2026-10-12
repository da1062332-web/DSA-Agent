// Tenant provisioning CLI — owner: Dev 1 — TODO(TASK-103).
// Creates the two demo tenants with identical natural keys (Contracts §13 isolation scenario): tenant,
// organisation, branches, roles, users and queues. For each user it creates the Supabase Auth user through the
// Admin API with app_metadata.tenant_id (SUPABASE_SERVICE_ROLE_KEY, tools only) and the matching app_user row,
// with compensation on failure (Migration Plan §0). Runs as a SERVICE principal (SYSTEM:platform) and calls
// RulesSeederPort (PORT_RULES_SEEDER=noop until Dev 2 switches it to real at INT-005).
console.error('provision-tenant: not implemented yet (TASK-103, Dev 1).');
process.exit(1);
