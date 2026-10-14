// Fake for ComplaintSubjectPort (tests only). Holds the subjects a test declares as existing.
import type { Tx } from '../kernel';
import type { ComplaintSubjectPort, ComplaintSubjectType } from '../ports/complaint-subject-port';

export class FakeComplaintSubjectPort implements ComplaintSubjectPort {
  private readonly known = new Set<string>();

  add(type: ComplaintSubjectType, id: string): this {
    this.known.add(`${type}:${id}`);
    return this;
  }

  async exists(_tx: Tx, type: ComplaintSubjectType, id: string): Promise<boolean> {
    return this.known.has(`${type}:${id}`);
  }
}
