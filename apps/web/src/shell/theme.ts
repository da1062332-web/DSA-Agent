// App theme (owner: Dev 1). One type scale and one set of component defaults for every screen, so pages built by
// different developers read the same: Inter for all text, one page-title size, flat bordered cards, quiet table headers.
import { createTheme } from '@mui/material';

const FONT = '"Inter", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';

export const theme = createTheme({
  palette: {
    primary: { main: '#1d5fd1' },
    background: { default: '#f6f7f9', paper: '#ffffff' },
    text: { primary: '#1f2937', secondary: '#6b7280' },
    divider: '#e5e7eb',
  },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: FONT,
    // Page titles: pages use h4 or h5 for their title; both render at the same size so every screen matches.
    h4: { fontSize: '1.5rem', fontWeight: 700, lineHeight: 1.3, letterSpacing: '-0.01em' },
    h5: { fontSize: '1.5rem', fontWeight: 700, lineHeight: 1.3, letterSpacing: '-0.01em' },
    // Card and section titles.
    h6: { fontSize: '1rem', fontWeight: 600, lineHeight: 1.4 },
    subtitle1: { fontSize: '0.9375rem', fontWeight: 600 },
    subtitle2: { fontSize: '0.875rem', fontWeight: 600 },
    body1: { fontSize: '0.9375rem', lineHeight: 1.6 },
    body2: { fontSize: '0.875rem', lineHeight: 1.55 },
    caption: { fontSize: '0.75rem' },
    button: { textTransform: 'none', fontWeight: 600, letterSpacing: 0 },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: { WebkitFontSmoothing: 'antialiased', MozOsxFontSmoothing: 'grayscale' },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { borderRadius: 8, paddingInline: 16 } },
    },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: { root: { border: '1px solid #e5e7eb', borderRadius: 12 } },
    },
    MuiPaper: {
      styleOverrides: { rounded: { borderRadius: 12 } },
    },
    MuiCardContent: {
      styleOverrides: { root: { padding: 20, '&:last-child': { paddingBottom: 20 } } },
    },
    MuiTableCell: {
      styleOverrides: {
        head: {
          fontWeight: 600,
          fontSize: '0.75rem',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          color: '#6b7280',
          backgroundColor: '#f9fafb',
        },
        root: { borderColor: '#eef0f3' },
      },
    },
    MuiTableRow: {
      styleOverrides: { hover: { '&:hover': { backgroundColor: '#f9fafb' } } },
    },
    MuiChip: {
      styleOverrides: { root: { fontWeight: 500 } },
    },
    MuiAlert: {
      styleOverrides: { root: { borderRadius: 10 } },
    },
    MuiTab: {
      styleOverrides: { root: { textTransform: 'none', fontWeight: 600 } },
    },
    MuiDialogTitle: {
      styleOverrides: { root: { fontSize: '1.125rem', fontWeight: 600 } },
    },
  },
});
