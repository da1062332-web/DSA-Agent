import React from 'react';
import { Typography } from '@mui/material';

/**
 * The faded placeholder for a value that has not been entered yet. Used instead of a dash everywhere a value can be missing,
 * so a blank field is clearly "not set" and not an error.
 */
export function NotSet({ children = 'Not set' }: { children?: React.ReactNode }) {
  return (
    <Typography component="span" variant="body2" sx={{ color: 'text.disabled', fontStyle: 'italic' }}>
      {children}
    </Typography>
  );
}
