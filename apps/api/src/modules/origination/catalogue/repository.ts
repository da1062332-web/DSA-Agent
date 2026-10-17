// apps/api/src/modules/origination/catalogue/repository.ts — owner: Developer 5 (Bhushan)
import type { Tx } from '@dsa/contracts';
import { sql } from 'kysely';

export interface LenderRow {
  id: string;
  tenant_id: string;
  name: string;
  lender_type: string;
  regulator_ref: string | null;
  status: string;
  status_reason: string | null;
  lock_version: number;
  created_at: Date;
  created_by: string;
  updated_at: Date;
  updated_by: string;
}

export interface EmpanelmentRow {
  id: string;
  tenant_id: string;
  organisation_id: string;
  lender_id: string;
  dsa_code: string;
  valid_range: string;
  permitted_categories: string[];
  permitted_geos?: any;
  agreement_document_id?: string | null;
  status: string;
  lock_version: number;
  created_at: Date;
  created_by: string;
  updated_at: Date;
  updated_by: string;
}

export interface LenderContactRow {
  id: string;
  tenant_id: string;
  lender_id: string;
  name: string;
  role: string;
  email: string | null;
  phone: string | null;
  channel: string;
  escalation_level: number;
  lock_version: number;
  created_at: Date;
  created_by: string;
  updated_at: Date;
  updated_by: string;
}

export interface LoanProductRow {
  id: string;
  tenant_id: string;
  lender_id: string;
  name: string;
  category: string;
  applicant_types: string[];
  secured: boolean;
  owner_user_id: string | null;
  next_review_at: Date | null;
  status: string;
  lock_version: number;
  created_at: Date;
  created_by: string;
  updated_at: Date;
  updated_by: string;
}

export interface LoanProductVersionRow {
  id: string;
  tenant_id: string;
  product_id: string;
  version_no: number;
  effective_from: Date;
  amount_min: string;
  amount_max: string;
  currency: string;
  tenure_min_months: number;
  tenure_max_months: number;
  illustrative_rate_text: string | null;
  fee_text?: string | null;
  geo_rules?: any;
  document_profile_id?: string | null;
  workflow_profile?: any;
  status: string;
  created_at: Date;
  created_by: string;
}

export interface CatalogueRepository {
  // Lenders
  insertLender(tx: Tx, row: LenderRow): Promise<void>;
  findLenderById(tx: Tx, tenantId: string, id: string): Promise<LenderRow | null>;
  findLenderByName(tx: Tx, tenantId: string, name: string): Promise<LenderRow | null>;
  listLenders(
    tx: Tx,
    tenantId: string,
    filters: { status?: string; lenderType?: string; cursor?: string; limit: number },
  ): Promise<{ rows: LenderRow[]; nextCursor: string | null }>;
  updateLender(
    tx: Tx,
    tenantId: string,
    id: string,
    expectedLockVersion: number,
    updates: Partial<LenderRow>,
  ): Promise<LenderRow | null>;

  // Empanelments
  insertEmpanelment(tx: Tx, row: EmpanelmentRow): Promise<void>;
  findEmpanelmentById(tx: Tx, tenantId: string, id: string): Promise<EmpanelmentRow | null>;
  listEmpanelments(tx: Tx, tenantId: string, lenderId: string): Promise<EmpanelmentRow[]>;
  updateEmpanelment(
    tx: Tx,
    tenantId: string,
    id: string,
    expectedLockVersion: number,
    updates: Partial<EmpanelmentRow>,
  ): Promise<EmpanelmentRow | null>;
  findActiveEmpanelmentForLender(
    tx: Tx,
    tenantId: string,
    lenderId: string,
    category: string,
  ): Promise<EmpanelmentRow | null>;

  // Contacts
  replaceLenderContacts(
    tx: Tx,
    tenantId: string,
    lenderId: string,
    contacts: LenderContactRow[],
  ): Promise<void>;
  listLenderContacts(tx: Tx, tenantId: string, lenderId: string): Promise<LenderContactRow[]>;

  // Loan Products
  insertProduct(tx: Tx, row: LoanProductRow): Promise<void>;
  findProductById(tx: Tx, tenantId: string, id: string): Promise<LoanProductRow | null>;
  listProducts(
    tx: Tx,
    tenantId: string,
    filters: { lenderId?: string; category?: string; status?: string; cursor?: string; limit: number },
  ): Promise<{ rows: LoanProductRow[]; nextCursor: string | null }>;
  updateProductStatus(tx: Tx, tenantId: string, id: string, status: string): Promise<LoanProductRow | null>;

