// App theme (owner: Dev 1). One type scale and one set of component defaults for every screen, so pages built by
// different developers read the same: Inter for all text, one page-title size, flat bordered cards on a white canvas,
// quiet table headers, compact inputs.
//
// Colour system
//   Brand      navy #215988 is the one action colour (buttons, links, focus, active navigation). #3876BE is its lighter step.
//   Neutrals   slate scale for text, borders and surfaces; the canvas is plain white and structure comes from 1px borders.
//   Status     green / amber / red / blue only ever mean success / attention / failure / information.
//   Top bar    deep navy with white text; the tangerine #F89344 of the brand swatch is its accent line (see shell/AppLayout.tsx).
//              Tangerine is not an action colour and carries no UI state.
import { createTheme } from '@mui/material';

const FONT = '"Inter", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';

const NAVY = '#215988';
const NAVY_DARK = '#174368';
const OCEAN = '#3876BE';
const NAVY_TINT = '#EEF4FA'; // selected / hover surface behind navy text
const BORDER = '#E2E8F0';
const INPUT_BORDER = '#CBD5E1';

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: NAVY, light: OCEAN, dark: NAVY_DARK, contrastText: '#ffffff' },
    secondary: { main: '#475569', light: '#64748B', dark: '#334155', contrastText: '#ffffff' },
    info: { main: OCEAN, light: '#6B9BD2', dark: NAVY, contrastText: '#ffffff' },
    success: { main: '#15803D', light: '#16A34A', dark: '#166534', contrastText: '#ffffff' },
    warning: { main: '#D97706', light: '#F59E0B', dark: '#B45309', contrastText: '#ffffff' },
    error: { main: '#DC2626', light: '#EF4444', dark: '#B91C1C', contrastText: '#ffffff' },
    grey: {
      50: '#F8FAFC',
      100: '#F1F5F9',
      200: '#E2E8F0',
      300: '#CBD5E1',
      400: '#94A3B8',
      500: '#64748B',
      600: '#475569',
      700: '#334155',
      800: '#1E293B',
      900: '#0F172A',
    },
    text: {
      primary: '#0F172A',
      secondary: '#475569',
      disabled: '#94A3B8',
    },
    background: { default: '#FFFFFF', paper: '#FFFFFF' },
    divider: BORDER,
    action: {
      active: '#475569',
      hover: 'rgba(15, 23, 42, 0.04)',
      selected: 'rgba(33, 89, 136, 0.08)',
      disabled: 'rgba(15, 23, 42, 0.26)',
      disabledBackground: 'rgba(15, 23, 42, 0.06)',
    },
  },
  // sx borderRadius numbers multiply this: 1 = 4px, 2 = 8px, 3 = 12px. Components that need an exact radius set it in px.
  shape: { borderRadius: 4 },
  typography: {
    fontFamily: FONT,
    h1: { fontSize: '2rem', fontWeight: 600, lineHeight: 1.25, letterSpacing: '-0.02em' },
    h2: { fontSize: '1.75rem', fontWeight: 600, lineHeight: 1.25, letterSpacing: '-0.02em' },
    h3: { fontSize: '1.5rem', fontWeight: 600, lineHeight: 1.3, letterSpacing: '-0.015em' },
    h4: { fontSize: '1.5rem', fontWeight: 600, lineHeight: 1.3, letterSpacing: '-0.015em' },
    h5: { fontSize: '1.25rem', fontWeight: 600, lineHeight: 1.35, letterSpacing: '-0.01em' },
    h6: { fontSize: '1rem', fontWeight: 600, lineHeight: 1.4 },
    subtitle1: { fontSize: '0.9375rem', fontWeight: 600 },
    subtitle2: { fontSize: '0.8125rem', fontWeight: 600 },
    body1: { fontSize: '0.875rem', lineHeight: 1.6 },
    body2: { fontSize: '0.8125rem', lineHeight: 1.55 },
    caption: { fontSize: '0.75rem', lineHeight: 1.5 },
    overline: { fontSize: '0.6875rem', fontWeight: 600, letterSpacing: '0.08em', lineHeight: 1.5 },
    button: { textTransform: 'none', fontWeight: 600, letterSpacing: 0 },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          WebkitFontSmoothing: 'antialiased',
          MozOsxFontSmoothing: 'grayscale',
          backgroundColor: '#FFFFFF',
          color: '#0F172A',
        },
        // Plain anchors (outside MUI Link / Button) take the brand colour instead of the browser default blue.
        a: { color: NAVY },
      },
    },
    MuiAppBar: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: { backgroundColor: NAVY, color: '#FFFFFF' },
      },
    },
    MuiDrawer: {
      styleOverrides: { paper: { backgroundColor: '#FFFFFF', borderRight: `1px solid ${BORDER}` } },
    },
    MuiButton: {
      defaultProps: { disableElevation: true, color: 'primary' },
      styleOverrides: {
        root: {
          borderRadius: 8,
          fontWeight: 600,
          textTransform: 'none',
          letterSpacing: 0,
          whiteSpace: 'nowrap',
          transition: 'background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease',
        },
        sizeSmall: { height: 30, padding: '4px 12px', fontSize: '0.8125rem', borderRadius: 6 },
        sizeMedium: { height: 36, padding: '6px 16px', fontSize: '0.875rem' },
        sizeLarge: { height: 42, padding: '8px 20px', fontSize: '0.9375rem' },
        contained: { boxShadow: 'none', '&:hover': { boxShadow: 'none' } },
        containedPrimary: { backgroundColor: NAVY, '&:hover': { backgroundColor: NAVY_DARK } },
        // `secondary` buttons are the same brand action; the secondary palette step is for neutral chips.
        containedSecondary: { backgroundColor: NAVY, color: '#ffffff', '&:hover': { backgroundColor: NAVY_DARK } },
        containedInfo: { backgroundColor: NAVY, color: '#ffffff', '&:hover': { backgroundColor: NAVY_DARK } },
        containedError: { '&:hover': { backgroundColor: '#B91C1C' } },
        containedSuccess: { '&:hover': { backgroundColor: '#166534' } },
        outlined: {
          borderColor: INPUT_BORDER,
          color: '#0F172A',
          backgroundColor: '#FFFFFF',
          '&:hover': { borderColor: '#94A3B8', backgroundColor: '#F8FAFC' },
        },
        outlinedPrimary: {
          borderColor: INPUT_BORDER,
          color: NAVY,
          '&:hover': { borderColor: NAVY, backgroundColor: NAVY_TINT },
        },
        outlinedSecondary: {
          borderColor: INPUT_BORDER,
          color: NAVY,
          '&:hover': { borderColor: NAVY, backgroundColor: NAVY_TINT },
        },
        outlinedInfo: {
          borderColor: INPUT_BORDER,
          color: NAVY,
          '&:hover': { borderColor: NAVY, backgroundColor: NAVY_TINT },
        },
        text: { color: '#475569', '&:hover': { backgroundColor: '#F1F5F9', color: '#0F172A' } },
        textPrimary: { color: NAVY, '&:hover': { backgroundColor: NAVY_TINT, color: NAVY_DARK } },
      },
    },
    MuiIconButton: {
      styleOverrides: { root: { borderRadius: 8 } },
    },
    MuiTextField: { defaultProps: { size: 'small' } },
    MuiFormControl: { defaultProps: { size: 'small' } },
    MuiInputLabel: {
      styleOverrides: { root: { fontSize: '0.875rem' } },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          backgroundColor: '#FFFFFF',
          borderRadius: 8,
          fontSize: '0.875rem',
          '& .MuiOutlinedInput-notchedOutline': { borderColor: INPUT_BORDER },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#94A3B8' },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: NAVY, borderWidth: 1 },
          '&.Mui-focused': { boxShadow: '0 0 0 3px rgba(56, 118, 190, 0.18)' },
          '&.Mui-error .MuiOutlinedInput-notchedOutline': { borderColor: '#DC2626' },
          '&.Mui-disabled': { backgroundColor: '#F8FAFC' },
        },
        input: { '&::placeholder': { color: '#94A3B8', opacity: 1 } },
      },
    },
    MuiMenuItem: {
      styleOverrides: {
        root: {
          fontSize: '0.875rem',
          '&.Mui-selected': { backgroundColor: 'rgba(33, 89, 136, 0.08)' },
          '&.Mui-selected:hover': { backgroundColor: 'rgba(33, 89, 136, 0.12)' },
        },
      },
    },
    MuiPopover: {
      styleOverrides: {
        paper: {
          border: `1px solid ${BORDER}`,
          borderRadius: 8,
          boxShadow: '0 8px 24px -6px rgba(15, 23, 42, 0.14), 0 2px 6px -2px rgba(15, 23, 42, 0.06)',
        },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: { backgroundColor: '#1E293B', fontSize: '0.75rem', fontWeight: 500, borderRadius: 6, padding: '6px 10px' },
        arrow: { color: '#1E293B' },
      },
    },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: { border: `1px solid ${BORDER}`, borderRadius: 10, backgroundColor: '#ffffff', boxShadow: 'none' },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: 'none' },
        rounded: { borderRadius: 8 },
      },
    },
    MuiCardContent: {
      styleOverrides: { root: { padding: 20, '&:last-child': { paddingBottom: 20 } } },
    },
    MuiDialog: {
      styleOverrides: {
        paper: { borderRadius: 12, boxShadow: '0 24px 48px -12px rgba(15, 23, 42, 0.25)' },
      },
    },
    MuiDialogTitle: {
      styleOverrides: { root: { fontSize: '1.125rem', fontWeight: 600, color: '#0F172A', padding: '20px 24px 12px' } },
    },
    MuiDialogActions: {
      styleOverrides: { root: { padding: '12px 24px 20px' } },
    },
    MuiTableCell: {
      styleOverrides: {
        head: {
          fontWeight: 600,
          fontSize: '0.75rem',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: '#64748B',
          backgroundColor: '#F8FAFC',
          borderBottom: `1px solid ${BORDER}`,
        },
        root: { borderColor: '#EEF2F6', color: '#0F172A', padding: '10px 16px' },
      },
    },
    MuiTableRow: {
      styleOverrides: { hover: { '&:hover': { backgroundColor: '#F8FAFC' } } },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 500, fontSize: '0.75rem', borderRadius: 6 },
        outlined: { borderColor: INPUT_BORDER },
        colorDefault: { backgroundColor: '#F1F5F9', color: '#334155' },
        colorPrimary: { backgroundColor: NAVY, color: '#ffffff' },
        colorSecondary: { backgroundColor: '#EEF2F7', color: '#334155' },
        colorInfo: { backgroundColor: OCEAN, color: '#ffffff' },
      },
    },
    MuiTabs: {
      styleOverrides: {
        root: { minHeight: 44, borderBottom: `1px solid ${BORDER}` },
        indicator: { backgroundColor: NAVY, height: 2 },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          fontSize: '0.875rem',
          minHeight: 44,
          color: '#64748B',
          '&.Mui-selected': { color: NAVY },
        },
      },
    },
    MuiToggleButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          color: '#475569',
          borderColor: INPUT_BORDER,
          '&.Mui-selected': { color: NAVY, backgroundColor: NAVY_TINT },
          '&.Mui-selected:hover': { backgroundColor: '#E2ECF6' },
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: { '&.Mui-selected': { backgroundColor: NAVY_TINT }, '&.Mui-selected:hover': { backgroundColor: '#E2ECF6' } },
      },
    },
    MuiLinearProgress: {
      styleOverrides: { root: { height: 6, borderRadius: 4, backgroundColor: '#E2E8F0' } },
    },
    MuiLink: {
      defaultProps: { underline: 'hover' },
    },
    MuiAlert: {
      styleOverrides: {
        root: { borderRadius: 8, border: '1px solid', fontSize: '0.8125rem' },
        standardSuccess: {
          backgroundColor: '#F0FDF4',
          color: '#166534',
          borderColor: '#BBF7D0',
          '& .MuiAlert-icon': { color: '#16A34A' },
        },
        standardInfo: {
          backgroundColor: '#EFF6FF',
          color: '#1E40AF',
          borderColor: '#BFDBFE',
          '& .MuiAlert-icon': { color: '#2563EB' },
        },
        standardWarning: {
          backgroundColor: '#FFFBEB',
          color: '#92400E',
          borderColor: '#FDE68A',
          '& .MuiAlert-icon': { color: '#D97706' },
        },
        standardError: {
          backgroundColor: '#FEF2F2',
          color: '#991B1B',
          borderColor: '#FECACA',
          '& .MuiAlert-icon': { color: '#DC2626' },
        },
      },
    },
  },
});
