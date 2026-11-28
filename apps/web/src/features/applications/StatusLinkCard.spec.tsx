// The Share button on the application page (task P3-05, checklist 6.5; TEST-STATUS-UI-03).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StatusLinkCard } from './StatusLinkCard';

describe('TEST-STATUS-UI-03 the status link on the application', () => {
  it('TEST-STATUS-UI-03 the card offers Share status link and says the link lasts seven days', () => {
    const html = renderToString(
      <QueryClientProvider client={new QueryClient()}>
        <StatusLinkCard applicationId="app_status_1" />
      </QueryClientProvider>,
    );
    expect(html).toContain('data-testid="application.share-status-link"');
    expect(html).toContain('Share status link');
    expect(html).toContain('seven days');
  });
});
