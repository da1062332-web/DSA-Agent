// App theme (owner: Dev 1). One type scale and one set of component defaults for every screen, so pages built by
// different developers read the same: Inter for all text, one page-title size, flat bordered cards, quiet table headers.
import { createTheme } from '@mui/material';

const FONT = '"Inter", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';

// Exact Palette Tokens from Brand Swatch Guide:
// Primary: #F89344 (Tangerine / Warm Orange)
// Secondary: #FF642F (Vibrant Coral / Red-Orange)
// BG/700: #215988 (Deep Navy / Enterprise Slate Blue)
// BG/500: #3876BE (Vibrant Ocean / Mid Blue)
// BG/300: #B8D5E7 (Soft Light Ice Blue)

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#F89344', // Swatch Primary: Tangerine Orange
      light: '#FFAA66',
      dark: '#D97324',
      contrastText: '#ffffff',
    },
    secondary: {
      main: '#FF642F', // Swatch Secondary: Coral / Red-Orange
      light: '#FF885E',
      dark: '#DB4512',
      contrastText: '#ffffff',
    },
    info: {
      main: '#215988', // Swatch BG/700: Deep Navy / Slate Blue
      light: '#3876BE', // Swatch BG/500: Vibrant Ocean Blue
      dark: '#174368',
      contrastText: '#ffffff',
    },
    success: {
      main: '#059669', // Emerald 600
      light: '#10b981',
      dark: '#047857',
      contrastText: '#ffffff',
    },
    warning: {
      main: '#F89344', // Tangerine
      light: '#FFB87D',
      dark: '#D97324',
      contrastText: '#ffffff',
    },
    error: {
      main: '#FF642F', // Coral Accent
      light: '#FF885E',
      dark: '#D32F2F',
      contrastText: '#ffffff',
    },
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
      primary: '#0F172A', // Slate 900
      secondary: '#64748B', // Slate 500
      disabled: '#94A3B8', // Slate 400
    },
    background: {
      default: '#F8FAFC', // Crisp clean slate-50 canvas
      paper: '#FFFFFF',
    },
    divider: '#E2E8F0', // Slate 200 hairline border
    action: {
      active: '#215988',
      hover: 'rgba(33, 89, 136, 0.04)',
      selected: 'rgba(56, 118, 190, 0.08)',
      disabled: 'rgba(15, 23, 42, 0.26)',
      disabledBackground: 'rgba(15, 23, 42, 0.06)',
    },
  },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: FONT,
    h4: { fontSize: '1.5rem', fontWeight: 700, lineHeight: 1.3, letterSpacing: '-0.01em' },
    h5: { fontSize: '1.5rem', fontWeight: 700, lineHeight: 1.3, letterSpacing: '-0.01em' },
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
          backgroundColor: '#F8FAFC',
          color: '#0F172A',
        },
      },
    },
    MuiAppBar: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundColor: '#656565',
          color: '#0f172a',
          borderBottom: '1px solid #e2e8f0',
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: '#ffffff',
          borderRight: '1px solid #E2E8F0',
        },
      },
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
          transition: 'all 0.15s ease-in-out',
        },
        sizeSmall: {
          height: 32,
          padding: '4px 12px',
          fontSize: '0.8125rem',
          borderRadius: 6,
        },
        sizeMedium: {
          height: 38,
          padding: '6px 16px',
          fontSize: '0.875rem',
          borderRadius: 8,
        },
        sizeLarge: {
          height: 44,
          padding: '10px 22px',
          fontSize: '0.9375rem',
          borderRadius: 8,
        },
        contained: {
          boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
        },
        containedPrimary: {
          backgroundColor: '#F89344', // Swatch Primary Tangerine Orange
          color: '#ffffff',
          '&:hover': {
            backgroundColor: '#D97324',
            boxShadow: '0 2px 4px 0 rgba(217, 115, 36, 0.25)',
          },
        },
        containedSecondary: {
          backgroundColor: '#215988', // Swatch BG/700 Deep Blue
          color: '#ffffff',
          '&:hover': {
            backgroundColor: '#174368',
            boxShadow: '0 2px 4px 0 rgba(23, 67, 104, 0.25)',
          },
        },
        containedError: {
          backgroundColor: '#FF642F', // Swatch Secondary Coral
          color: '#ffffff',
          '&:hover': {
            backgroundColor: '#DB4512',
          },
        },
        containedSuccess: {
          backgroundColor: '#059669',
          color: '#ffffff',
          '&:hover': {
            backgroundColor: '#047857',
          },
        },
        containedInfo: {
          backgroundColor: '#215988',
          color: '#ffffff',
          '&:hover': {
            backgroundColor: '#174368',
          },
        },
        outlined: {
          borderColor: '#CBD5E1',
          color: '#0F172A',
          backgroundColor: '#FFFFFF',
          boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.02)',
          '&:hover': {
            borderColor: '#94A3B8',
            backgroundColor: '#F8FAFC',
          },
        },
        outlinedPrimary: {
          borderColor: '#F89344',
          color: '#D97324',
          backgroundColor: '#FFFFFF',
          '&:hover': {
            borderColor: '#D97324',
            backgroundColor: 'rgba(248, 147, 68, 0.06)',
          },
        },
        outlinedSecondary: {
          borderColor: '#215988',
          color: '#215988',
          backgroundColor: '#FFFFFF',
          '&:hover': {
            borderColor: '#174368',
            backgroundColor: 'rgba(33, 89, 136, 0.06)',
          },
        },
        text: {
          color: '#475569',
          '&:hover': {
            backgroundColor: '#F1F5F9',
            color: '#0F172A',
          },
        },
      },
    },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          border: '1px solid #E2E8F0',
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
          color: '#215988', // Swatch BG/700 Deep Blue for headers
          backgroundColor: '#F8FAFC',
          borderBottom: '1px solid #E2E8F0',
        },
        root: {
          borderColor: '#F1F5F9',
          color: '#0F172A',
        },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        hover: {
          '&:hover': {
            backgroundColor: '#F8FAFC',
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
          borderColor: '#CBD5E1',
        },
        colorPrimary: {
          backgroundColor: '#F89344',
          color: '#ffffff',
        },
        colorSecondary: {
          backgroundColor: '#FF642F',
          color: '#ffffff',
        },
        colorInfo: {
          backgroundColor: '#3876BE',
          color: '#ffffff',
        },
      },
    },
    MuiTabs: {
      styleOverrides: {
        indicator: {
          backgroundColor: '#F89344',
          height: 3,
          borderRadius: '3px 3px 0 0',
        },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          color: '#64748B',
          '&.Mui-selected': {
            color: '#215988',
            fontWeight: 700,
          },
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
          backgroundColor: '#F0FDF4',
          color: '#166534',
          borderColor: '#BBF7D0',
          '& .MuiAlert-icon': { color: '#16A34A' },
        },
        standardInfo: {
          backgroundColor: '#F0F7FB', // BG/300 tint
          color: '#174368',
          borderColor: '#B8D5E7', // BG/300 border
          '& .MuiAlert-icon': { color: '#215988' },
        },
        standardWarning: {
          backgroundColor: '#FFF7ED', // Tangerine tint
          color: '#9A3412',
          borderColor: '#FED7AA',
          '& .MuiAlert-icon': { color: '#F89344' },
        },
        standardError: {
          backgroundColor: '#FFF1EC', // Coral tint
          color: '#991B1B',
          borderColor: '#FECDD3',
          '& .MuiAlert-icon': { color: '#FF642F' },
        },
      },
    },
    MuiDialogTitle: {
      styleOverrides: { root: { fontSize: '1.125rem', fontWeight: 600, color: '#215988' } },
    },
  },
});
