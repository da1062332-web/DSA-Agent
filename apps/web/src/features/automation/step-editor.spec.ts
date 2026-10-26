// Checks for the steps built in a new automation version. Mirrors the rules the API applies to each step.
import { describe, expect, it } from 'vitest';
import { defaultTitle, newStep, toApiStep, validateSteps, withEndLast, type EditableStep } from './step-editor';

const notify = (over: Partial<EditableStep> = {}): EditableStep => ({
  id: 'step_1',
  name: 'Notify a person',
  type: 'NOTIFY',
  title: 'New lead: call within 1 hour',
  category: 'LEAD',
  deepLink: '/leads',
  ...over,
});
const end = (): EditableStep => ({ id: 'step_2', name: 'End the run', type: 'END', title: '', category: 'LEAD', deepLink: '' });

describe('Automation version steps', () => {
  it('accepts a notify step followed by an end step', () => {
    expect(validateSteps([notify(), end()])).toEqual({});
  });

  it('needs at least one step, and the last one must end the run', () => {
    expect(validateSteps([])['']).toContain('Add at least one step');
    expect(validateSteps([notify()])['']).toContain('must be "End the run"');
  });

  it('needs a title of at least 3 characters on notify and task steps', () => {
    expect(validateSteps([notify({ title: 'hi' }), end()]).step_1).toContain('at least 3');
    const task: EditableStep = { ...notify({ title: '' }), type: 'CREATE_TASK' };
    expect(validateSteps([task, end()]).step_1).toContain('at least 3');
  });

  it('accepts only a page inside this app as the link', () => {
    expect(validateSteps([notify({ deepLink: 'https://example.com' }), end()]).step_1).toContain('page in this app');
    expect(validateSteps([notify({ deepLink: '/leads/new' }), end()])).toEqual({});
  });

  it('creates unique step ids that the server accepts', () => {
    const first = newStep('NOTIFY', []);
    const second = newStep('END', [first]);
    expect(first.id).toBe('step_1');
    expect(second.id).toBe('step_2');
    expect(second.id).toMatch(/^[a-zA-Z0-9_-]+$/);
  });

  it('converts a notify step to the shape the API stores, and ends with an outcome', () => {
    expect(toApiStep(notify())).toMatchObject({
      type: 'NOTIFY',
      config: { title: 'New lead: call within 1 hour', category: 'LEAD', deepLink: '/leads' },
    });
    expect(toApiStep(end())).toMatchObject({ type: 'END', config: { outcomeStatus: 'SUCCEEDED' } });
  });
});

describe('End step placement', () => {
  it('moves the End step last and never keeps two', () => {
    const result = withEndLast([end(), notify(), { ...end(), id: 'step_9' }]);
    expect(result.map((st) => st.type)).toEqual(['NOTIFY', 'END']);
  });

  it('adds an End step when the list has none, and gives each type its starting text', () => {
    expect(withEndLast([notify()]).at(-1)?.type).toBe('END');
    expect(defaultTitle('NOTIFY')).toBe('New lead: call within 1 hour');
    expect(defaultTitle('END')).toBe('');
  });
});
