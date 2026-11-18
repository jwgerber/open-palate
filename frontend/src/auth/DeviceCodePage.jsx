/**
 * A shared tablet enters the code an admin made. The session lives in the
 * server's cookie; nothing about the device or the code is kept in the browser.
 */
import { useState } from 'react';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
import { Alert, Box, Button, Link, TextField, Typography } from '@mui/material';
import api from '../api';
import { useAuth } from './AuthContext';

export default function DeviceCodePage() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (ev) => {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/device/enter', { code: code.trim() });
      await refresh();
      navigate('/', { replace: true });
    } catch (err) {
      const status = err.response?.status;
      if (status === 429) setError('Too many tries. Wait a minute and try again.');
      else if (err.response?.data?.error === 'invalid_code') setError("That code isn't valid. It may have been used or expired; ask an admin for a new one.");
      else setError("Couldn't connect this device. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box component="main" sx={{ maxWidth: 400, mx: 'auto', p: 3, pt: 8 }}>
      <Typography variant="h1" sx={{ fontSize: 28, mb: 1 }}>Connect a shared device</Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>An admin makes a one-time code under Group settings.</Typography>
      <Box component="form" onSubmit={submit} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField label="Device code" autoComplete="off" autoCapitalize="characters" value={code}
          onChange={(e) => setCode(e.target.value)} slotProps={{ htmlInput: { style: { letterSpacing: 2, fontSize: 20 } } }} />
        <Button type="submit" variant="contained" size="large" disabled={busy || !code.trim()}>Connect this device</Button>
      </Box>
      <Typography variant="body2" sx={{ mt: 3 }}>
        <Link component={RouterLink} to="/signin">Sign in with email instead</Link>
      </Typography>
    </Box>
  );
}
