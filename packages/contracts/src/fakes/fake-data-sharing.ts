// Fake DataSharingPort (Contracts §4.5): records every call for assertions.
import type { RequestContext, Tx } from '../kernel';
import type { DataSharingPort, DataSharingRecordInput } from '../ports/crm-ports';

export class FakeDataSharingPort implements DataSharingPort {
  readonly records: (DataSharingRecordInput & { dataSharingRecordId: string })[] = [];

  async record(
    _tx: Tx,
    _ctx: RequestContext,
    r: DataSharingRecordInput,
  ): Promise<{ dataSharingRecordId: string }> {
    const dataSharingRecordId = `dsr_FAKE_${this.records.length + 1}`;
    this.records.push({ ...r, dataSharingRecordId });
    return { dataSharingRecordId };
  }
}
