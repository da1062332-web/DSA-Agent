// ProductVersionPort (owner: Dev 3). Answers "is this product version usable today?" for the applications module, so that
// module never reads the catalogue tables itself. Runs inside the caller's transaction; row-level security limits the
// lookup to the caller's tenant, so another tenant's version reads as absent.
import type { ProductVersionPort, ProductVersionSummary, Tx } from '@dsa/contracts';
import { sql } from 'kysely';

export function createProductVersionPort(): ProductVersionPort {
  return {
    async getVersion(tx: Tx, id: string, now: Date): Promise<ProductVersionSummary | null> {
      const r = await sql<{
        id: string;
        product_id: string;
        category: string;
        version_status: 'ACTIVE' | 'RETIRED';
        product_status: 'ACTIVE' | 'INACTIVE';
        in_force: boolean;
      }>`
        select v.id, v.product_id, p.category, v.status as version_status, p.status as product_status,
               (v.status = 'ACTIVE' and v.effective_from <= ${now}::timestamptz and not exists (
                  select 1 from loan_product_version n
                   where n.product_id = v.product_id and n.status = 'ACTIVE'
                     and n.effective_from <= ${now}::timestamptz and n.effective_from > v.effective_from)) as in_force
          from loan_product_version v
          join loan_product p on p.id = v.product_id and p.tenant_id = v.tenant_id
         where v.id = ${id}`.execute(tx);
      const row = r.rows[0];
      if (!row) return null;
      return {
        id: row.id,
        productId: row.product_id,
        category: row.category,
        versionStatus: row.version_status,
        productStatus: row.product_status,
        inForce: row.in_force,
      };
    },
  };
}
