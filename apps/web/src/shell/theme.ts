// App theme (owner: Dev 1). One type scale and one set of component defaults for every screen, so pages built by
// different developers read the same: Inter for all text, one page-title size, flat bordered cards, quiet table headers.
import { createTheme } from '@mui/material';

const FONT = '"Inter", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#1d4ed8', // Enterprise Cobalt Blue (Blue 700)
      light: '#3b82f6', // Blue 500
      dark: '#1e40af', // Blue 800
      contrastText: '#ffffff',
    },
    secondary: {
      main: '#475569', // Slate 600
      light: '#64748b', // Slate 500
      dark: '#334155', // Slate 700
      contrastText: '#ffffff',
    },
    success: {
      main: '#059669', // Emerald 600
      light: '#10b981', // Emerald 500
      dark: '#047857', // Emerald 700
      contrastText: '#ffffff',
    },
    warning: {
      main: '#d97706', // Amber 600
      light: '#f59e0b', // Amber 500
      dark: '#b45309', // Amber 700
      contrastText: '#ffffff',
    },
    error: {
      main: '#dc2626', // Red 600
      light: '#ef4444', // Red 500
      dark: '#b91c1c', // Red 700
      contrastText: '#ffffff',
    },
    info: {
      main: '#0284c7', // Sky 600
      light: '#38bdf8', // Sky 400
      dark: '#0369a1', // Sky 700
      contrastText: '#ffffff',
    },
    grey: {
      50: '#f8fafc',
      100: '#f1f5f9',
      200: '#e2e8f0',
      300: '#cbd5e1',
      400: '#94a3b8',
      500: '#64748b',
      600: '#475569',
      700: '#334155',
      800: '#1e293b',
      900: '#0f172a',
    },
    text: {
      primary: '#0f172a', // Slate 900
      secondary: '#64748b', // Slate 500
      disabled: '#94a3b8', // Slate 400
    },
    background: {
      default: '#f8fafc', // Crisp clean slate-50
      paper: '#ffffff',
    },
    divider: '#e2e8f0', // Slate 200 hairline border
    action: {
      active: '#475569',
      hover: 'rgba(15, 23, 42, 0.04)',
      selected: 'rgba(29, 78, 216, 0.08)',
      disabled: 'rgba(15, 23, 42, 0.26)',
      disabledBackground: 'rgba(15, 23, 42, 0.06)',
    },
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
        body: {
          WebkitFontSmoothing: 'antialiased',
          MozOsxFontSmoothing: 'grayscale',
          backgroundColor: '#f8fafc',
          color: '#0f172a',
        },
      },
    },
    MuiAppBar: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundColor: '#ffffff',
          color: '#0f172a',
          borderBottom: '1px solid #e2e8f0',
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: '#ffffff',
          borderRight: '1px solid #e2e8f0',
        },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          borderRadius: 8,
          paddingInline: 16,
          fontWeight: 600,
          textTransform: 'none',
        },
        containedPrimary: {
          backgroundColor: '#1d4ed8',
          '&:hover': {
            backgroundColor: '#1e40af',
          },
        },
      },
    },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          border: '1px solid #e2e8f0',
          borderRadius: 12,
          backgroundColor: '#ffffff',
          boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.04), 0 1px 2px 0 rgba(0, 0, 0, 0.02)',
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
        },
        rounded: {
          borderRadius: 12,
        },
      },
    },
    MuiCardContent: {
      styleOverrides: {
        root: {
          padding: 20,
          '&:last-child': { paddingBottom: 20 },
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        head: {
          fontWeight: 700,
          fontSize: '0.75rem',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          color: '#475569',
          backgroundColor: '#f8fafc',
          borderBottom: '1px solid #e2e8f0',
        },
        root: {
          borderColor: '#f1f5f9',
          color: '#0f172a',
        },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        hover: {
          '&:hover': {
            backgroundColor: '#f8fafc',
          },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontWeight: 600,
          borderRadius: 6,
        },
        outlined: {
          borderColor: '#cbd5e1',
        },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: {
          borderRadius: 10,
          border: '1px solid',
        },
        standardSuccess: {
          backgroundColor: '#f0fdf4',
          color: '#166534',
          borderColor: '#bbf7d0',
          '& .MuiAlert-icon': { color: '#16a34a' },
        },
        standardInfo: {
          backgroundColor: '#f0f9ff',
          color: '#075985',
          borderColor: '#bae6fd',
          '& .MuiAlert-icon': { color: '#0284c7' },
        },
        standardWarning: {
          backgroundColor: '#fffbeb',
          color: '#92400e',
          borderColor: '#fde68a',
          '& .MuiAlert-icon': { color: '#d97706' },
        },
        standardError: {
          backgroundColor: '#fef2f2',
          color: '#991b1b',
          borderColor: '#fecaca',
          '& .MuiAlert-icon': { color: '#dc2626' },
        },
      },
    },
    MuiTab: {
      styleOverrides: { root: { textTransform: 'none', fontWeight: 600 } },
    },
    MuiDialogTitle: {
      styleOverrides: { root: { fontSize: '1.125rem', fontWeight: 600 } },
    },
  },
});
