import { Container } from '@mui/material';
import type { ReactNode } from 'react';

interface PageContainerProps {
  children: ReactNode;
  dataTestId?: string;
}

/**
 * Full-width page wrapper. The page uses the whole content area, so cards and grids stretch with the window
 * instead of stopping at a fixed max width.
 */
export function PageContainer({ children, dataTestId }: PageContainerProps) {
  return (
    <Container maxWidth={false} disableGutters sx={{ mx: 0 }} data-testid={dataTestId}>
      {children}
    </Container>
  );
}
