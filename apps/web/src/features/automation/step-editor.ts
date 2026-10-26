// Rules for the steps a person can build in a new automation version (owner: Akash, MOD-WFA). The step types here are the
// ones the screen can build; the API checks every step again (StepDefinitionSchema in packages/contracts/src/automation.ts).

export type EditableStepType = 'NOTIFY' | 'CREATE_TASK' | 'END';

export const EDITABLE_STEP_TYPES: { value: EditableStepType; label: string; help: string }[] = [
  { value: 'NOTIFY', label: 'Notify a person', help: 'Sends an in-app notification to the lead owner (or the person who triggered the rule).' },
  { value: 'CREATE_TASK', label: 'Create a follow-up task', help: 'Creates a task on the lead for its owner.' },
  { value: 'END', label: 'End the run', help: 'Stops the rule here. Every rule should finish with this step.' },
];

export interface EditableStep {
  id: string;
  name: string;
  type: EditableStepType;
  title: string;
  category: 'TASK' | 'LEAD' | 'APPLICATION' | 'SYSTEM' | 'ALERT';
  deepLink: string;
}

export interface StepInput {
  type: EditableStepType;
  title: string;
  category: EditableStep['category'];
  deepLink: string;
}

const STEP_ID_PREFIX = 'step';

/** The starting text for a step type. End has no text of its own. */
export function defaultTitle(type: EditableStepType): string {
  if (type === 'NOTIFY') return 'New lead: call within 1 hour';
  if (type === 'CREATE_TASK') return 'Call the new lead';
  return '';
}

/**
 * Makes sure the list ends with exactly one End step: keeps the first End step if there is one, adds one if not, and moves
 * it last. Any other End steps are dropped, so a rule can't end twice.
 */
export function withEndLast(steps: EditableStep[]): EditableStep[] {
  const others = steps.filter((st) => st.type !== 'END');
  const end = steps.find((st) => st.type === 'END') ?? newStep('END', others);
  return [...others, end];
}

/** A new step with a unique id, like step_1, step_2. Ids use only letters, numbers, _ and -, as the server requires. */
export function newStep(type: EditableStepType, existing: EditableStep[]): EditableStep {
  let n = existing.length + 1;
  while (existing.some((s) => s.id === `${STEP_ID_PREFIX}_${n}`)) n += 1;
  const label = EDITABLE_STEP_TYPES.find((t) => t.value === type)?.label ?? type;
  return {
    id: `${STEP_ID_PREFIX}_${n}`,
    name: label,
    type,
    title: defaultTitle(type),
    category: type === 'CREATE_TASK' ? 'TASK' : 'LEAD',
    deepLink: type === 'END' ? '' : '/leads',
  };
}

/** Converts an editable step into the shape the API stores. END carries its outcome; the others carry their config. */
export function toApiStep(step: EditableStep): { id: string; name: string; type: EditableStepType; isSkippable: boolean; config: Record<string, unknown> } {
  if (step.type === 'END') {
    return { id: step.id, name: step.name, type: 'END', isSkippable: false, config: { outcomeStatus: 'SUCCEEDED' } };
  }
  if (step.type === 'CREATE_TASK') {
    return {
      id: step.id,
      name: step.name,
      type: 'CREATE_TASK',
      isSkippable: false,
      config: { title: step.title.trim() },
    };
  }
  return {
    id: step.id,
    name: step.name,
    type: 'NOTIFY',
    isSkippable: false,
    config: { title: step.title.trim(), category: step.category, deepLink: step.deepLink.trim() || undefined },
  };
}

/** Checks the steps before they are saved. Returns messages a person can act on, keyed by step id; '' key = whole list. */
export function validateSteps(steps: EditableStep[]): Record<string, string> {
  const errors: Record<string, string> = {};
  if (steps.length === 0) {
    errors[''] = 'Add at least one step.';
    return errors;
  }
  if (steps[steps.length - 1]!.type !== 'END') {
    errors[''] = 'The last step must be "End the run", so the rule has a clear finish.';
  }
  for (const step of steps) {
    if (step.type === 'NOTIFY' || step.type === 'CREATE_TASK') {
      const title = step.title.trim();
      if (title.length < 3) errors[step.id] = 'Write a title of at least 3 characters.';
      else if (title.length > 200) errors[step.id] = 'The title can be at most 200 characters.';
    }
    if (step.type === 'NOTIFY' && step.deepLink.trim() && !/^\/[a-zA-Z0-9_.-]+(\/[a-zA-Z0-9_.-]+)*$/.test(step.deepLink.trim())) {
      errors[step.id] = 'The link must be a page in this app, such as /leads.';
    }
  }
  return errors;
}
