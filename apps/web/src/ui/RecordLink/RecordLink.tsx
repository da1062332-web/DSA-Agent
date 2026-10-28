import { Link, type LinkProps } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

export interface RecordLinkProps extends Omit<LinkProps, 'component' | 'href' | 'color'> {
  to: string;
}

/**
 * Link to a record's detail page. Always orange and bold, so linked data reads the same in every table and detail view.
 */
export function RecordLink({ to, sx, ...rest }: RecordLinkProps) {
  return (
    <Link
      component={RouterLink}
      to={to}
      underline="hover"
      sx={{ color: 'primary.main', fontWeight: 600, ...sx }}
      {...rest}
    />
  );
}
