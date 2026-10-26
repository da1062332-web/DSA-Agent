// Validation for the Create Workflow Automation Rule form. These limits mirror CreateAutomationDefinitionSchema.
import { describe, expect, it } from 'vitest';
import { createFailureMessage, isRuleValid, tidyRuleCode, validateNewRule, validateRuleDetails } from './create-rule';

const ok = { code: 'auto_lead_welcome', name: 'Lead welcome', description: '' };

describe('Create automation rule: field checks', () => {
  it('accepts a valid rule', () => {
    expect(isRuleValid(validateNewRule(ok))).toBe(true);
  });

  it('asks for a code and a name when they are empty', () => {
    const errors = validateNewRule({ code: '  ', name: '', description: '' });
    expect(errors.code).toBe('Enter a rule code.');
    expect(errors.name).toBe('Enter a rule name.');
  });

  it('rejects a code that is too short or too long', () => {
    expect(validateNewRule({ ...ok, code: 'ab' }).code).toContain('3 to 64');
    expect(validateNewRule({ ...ok, code: 'a'.repeat(65) }).code).toContain('3 to 64');
  });

  it('rejects spaces, capitals and other symbols in a code', () => {
    expect(validateNewRule({ ...ok, code: 'Lead Welcome' }).code).toContain('lowercase');
    expect(validateNewRule({ ...ok, code: 'lead.welcome' }).code).toContain('lowercase');
  });

  it('allows hyphens and numbers in a code', () => {
    expect(isRuleValid(validateNewRule({ ...ok, code: 'lead-welcome-2' }))).toBe(true);
  });

  it('rejects a name that is too short, and a description that is too long', () => {
    expect(validateNewRule({ ...ok, name: 'Hi' }).name).toContain('3 to 200');
    expect(validateNewRule({ ...ok, description: 'x'.repeat(1001) }).description).toContain('1000');
  });

  it('makes a typed code follow the rule: lowercase, spaces become underscores', () => {
    expect(tidyRuleCode('Lead Welcome SMS')).toBe('lead_welcome_sms');
    expect(tidyRuleCode('auto-lead')).toBe('auto-lead');
  });

  it('turns a duplicate-code answer into a message the person can act on', () => {
    expect(createFailureMessage(new Error('Automation with this code already exists'))).toContain('different code');
    expect(createFailureMessage(new Error('no permission for this'))).toContain('permission');
    expect(createFailureMessage(new Error(''))).toContain('could not be created');
  });
});

describe('Edit automation rule details', () => {
  it('accepts a valid name and an empty description', () => {
    expect(validateRuleDetails({ name: 'Lead welcome', description: '' })).toEqual({});
  });

  it('asks for a name and checks its length', () => {
    expect(validateRuleDetails({ name: '', description: '' }).name).toBe('Enter a rule name.');
    expect(validateRuleDetails({ name: 'Hi', description: '' }).name).toContain('3 to 200');
  });

  it('checks the description length', () => {
    expect(validateRuleDetails({ name: 'Lead welcome', description: 'x'.repeat(1001) }).description).toContain('1000');
  });
});
