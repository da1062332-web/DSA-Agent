// apps/api/test/audit-canonical.spec.ts
// Unit tests for canonical serialization and SHA-256 hash chaining (SUB-AUD.02)
import { describe, expect, it } from 'vitest';
import {
  canonicalStringify,
  serializeCanonicalEvent,
  computeEventHash,
  GENESIS_PREV_HASH,
  type CanonicalAuditEventData,
} from '../src/modules/audit/canonical';

describe('Module 37: Audit Canonical Serialization & Hash Chain (SUB-AUD.02)', () => {
  it('TEST-AUD-CAN-01 canonicalStringify produces identical strings regardless of key insertion order', () => {
    const objA = {
      z: 100,
      a: 'first',
      m: { y: 'nestedY', x: 'nestedX' },
      arr: [1, 2, { b: 'two', a: 'one' }],
    };

    const objB = {
      arr: [1, 2, { a: 'one', b: 'two' }],
      m: { x: 'nestedX', y: 'nestedY' },
      a: 'first',
      z: 100,
    };

    expect(canonicalStringify(objA)).toBe(canonicalStringify(objB));
    expect(canonicalStringify(objA)).toBe(
      '{"a":"first","arr":[1,2,{"a":"one","b":"two"}],"m":{"x":"nestedX","y":"nestedY"},"z":100}',
    );
  });

  it('TEST-AUD-CAN-02 serializeCanonicalEvent deterministically sorts and serializes audit fields', () => {
    const event: CanonicalAuditEventData = {
      id: 'aud_01JTESTAUDIT00000000000001',
      tenantId: 'ten_01JTESTTENANT00000000000000',
      seq: 1,
      occurredAt: '2026-10-14T10:00:00.000Z',
      actorType: 'USER',
      actorId: 'usr_01JTESTUSER0000000000000000',
      action: 'lead.created',
      entityType: 'lead',
      entityId: 'lead_01JTESTLEAD00000000000001',
      permissionUsed: 'lead.create',
      approvalRef: null,
      reason: 'Direct marketing intake',
      decisionRecordId: 'dr_01JTESTDECISION000000000001',
      before: null,
      after: { leadStatus: 'NEW', amount: '500000' },
      externalSideEffect: false,
      correlationId: 'req_01JTESTCORRELATION00000001',
    };

    const canonical1 = serializeCanonicalEvent(event);
    const canonical2 = serializeCanonicalEvent({ ...event });

    expect(canonical1).toBe(canonical2);
    expect(canonical1).toContain('"action":"lead.created"');
    expect(canonical1).toContain('"seq":1');
  });

  it('TEST-AUD-CAN-03 computeEventHash links genesis and subsequent events cryptographically', () => {
    const event1: CanonicalAuditEventData = {
      id: 'aud_01JTESTAUDIT00000000000001',
      tenantId: 'ten_test',
      seq: 1,
      occurredAt: '2026-10-14T10:00:00.000Z',
      actorType: 'USER',
      actorId: 'usr_01',
      action: 'lead.created',
      entityType: 'lead',
      entityId: 'lead_01',
      permissionUsed: 'lead.create',
      approvalRef: null,
      reason: null,
      decisionRecordId: null,
      before: null,
      after: { status: 'NEW' },
      externalSideEffect: false,
      correlationId: 'cor_01',
    };

    const hash1 = computeEventHash(GENESIS_PREV_HASH, event1);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);

    const event2: CanonicalAuditEventData = {
      id: 'aud_01JTESTAUDIT00000000000002',
      tenantId: 'ten_test',
      seq: 2,
      occurredAt: '2026-10-14T10:05:00.000Z',
      actorType: 'USER',
      actorId: 'usr_02',
      action: 'lead.qualified',
      entityType: 'lead',
      entityId: 'lead_01',
      permissionUsed: 'lead.qualify',
      approvalRef: null,
      reason: 'Meets minimum criteria',
      decisionRecordId: null,
      before: { status: 'NEW' },
      after: { status: 'QUALIFIED' },
      externalSideEffect: false,
      correlationId: 'cor_02',
    };

    const hash2 = computeEventHash(hash1, event2);
    expect(hash2).toMatch(/^[0-9a-f]{64}$/);
    expect(hash2).not.toBe(hash1);
  });

  it('TEST-AUD-CAN-04 altering any audit event payload field invalidates the hash', () => {
    const originalEvent: CanonicalAuditEventData = {
      id: 'aud_01JTESTAUDIT00000000000001',
      tenantId: 'ten_test',
      seq: 1,
      occurredAt: '2026-10-14T10:00:00.000Z',
      actorType: 'USER',
      actorId: 'usr_01',
      action: 'application.state_changed',
      entityType: 'application',
      entityId: 'app_01',
      permissionUsed: 'application.review',
      approvalRef: 'appr_123',
      reason: 'Approved by committee',
      decisionRecordId: null,
      before: { status: 'UNDER_REVIEW', amount: '1000000.00' },
      after: { status: 'SANCTIONED', amount: '1000000.00' },
      externalSideEffect: false,
      correlationId: 'cor_01',
    };

    const validHash = computeEventHash(GENESIS_PREV_HASH, originalEvent);

    // Tamper with before amount
    const tamperedEvent: CanonicalAuditEventData = {
      ...originalEvent,
      after: { status: 'SANCTIONED', amount: '2000000.00' },
    };

    const tamperedHash = computeEventHash(GENESIS_PREV_HASH, tamperedEvent);
    expect(tamperedHash).not.toBe(validHash);
  });
});
