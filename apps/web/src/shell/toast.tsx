// Toast messages (owner: Dev 1). One provider for the whole app, using the same MUI Alert styles as the inline messages,
// so a toast looks like the rest of the UI. Toasts confirm an action or report a failure; field-level problems stay
// next to the field they belong to.
import { Alert, Snackbar, type AlertColor } from '@mui/material';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

interface Toast {
  id: number;
  message: string;
  severity: AlertColor;
}

export interface ToastApi {
  success(message: string): void;
  error(message: string): void;
  info(message: string): void;
  warning(message: string): void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** How long a toast stays: errors stay longer so they can be read. */
const DURATION_MS: Record<AlertColor, number> = { success: 4000, info: 4000, warning: 6000, error: 8000 };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Toast[]>([]);
  const current = queue[0];

  const push = useCallback((severity: AlertColor, message: string) => {
    setQueue((q) => [...q, { id: Date.now() + Math.random(), message, severity }]);
  }, []);
  const dismiss = useCallback(() => setQueue((q) => q.slice(1)), []);

  const api = useMemo<ToastApi>(
    () => ({
      success: (m) => push('success', m),
      error: (m) => push('error', m),
      info: (m) => push('info', m),
      warning: (m) => push('warning', m),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <Snackbar
        key={current?.id}
        open={!!current}
        autoHideDuration={current ? DURATION_MS[current.severity] : null}
        onClose={(_e, reason) => {
          if (reason !== 'clickaway') dismiss();
        }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        {current ? (
          <Alert
            onClose={dismiss}
            severity={current.severity}
            variant="filled"
            sx={{ width: '100%', minWidth: 300 }}
            data-testid={`toast.${current.severity}`}
          >
            {current.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </ToastContext.Provider>
  );
}

/** Outside a provider (unit tests that render one screen) the toast is a no-op rather than a crash. */
const NOOP: ToastApi = { success() {}, error() {}, info() {}, warning() {} };

export function useToast(): ToastApi {
  return useContext(ToastContext) ?? NOOP;
}
