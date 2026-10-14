// apps/api/src/modules/compliance/data-sharing-port.ts
// Real PostgreSQL implementation of DataSharingPort (ENT-100 data_sharing_record)
import type { DataSharingPort, DataSharingRecordInput, RequestContext, Tx } from '@dsa/contracts';
import { sql } from 'kysely';
import { monotonicFactory } from 'ulid';

const nextUlid = monotonicFactory();

export class PostgresDataSharingPort implements DataSharingPort {
  async record(
    tx: Tx,
    ctx: RequestContext,
    r: DataSharingRecordInput,
  ): Promise<{ dataSharingRecordId: string }> {
    const dsrId = `dsr_${nextUlid()}`;
    await sql`
      INSERT INTO app.data_sharing_record (
        id, tenant_id, subject_type, subject_id, recipient_type, recipient_id,
        purpose, consent_ids, items, channel, source_ref, actor_id, shared_at
      ) VALUES (
        ${dsrId}, ${ctx.principal.tenantId}, ${r.subjectType}, ${r.subjectId},
        ${r.recipientType}, ${r.recipientId}, ${r.purpose},
        ${r.consentIds}::text[], ${JSON.stringify(r.items)}::jsonb,
        ${r.channel}, ${r.sourceRef}, ${ctx.principal.id}, ${ctx.now}
      )
    `.execute(tx);

    return { dataSharingRecordId: dsrId };
  }
}
