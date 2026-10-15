import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MessagingPage } from './MessagingPage';

describe('MessagingPage access notice', () => {
  it('shows no warning before any request is refused', () => {
    expect(renderToString(<MessagingPage />)).not.toContain('messaging.noAccess');
  });
});
