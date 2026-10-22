// packages/contracts/src/messaging.spec.ts
import { describe, expect, it } from 'vitest';
import { CreateTemplateSchema, SendMessageSchema, MessageRecipientSchema } from './messaging';

describe('Messaging Contracts', () => {
  it('validates valid CreateTemplateSchema', () => {
    const valid = {
      code: 'lead_welcome_email',
      channel: 'EMAIL',
      category: 'TRANSACTIONAL',
      language: 'en',
      body: 'Hello {{firstName}}, welcome to our DSA platform.',
      variables: [{ name: 'firstName', required: true }],
      status: 'APPROVED',
    };
    const parsed = CreateTemplateSchema.parse(valid);
    expect(parsed.code).toBe('lead_welcome_email');
    expect(parsed.channel).toBe('EMAIL');
  });

  it('rejects invalid template code or channel', () => {
    expect(() =>
      CreateTemplateSchema.parse({
        code: 'INVALID CODE WITH SPACES',
        channel: 'TELEGRAM',
        body: 'Hello',
      }),
    ).toThrow();
  });

  it('rejects approved template with undeclared variable in body', () => {
    expect(() =>
      CreateTemplateSchema.parse({
        code: 'lead_welcome_email',
        channel: 'EMAIL',
        category: 'TRANSACTIONAL',
        language: 'en',
        body: 'Hello {{undeclaredVar}}, welcome!',
        variables: [{ name: 'otherVar', required: true }],
        status: 'APPROVED',
      }),
    ).toThrow(/Template body uses undeclared variable/);
  });

  it('validates MessageRecipientSchema with email or phone', () => {
    const withEmail = MessageRecipientSchema.parse({ email: 'user@example.com' });
    expect(withEmail.email).toBe('user@example.com');

    const withMobile = MessageRecipientSchema.parse({ mobile: '+919876543210' });
    expect(withMobile.mobile).toBe('+919876543210');

    expect(() => MessageRecipientSchema.parse({})).toThrow(
      'Recipient must specify at least an email or mobile',
    );
  });

  it('validates SendMessageSchema', () => {
    const valid = {
      subjectType: 'LEAD',
      subjectId: 'lead_01J00000000000000000000000',
      channel: 'SMS',
      templateCode: 'lead_first_touch',
      recipient: { mobile: '+919876543210' },
      variables: { agentName: 'Rajesh' },
    };
    const parsed = SendMessageSchema.parse(valid);
    expect(parsed.subjectType).toBe('LEAD');
    expect(parsed.recipient.mobile).toBe('+919876543210');
  });
});
