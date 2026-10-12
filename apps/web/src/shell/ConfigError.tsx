import { Alert, AlertTitle, Box } from '@mui/material';

/** Shown instead of the app when apps/web/.env is missing or invalid. Lists variable names, never values. */
export function ConfigError({ variables }: { variables: string[] }) {
  return (
    <Box sx={{ p: 3 }}>
      <Alert severity="error">
        <AlertTitle>Web configuration is missing or invalid</AlertTitle>
        Copy <code>apps/web/.env.example</code> to <code>apps/web/.env</code> and set: {variables.join(', ')}.
      </Alert>
    </Box>
  );
}
