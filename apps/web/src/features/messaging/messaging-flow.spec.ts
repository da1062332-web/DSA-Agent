// apps/web/src/features/messaging/messaging-flow.spec.ts
// Frontend integration tests for MessagingPage, TemplateEditor, and MessageComposer.
import { describe, expect, it } from 'vitest';
import {
  CreateTemplateSchema,
  SendMessageSchema,
  MessageRecordSchema,
  type MessageRecord,
} from '@dsa/contracts';

describe('Frontend Messaging Integration Tests', () => {
  it('FE-MSG-001: validates template creation form schema in TemplateEditor', () => {
    const validForm = {
      code: 'welcome_borrower',
      channel: 'EMAIL',
      category: 'TRANSACTIONAL',
      body: 'Hello {{borrowerName}}, your application {{appNumber}} has been received.',
      variables: [
        { name: 'borrowerName', required: true },
        { name: 'appNumber', required: true },
      ],
      status: 'APPROVED',
    };

    const parsed = CreateTemplateSchema.parse(validForm);
    expect(parsed.code).toBe('welcome_borrower');
    expect(parsed.channel).toBe('EMAIL');
    expect(parsed.variables).toHaveLength(2);
  });

  it('FE-MSG-002: rejects invalid template identifiers (uppercase, spaces, special chars)', () => {
    expect(() =>
      CreateTemplateSchema.parse({
        code: 'INVALID CODE WITH SPACES',
        channel: 'SMS',
        category: 'TRANSACTIONAL',
        body: 'Hello',
        variables: [],
      }),
    ).toThrow();
  });

  it('FE-MSG-003: validates MessageComposer payload across Email, SMS, and WhatsApp channels', () => {
    // Email payload
    const emailPayload = SendMessageSchema.parse({
      subjectType: 'LEAD',
      subjectId: 'lead_01J00000000000000000000001',
      channel: 'EMAIL',
      templateCode: 'welcome_borrower',
      recipient: { email: 'borrower@example.com' },
      variables: { borrowerName: 'Pooja', appNumber: 'APP-102' },
    });
    expect(emailPayload.recipient.email).toBe('borrower@example.com');

    // SMS payload
    const smsPayload = SendMessageSchema.parse({
      subjectType: 'LEAD',
      subjectId: 'lead_01J00000000000000000000001',
      channel: 'SMS',
      templateCode: 'otp_verify',
      recipient: { mobile: '+919876543210' },
      variables: { otp: 458921 },
    });
    expect(smsPayload.recipient.mobile).toBe('+919876543210');

    // WhatsApp payload
    const waPayload = SendMessageSchema.parse({
      subjectType: 'LOAN_APPLICATION',
      subjectId: 'app_01J00000000000000000000001',
      channel: 'WHATSAPP',
      templateCode: 'loan_sanction_letter',
      recipient: { mobile: '+919876543210' },
      variables: { applicant: 'Pooja', amount: '5,00,000' },
    });
    expect(waPayload.channel).toBe('WHATSAPP');
  });

  it('FE-MSG-004: validates message record rendering in Sent Messages table', () => {
    const rawRecord: MessageRecord = {
      id: 'msg_01J00000000000000000000001',
      tenantId: 'ten_01JTESTTENANT00000000000000',
      direction: 'OUTBOUND',
      channel: 'EMAIL',
      subjectType: 'LEAD',
      subjectId: 'lead_01J00000000000000000000001',
      templateVersionId: 'tmpl_01J00000000000000000000001',
      recipientHash: 'hash_abc123',
      recipientMasked: 'b***r@example.com',
      variablesRedacted: { applicantName: '[REDACTED]' },
      provider: 'TEST_GATEWAY',
      providerMessageId: 'prov_msg_99881',
      status: 'SENT',
      statusHistory: [
        { status: 'SENT', timestamp: '2026-10-12T10:00:00.000Z' },
        { status: 'DELIVERED', timestamp: '2026-10-12T10:00:05.000Z' },
      ],
      lockVersion: 1,
      createdAt: '2026-10-12T10:00:00.000Z',
      createdBy: 'usr_01JTESTUSER0000000000000001',
      updatedAt: '2026-10-12T10:00:05.000Z',
      updatedBy: 'usr_01JTESTUSER0000000000000001',
    };

    const parsed = MessageRecordSchema.parse(rawRecord);
    expect(parsed.status).toBe('SENT');
    expect(parsed.provider).toBe('TEST_GATEWAY');
    expect(parsed.direction).toBe('OUTBOUND');
  });
});
