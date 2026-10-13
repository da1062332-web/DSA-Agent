// App root (owner: Dev 1). Server state goes through TanStack Query only; there is no global store.
// supabase-js is used for auth.* only; all data comes from the Express API (Contracts §14).
import { CssBaseline, ThemeProvider } from '@mui/material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import { readConfig } from './config';
import { routes } from './routes';
import { ConfigError } from './shell/ConfigError';
import { theme } from './shell/theme';
import { ToastProvider } from './shell/toast';

const queryClient = new QueryClient();
const router = createBrowserRouter(routes);

export function App() {
  const config = readConfig();
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {config.success ? (
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <ToastProvider>
              <RouterProvider router={router} />
            </ToastProvider>
          </AuthProvider>
        </QueryClientProvider>
      ) : (
        <ConfigError variables={config.error.issues.map((i) => i.path.join('.'))} />
      )}
    </ThemeProvider>
  );
}
