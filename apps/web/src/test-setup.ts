import React from 'react';

// In Node.js / SSR unit test environments, alias useLayoutEffect to useEffect.
// The web application is a client-side SPA (Vite + React 18); unit tests use `renderToString` from `react-dom/server`
// where DOM measurement effects are non-operational.
if (typeof window === 'undefined') {
  React.useLayoutEffect = React.useEffect;
}

const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
  if (
    typeof args[0] === 'string' &&
    args[0].includes('useLayoutEffect does nothing on the server')
  ) {
    return;
  }
  originalConsoleError(...args);
};
