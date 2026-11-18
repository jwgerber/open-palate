import { createTheme } from '@mui/material/styles';
import '@fontsource-variable/bricolage-grotesque/opsz.css';
import '@fontsource-variable/figtree';

/**
 * Open Palate's look: Bricolage Grotesque for headings, cup letters and
 * buttons, Figtree for everything else, both bundled (no font CDN, so a
 * self-hosted install never calls out). Light mode is Persimmon, dark mode is
 * Night shift. The flavor wheel keeps its own SCA colors (lexicon.js).
 *
 * Two custom palette tokens the Tasting UI reads: `warning.ink` and `surface.deep`.
 */
const DISPLAY = '"Bricolage Grotesque Variable", "Figtree Variable", system-ui, sans-serif';
const BODY = '"Figtree Variable", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

// `primary.main` is drawn as TEXT in many places (links, scale words), so in light mode it is the
// deeper persimmon that clears 4.5:1 on white. `fill` is the brighter persimmon for big filled
// buttons, carrying dark text; at 3:1 on white it is too faint to be text itself.
const LIGHT = {
  primary: { main: '#C2551E', dark: '#A3410F', light: '#FBE4D5', contrastText: '#FFFFFF' },
  fill: { main: '#E8783C', hover: '#DD6A2C', text: '#1F1A16' },
  background: { default: '#FFFAF6', paper: '#FFFFFF' },
  text: { primary: '#1F1A16', secondary: '#6A5E54' },
  divider: '#F1E3D6',
  warning: { main: '#ed9b00', ink: '#8a4b00' },
  shadow: 'rgba(31,26,22,0.08)',
};

const DARK = {
  primary: { main: '#F2B266', dark: '#F7C88F', light: '#3A3128', contrastText: '#15120F' },
  fill: { main: '#F2B266', hover: '#F7C88F', text: '#15120F' },
  background: { default: '#15120F', paper: '#221D18' },
  text: { primary: '#F4EDE4', secondary: '#B5A898' },
  divider: '#3A3128',
  warning: { main: '#ed9b00', ink: '#ffcc80' },
  shadow: 'rgba(0,0,0,0.35)',
};

export const buildTheme = (mode = 'light') => {
  const c = mode === 'dark' ? DARK : LIGHT;
  return createTheme({
    palette: {
      mode,
      primary: c.primary,
      background: c.background,
      text: c.text,
      divider: c.divider,
      warning: c.warning,
      surface: { deep: '#2A2630' },
    },
    shape: { borderRadius: 14 },
    typography: {
      fontFamily: BODY,
      h1: { fontFamily: DISPLAY, fontWeight: 800, letterSpacing: '-0.03em' },
      h2: { fontFamily: DISPLAY, fontWeight: 800, letterSpacing: '-0.02em' },
      h3: { fontFamily: DISPLAY, fontWeight: 700, letterSpacing: '-0.02em' },
      h4: { fontFamily: DISPLAY, fontWeight: 700, letterSpacing: '-0.02em' },
      h5: { fontFamily: DISPLAY, fontWeight: 700, letterSpacing: '-0.01em' },
      h6: { fontFamily: DISPLAY, fontWeight: 700 },
      button: { fontFamily: DISPLAY, fontWeight: 700, textTransform: 'none', letterSpacing: 0 },
    },
    components: {
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { borderRadius: 999 },
          sizeLarge: { minHeight: 52 },
          containedPrimary: { backgroundColor: c.fill.main, color: c.fill.text, '&:hover': { backgroundColor: c.fill.hover } },
        },
      },
      MuiFab: {
        styleOverrides: {
          primary: { backgroundColor: c.fill.main, color: c.fill.text, '&:hover': { backgroundColor: c.fill.hover } },
        },
      },
      MuiCard: {
        defaultProps: { elevation: 0 },
        styleOverrides: { root: { borderRadius: 20, boxShadow: `0 1px 3px ${c.shadow}` } },
      },
      MuiChip: {
        styleOverrides: { root: { fontWeight: 600 } },
      },
    },
  });
};

export default buildTheme();
