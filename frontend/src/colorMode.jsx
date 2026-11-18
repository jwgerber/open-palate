/**
 * Light / Dark / Automatic. Automatic follows the device's setting; a pinned
 * choice is remembered on this device only (localStorage). Storage can throw
 * (private mode, blocked site data), so every read and write is guarded and
 * the app still switches for the session.
 */
import { createContext, useContext, useMemo, useState } from 'react';
import { CssBaseline, ThemeProvider, useMediaQuery } from '@mui/material';
import { buildTheme } from './theme';

export const COLOR_MODE_KEY = 'openPalate.colorMode';
export const COLOR_MODES = ['system', 'light', 'dark'];

function readStored() {
  try {
    const value = localStorage.getItem(COLOR_MODE_KEY);
    return COLOR_MODES.includes(value) ? value : 'system';
  } catch (e) {
    console.warn('Could not read the appearance setting', e);
    return 'system';
  }
}

function writeStored(mode) {
  try {
    if (mode === 'system') localStorage.removeItem(COLOR_MODE_KEY);
    else localStorage.setItem(COLOR_MODE_KEY, mode);
  } catch (e) {
    console.warn('Could not save the appearance setting', e);
  }
}

const ColorModeContext = createContext({ mode: 'system', setMode: () => {} });

export function ColorModeProvider({ children }) {
  const [mode, setModeState] = useState(readStored);
  const deviceDark = useMediaQuery('(prefers-color-scheme: dark)', { noSsr: true });
  const resolved = mode === 'system' ? (deviceDark ? 'dark' : 'light') : mode;
  const theme = useMemo(() => buildTheme(resolved), [resolved]);
  const value = useMemo(() => ({
    mode,
    setMode: (next) => { setModeState(next); writeStored(next); },
  }), [mode]);
  return (
    <ColorModeContext.Provider value={value}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ColorModeContext.Provider>
  );
}

export const useColorMode = () => useContext(ColorModeContext);
