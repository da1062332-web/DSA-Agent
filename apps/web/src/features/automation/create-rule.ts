// Checks for the "Create Workflow Automation Rule" form (owner: Akash, MOD-WFA). The same limits as
// CreateAutomationDefinitionSchema in packages/contracts/src/automation.ts, worded so the person filling in the form can
// fix the problem without reading the API. The API still checks everything again.

export const RULE_CODE_MIN = 3;
export const RULE_CODE_MAX = 64;
export const RULE_NAME_MIN = 3;
export const RULE_NAME_MAX = 200;
export const RULE_DESCRIPTION_MAX = 1000;

export interface NewRuleFields {
  code: string;
  name: string;
  description: string;
}

export interface NewRuleErrors {
  code?: string;
  name?: string;
  description?: string;
}

/**
 * Makes a typed code follow the rule as the person types: lowercase, spaces and dashes become underscores.
 * "Lead Welcome SMS" becomes "lead_welcome_sms". Hyphens are kept because the server allows them.
 */
export function tidyRuleCode(raw: string): string {
  return raw.toLowerCase().replace(/[\s]+/g, '_');
}

export function validateNewRule(fields: NewRuleFields): NewRuleErrors {
  const errors: NewRuleErrors = {};
  const code = fields.code.trim();
  const name = fields.name.trim();
  const description = fields.description.trim();

  if (code.length === 0) {
    errors.code = 'Enter a rule code.';
  } else if (code.length < RULE_CODE_MIN || code.length > RULE_CODE_MAX) {
    errors.code = `The rule code must be ${RULE_CODE_MIN} to ${RULE_CODE_MAX} characters long.`;
  } else if (!/^[a-z0-9_-]+$/.test(code)) {
    errors.code = 'Use only lowercase letters, numbers, underscores (_) and hyphens (-). No spaces.';
  }

  if (name.length === 0) {
    errors.name = 'Enter a rule name.';
  } else if (name.length < RULE_NAME_MIN || name.length > RULE_NAME_MAX) {
    errors.name = `The rule name must be ${RULE_NAME_MIN} to ${RULE_NAME_MAX} characters long.`;
  }

  if (description.length > RULE_DESCRIPTION_MAX) {
    errors.description = `The description can be at most ${RULE_DESCRIPTION_MAX} characters.`;
  }

  return errors;
}

export const isRuleValid = (errors: NewRuleErrors): boolean => Object.keys(errors).length === 0;

/** What each trigger means, shown under the Trigger Type field so the choice is clear. */
export const TRIGGER_HELP: Record<string, string> = {
  EVENT: 'Runs when something happens in the system, such as a new lead being created.',
  SCHEDULE: 'Runs on a timetable, such as every morning at 9.',
  TIMER: 'Runs a set time after something happened, such as 2 days after a lead is created.',
  WATCH: 'Runs when a record moves to a particular state.',
  MANUAL: 'Runs only when a staff member starts it.',
};

/** Turns the API's answer into a message the person can act on. */
export function createFailureMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : '';
  if (/already exists|duplicate|conflict/i.test(message)) {
    return 'A rule with this code already exists. Choose a different code.';
  }
  if (/permission/i.test(message)) {
    return 'You do not have permission to create automation rules.';
  }
  return message || 'The rule could not be created. Check the fields and try again.';
}

/** The checks for a rule's name and description, the fields that can be edited on an existing rule. */
export function validateRuleDetails(fields: { name: string; description: string }): { name?: string; description?: string } {
  const errors: { name?: string; description?: string } = {};
  const name = fields.name.trim();
  if (name.length === 0) {
    errors.name = 'Enter a rule name.';
  } else if (name.length < RULE_NAME_MIN || name.length > RULE_NAME_MAX) {
    errors.name = `The rule name must be ${RULE_NAME_MIN} to ${RULE_NAME_MAX} characters long.`;
  }
  if (fields.description.trim().length > RULE_DESCRIPTION_MAX) {
    errors.description = `The description can be at most ${RULE_DESCRIPTION_MAX} characters.`;
  }
  return errors;
}
