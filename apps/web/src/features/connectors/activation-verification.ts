// The verifications that can activate one connector, for the activation dialog's list. The server checks the same rule when the activation
// is sent: a VERIFIED record whose subject is this connector (migration 0101). This list only helps the user choose; it cannot make an
// activation succeed.
export interface VerificationRow {
  id: string;
  result: string;
  subjectType: string;
  subjectId: string;
  checkType: string;
}

export interface PassedVerification {
  id: string;
  label: string;
}

export function passedVerificationsFor(connectorId: string, rows: VerificationRow[]): PassedVerification[] {
  return rows
    .filter((r) => r.result === 'VERIFIED' && r.subjectType === 'CONNECTOR' && r.subjectId === connectorId)
    .map((r) => ({ id: r.id, label: `${r.id} (${r.checkType})` }));
}
