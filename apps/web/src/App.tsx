// App root (owner: Dev 1). Server state goes through TanStack Query only; there is no global store.
// supabase-js is used for auth.* only; all data comes from the Express API (Contracts §14).
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import { readConfig } from './config';
import { routes } from './routes';
import { ConfigError } from './shell/ConfigError';

const theme = createTheme();
const queryClient = new QueryClient();
const router = createBrowserRouter(routes);

export function App() {
  const config = readConfig();
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {config.success ? (
        <AuthProvider>
          <QueryClientProvider client={queryClient}>
            <RouterProvider router={router} />
          </QueryClientProvider>
        </AuthProvider>
      ) : (
        <ConfigError variables={config.error.issues.map((i) => i.path.join('.'))} />
      )}
    </ThemeProvider>
  );
}
