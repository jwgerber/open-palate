/** First-run setup: the one-time link printed by the server makes the first admin. */
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Box, Button, TextField, Typography } from '@mui/material';
import api from '../api';
import { useAuth } from './AuthContext';

export default function SetupPage() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [params] = useSearchParams();
  const token = params.get('token');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (ev) => {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/setup', { token, email: email.trim(), display_name: name.trim() });
      await refresh();
      navigate('/', { replace: true });
    } catch (err) {
      const code = err.response?.data?.error;
      if (err.response?.status === 409) setError('This group has already been set up. Sign in instead.');
      else if (code === 'invalid_token') setError('This setup link is not valid. Use the link printed by the server.');
      else setError(typeof code === 'string' ? code : "Couldn't finish setup. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box component="main" sx={{ maxWidth: 400, mx: 'auto', p: 3, pt: 8 }}>
      <Typography variant="h1" sx={{ fontSize: 28, mb: 1 }}>Set up Open Palate</Typography>
      {!token && <Alert severity="error">Open the setup link the server printed; this page needs its token.</Alert>}
      <Typography color="text.secondary" sx={{ mb: 3 }}>Create the first admin account for your group.</Typography>
      <Box component="form" onSubmit={submit} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField label="Your name" value={name} onChange={(e) => setName(e.target.value)} />
        <TextField label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Button type="submit" variant="contained" size="large" disabled={busy || !token || !name.trim() || !email.trim()}>Create the first admin</Button>
      </Box>
    </Box>
  );
}
