import { createTheme } from '@mui/material/styles';

/** Two custom palette tokens the Tasting UI reads: `warning.ink` and `surface.deep`. */
export const buildTheme = (mode = 'light') => createTheme({
  palette: {
    mode,
    primary: { main: mode === 'dark' ? '#d9a066' : '#7a4a21' },
    warning: { main: '#ed9b00', ink: mode === 'dark' ? '#ffcc80' : '#8a4b00' },
    surface: { deep: '#2A2630' },
  },
  typography: { fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
});

export default buildTheme();
