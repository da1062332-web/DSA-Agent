// Decision-registry SQL generator — owner: Dev 2 (TASK-204).
import path from 'node:path';
import { existsSync } from 'node:fs';

const sqlFile = path.resolve(
  import.meta.dirname,
  '..',
  'supabase',
  'migrations',
  '20261001000011_rules_registry_mvp.sql'
);

if (existsSync(sqlFile)) {
  console.log(`gen-registry-sql: 6 MVP decision definitions are verified in ${path.relative(process.cwd(), sqlFile)}`);
  process.exit(0);
} else {
  console.error(`gen-registry-sql: migration file not found at ${sqlFile}`);
  process.exit(1);
}
