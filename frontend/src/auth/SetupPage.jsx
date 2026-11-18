/**
 * First-run setup: makes the first admin. Allowed when the server says setup is
 * `open` (it was reached from its own network, or SETUP_OPEN), with a valid
 * `?token=` setup link, or with the server's setup password. Nothing here is kept in
 * browser storage; the token and password live in the URL and in form state only.
 */
import { useState } from 'react';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Box, Button, Link, TextField, Typography } from '@mui/material';
import api from '../api';
import { useAuth } from './AuthContext';

const CLOSED_COPY = "Setup isn't open from here. Open the app on the server's own network, use the setup link printed in the server log, or set SETUP_PASSWORD. Trying it on your own computer with Docker? Set SETUP_OPEN=true.";

function Shell({ children }) {
  return (
    <Box component="main" sx={{ maxWidth: 400, mx: 'auto', p: 3, pt: 8 }}>
      <Typography variant="h1" sx={{ fontSize: 28, mb: 1 }}>Set up Open Palate</Typography>
      {children}
    </Box>
  );
}

export default function SetupPage() {
  const navigate = useNavigate();
  const { refresh, setup } = useAuth();
  const [params] = useSearchParams();
  const token = params.get('token');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [setupPassword, setSetupPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (setup && !setup.needed) {
    return (
      <Shell>
        <Typography sx={{ mb: 2 }}>Setup is already done.</Typography>
        <Link component={RouterLink} to="/signin">Sign in</Link>
      </Shell>
    );
  }

  // A valid link works whatever `open` says; the password field only helps without one.
  const showPassword = !token && !setup?.open && Boolean(setup?.password);
  const canSetup = Boolean(token) || Boolean(setup?.open) || showPassword;
  if (!canSetup) return <Shell><Alert severity="info">{CLOSED_COPY}</Alert></Shell>;

  const submit = async (ev) => {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    const body = { email: email.trim(), display_name: name.trim() };
    if (token) body.token = token;
    if (showPassword) body.setup_password = setupPassword;
    try {
      await api.post('/auth/setup', body);
      await refresh();
      navigate('/', { replace: true });
    } catch (err) {
      const code = err.response?.data?.error;
      if (err.response?.status === 409) setError('This group has already been set up. Sign in instead.');
      else if (err.response?.status === 429) setError('Too many attempts. Wait a minute and try again.');
      else if (code === 'invalid_token') {
        setError(showPassword
          ? "That setup password isn't right."
          : 'This setup link is not valid. Use the link printed by the server.');
      } else setError(typeof code === 'string' ? code : "Couldn't finish setup. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <Typography color="text.secondary" sx={{ mb: 3 }}>Create the first admin account for your group.</Typography>
      <Box component="form" onSubmit={submit} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField label="Your name" value={name} onChange={(e) => setName(e.target.value)} />
        <TextField label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        {showPassword && (
          <TextField label="Setup password" type="password" autoComplete="off" value={setupPassword} onChange={(e) => setSetupPassword(e.target.value)} />
        )}
        <Button type="submit" variant="contained" size="large" disabled={busy || !name.trim() || !email.trim() || (showPassword && !setupPassword)}>Create the first admin</Button>
      </Box>
    </Shell>
  );
}