  // Versions
  insertProductVersion(tx: Tx, row: LoanProductVersionRow): Promise<void>;
  findProductVersionById(tx: Tx, tenantId: string, id: string): Promise<LoanProductVersionRow | null>;
  findActiveProductVersion(
    tx: Tx,
    tenantId: string,
    productId: string,
  ): Promise<LoanProductVersionRow | null>;
  listProductVersions(tx: Tx, tenantId: string, productId: string): Promise<LoanProductVersionRow[]>;
}

export class SqlCatalogueRepository implements CatalogueRepository {
  async insertLender(tx: Tx, row: LenderRow): Promise<void> {
    await sql`
      INSERT INTO lender (
        id, tenant_id, name, lender_type, regulator_ref, status, status_reason,
        lock_version, created_at, created_by, updated_at, updated_by
      ) VALUES (
        ${row.id}, ${row.tenant_id}, ${row.name}, ${row.lender_type}, ${row.regulator_ref},
        ${row.status}, ${row.status_reason}, ${row.lock_version}, ${row.created_at},
        ${row.created_by}, ${row.updated_at}, ${row.updated_by}
      )
    `.execute(tx);
  }

  async findLenderById(tx: Tx, tenantId: string, id: string): Promise<LenderRow | null> {
    const res = await sql<LenderRow>`
      SELECT * FROM lender WHERE tenant_id = ${tenantId} AND id = ${id}
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async findLenderByName(tx: Tx, tenantId: string, name: string): Promise<LenderRow | null> {
    const res = await sql<LenderRow>`
      SELECT * FROM lender WHERE tenant_id = ${tenantId} AND name = ${name}
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async listLenders(
    tx: Tx,
    tenantId: string,
    filters: { status?: string; lenderType?: string; cursor?: string; limit: number },
  ): Promise<{ rows: LenderRow[]; nextCursor: string | null }> {
    const limitPlusOne = filters.limit + 1;
    let query = sql<LenderRow>`
      SELECT * FROM lender
      WHERE tenant_id = ${tenantId}
    `;
    if (filters.status) {
      query = sql<LenderRow>`${query} AND status = ${filters.status}`;
    }
    if (filters.lenderType) {
      query = sql<LenderRow>`${query} AND lender_type = ${filters.lenderType}`;
    }
    if (filters.cursor) {
      query = sql<LenderRow>`${query} AND id > ${filters.cursor}`;
    }
    query = sql<LenderRow>`${query} ORDER BY id ASC LIMIT ${limitPlusOne}`;

    const res = await query.execute(tx);
    const hasMore = res.rows.length > filters.limit;
    const rows = hasMore ? res.rows.slice(0, filters.limit) : res.rows;
    const nextCursor = hasMore ? (rows[rows.length - 1]?.id ?? null) : null;
    return { rows, nextCursor };
  }

  async updateLender(
    tx: Tx,
    tenantId: string,
    id: string,
    expectedLockVersion: number,
    updates: Partial<LenderRow>,
  ): Promise<LenderRow | null> {
    const res = await sql<LenderRow>`
      UPDATE lender
      SET
        name = COALESCE(${updates.name ?? null}, name),
        lender_type = COALESCE(${updates.lender_type ?? null}, lender_type),
        regulator_ref = COALESCE(${updates.regulator_ref ?? null}, regulator_ref),
        status = COALESCE(${updates.status ?? null}, status),
        status_reason = COALESCE(${updates.status_reason ?? null}, status_reason),
        lock_version = lock_version + 1,
        updated_at = now(),
        updated_by = COALESCE(${updates.updated_by ?? 'system'}, updated_by)
      WHERE tenant_id = ${tenantId} AND id = ${id} AND lock_version = ${expectedLockVersion}
      RETURNING *
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async insertEmpanelment(tx: Tx, row: EmpanelmentRow): Promise<void> {
    await sql`
      INSERT INTO empanelment (
        id, tenant_id, organisation_id, lender_id, dsa_code, valid_range,
        permitted_categories, permitted_geos, agreement_document_id, status, lock_version, created_at, created_by, updated_at, updated_by
      ) VALUES (
        ${row.id}, ${row.tenant_id}, ${row.organisation_id}, ${row.lender_id},
        ${row.dsa_code}, ${row.valid_range}::daterange, ${row.permitted_categories},
        ${row.permitted_geos ? JSON.stringify(row.permitted_geos) : null}::jsonb,
        ${row.agreement_document_id ?? null},
        ${row.status}, ${row.lock_version}, ${row.created_at}, ${row.created_by},
        ${row.updated_at}, ${row.updated_by}
      )
    `.execute(tx);
  }

  async findEmpanelmentById(tx: Tx, tenantId: string, id: string): Promise<EmpanelmentRow | null> {
    const res = await sql<EmpanelmentRow>`
      SELECT * FROM empanelment WHERE tenant_id = ${tenantId} AND id = ${id}
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async listEmpanelments(tx: Tx, tenantId: string, lenderId: string): Promise<EmpanelmentRow[]> {
    const res = await sql<EmpanelmentRow>`
      SELECT * FROM empanelment WHERE tenant_id = ${tenantId} AND lender_id = ${lenderId} ORDER BY created_at DESC
    `.execute(tx);
    return res.rows;
  }

  async updateEmpanelment(
    tx: Tx,
    tenantId: string,
    id: string,
    expectedLockVersion: number,
    updates: Partial<EmpanelmentRow>,
  ): Promise<EmpanelmentRow | null> {
    const res = await sql<EmpanelmentRow>`
      UPDATE empanelment
      SET
        permitted_categories = COALESCE(${updates.permitted_categories ?? null}, permitted_categories),
        permitted_geos = COALESCE(${updates.permitted_geos ? JSON.stringify(updates.permitted_geos) : null}::jsonb, permitted_geos),
        agreement_document_id = COALESCE(${updates.agreement_document_id ?? null}, agreement_document_id),
        status = COALESCE(${updates.status ?? null}, status),
        lock_version = lock_version + 1,
        updated_at = now(),
        updated_by = COALESCE(${updates.updated_by ?? 'system'}, updated_by)
      WHERE tenant_id = ${tenantId} AND id = ${id} AND lock_version = ${expectedLockVersion}
      RETURNING *
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async findActiveEmpanelmentForLender(
    tx: Tx,
    tenantId: string,
    lenderId: string,
    category: string,
  ): Promise<EmpanelmentRow | null> {
    const res = await sql<EmpanelmentRow>`
      SELECT * FROM empanelment
      WHERE tenant_id = ${tenantId}
        AND lender_id = ${lenderId}
        AND status = 'ACTIVE'
        AND ${category} = ANY(permitted_categories)
        AND valid_range @> CURRENT_DATE
      LIMIT 1
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async replaceLenderContacts(
    tx: Tx,
    tenantId: string,
    lenderId: string,
    contacts: LenderContactRow[],
  ): Promise<void> {
    await sql`
      DELETE FROM lender_contact WHERE tenant_id = ${tenantId} AND lender_id = ${lenderId}
    `.execute(tx);

    for (const c of contacts) {
      await sql`
        INSERT INTO lender_contact (
          id, tenant_id, lender_id, name, role, email, phone, channel,
          escalation_level, lock_version, created_at, created_by, updated_at, updated_by
        ) VALUES (
          ${c.id}, ${c.tenant_id}, ${c.lender_id}, ${c.name}, ${c.role},
          ${c.email}, ${c.phone}, ${c.channel}, ${c.escalation_level},
          ${c.lock_version}, ${c.created_at}, ${c.created_by}, ${c.updated_at}, ${c.updated_by}
        )
      `.execute(tx);
    }
  }

  async listLenderContacts(tx: Tx, tenantId: string, lenderId: string): Promise<LenderContactRow[]> {
    const res = await sql<LenderContactRow>`
      SELECT * FROM lender_contact WHERE tenant_id = ${tenantId} AND lender_id = ${lenderId} ORDER BY escalation_level ASC
    `.execute(tx);
    return res.rows;
  }

  async insertProduct(tx: Tx, row: LoanProductRow): Promise<void> {
    await sql`
      INSERT INTO loan_product (
        id, tenant_id, lender_id, name, category, applicant_types, secured,
        owner_user_id, next_review_at, status, lock_version, created_at, created_by, updated_at, updated_by
      ) VALUES (
        ${row.id}, ${row.tenant_id}, ${row.lender_id}, ${row.name}, ${row.category},
        ${row.applicant_types}, ${row.secured}, ${row.owner_user_id},
        ${row.next_review_at}, ${row.status}, ${row.lock_version}, ${row.created_at},
        ${row.created_by}, ${row.updated_at}, ${row.updated_by}
      )
    `.execute(tx);
  }

  async findProductById(tx: Tx, tenantId: string, id: string): Promise<LoanProductRow | null> {
    const res = await sql<LoanProductRow>`
      SELECT * FROM loan_product WHERE tenant_id = ${tenantId} AND id = ${id}
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async listProducts(
    tx: Tx,
    tenantId: string,
    filters: { lenderId?: string; category?: string; status?: string; cursor?: string; limit: number },
  ): Promise<{ rows: LoanProductRow[]; nextCursor: string | null }> {
    const limitPlusOne = filters.limit + 1;
    let query = sql<LoanProductRow>`
      SELECT * FROM loan_product
      WHERE tenant_id = ${tenantId}
    `;
    if (filters.lenderId) {
      query = sql<LoanProductRow>`${query} AND lender_id = ${filters.lenderId}`;
    }
    if (filters.category) {
      query = sql<LoanProductRow>`${query} AND category = ${filters.category}`;
    }
    if (filters.status) {
      query = sql<LoanProductRow>`${query} AND status = ${filters.status}`;
    }
    if (filters.cursor) {
      query = sql<LoanProductRow>`${query} AND id > ${filters.cursor}`;
    }
    query = sql<LoanProductRow>`${query} ORDER BY id ASC LIMIT ${limitPlusOne}`;

    const res = await query.execute(tx);
    const hasMore = res.rows.length > filters.limit;
    const rows = hasMore ? res.rows.slice(0, filters.limit) : res.rows;
    const nextCursor = hasMore ? (rows[rows.length - 1]?.id ?? null) : null;
    return { rows, nextCursor };
  }

  async updateProductStatus(
    tx: Tx,
    tenantId: string,
    id: string,
    status: string,
  ): Promise<LoanProductRow | null> {
    const res = await sql<LoanProductRow>`
      UPDATE loan_product
      SET status = ${status}, updated_at = now()
      WHERE tenant_id = ${tenantId} AND id = ${id}
      RETURNING *
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async insertProductVersion(tx: Tx, row: LoanProductVersionRow): Promise<void> {
    await sql`
      INSERT INTO loan_product_version (
        id, tenant_id, product_id, version_no, effective_from, amount_min,
        amount_max, currency, tenure_min_months, tenure_max_months, illustrative_rate_text,
        fee_text, geo_rules, document_profile_id, workflow_profile,
        status, created_at, created_by
      ) VALUES (
        ${row.id}, ${row.tenant_id}, ${row.product_id}, ${row.version_no},
        ${row.effective_from}, ${row.amount_min}, ${row.amount_max},
        ${row.currency}, ${row.tenure_min_months}, ${row.tenure_max_months},
        ${row.illustrative_rate_text},
        ${row.fee_text ?? null},
        ${row.geo_rules ? JSON.stringify(row.geo_rules) : null}::jsonb,
        ${row.document_profile_id ?? null},
        ${row.workflow_profile ? JSON.stringify(row.workflow_profile) : null}::jsonb,
        ${row.status}, ${row.created_at}, ${row.created_by}
      )
    `.execute(tx);
  }

  async findProductVersionById(tx: Tx, tenantId: string, id: string): Promise<LoanProductVersionRow | null> {
    const res = await sql<LoanProductVersionRow>`
      SELECT * FROM loan_product_version WHERE tenant_id = ${tenantId} AND id = ${id}
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async findActiveProductVersion(
    tx: Tx,
    tenantId: string,
    productId: string,
  ): Promise<LoanProductVersionRow | null> {
    const res = await sql<LoanProductVersionRow>`
      SELECT * FROM loan_product_version
      WHERE tenant_id = ${tenantId} AND product_id = ${productId} AND status = 'ACTIVE'
      ORDER BY version_no DESC LIMIT 1
    `.execute(tx);
    return res.rows[0] ?? null;
  }

  async listProductVersions(tx: Tx, tenantId: string, productId: string): Promise<LoanProductVersionRow[]> {
    const res = await sql<LoanProductVersionRow>`
      SELECT * FROM loan_product_version
      WHERE tenant_id = ${tenantId} AND product_id = ${productId}
      ORDER BY version_no DESC
    `.execute(tx);
    return res.rows;
  }
}
