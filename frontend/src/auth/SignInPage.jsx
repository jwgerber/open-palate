/**
 * Email sign-in. The reply is the same whether or not the address is known, so
 * this page never reveals who has an account. When this copy can't send email
 * (the setup status the app loaded says so), it says where links go instead of
 * promising an email.
 */
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Alert, Box, Button, Link, TextField, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import api from '../api';
import { useAuth } from './AuthContext';

export default function SignInPage() {
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  // The app loads the setup status before any page renders; reuse it rather than
  // asking again. Unknown or failed keeps the usual wording.
  const { setup } = useAuth();
  const emailOff = setup?.email === false;

  const submit = async (ev) => {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/request-link', { email: email.trim() });
      setSent(true);
    } catch (err) {
      const status = err.response?.status;
      if (status === 429) setError('Too many requests. Wait a minute and try again.');
      else if (status === 400) setError('Enter a valid email address.');
      else setError("Couldn't send a link right now. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box component="main" sx={{ maxWidth: 400, mx: 'auto', p: 3, pt: 8 }}>
      <Typography variant="h1" sx={{ fontSize: 28, mb: 1 }}>Open Palate</Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        {emailOff
          ? "This copy of Open Palate can't send email. Staff: ask an admin to copy a sign-in link for you. Admins and editors: your link goes to the server log."
          : 'Sign in with your email. We send a one-time link.'}
      </Typography>
      {params.get('error') === 'expired' && (
        <Alert severity="warning" sx={{ mb: 2 }}>That sign-in link expired or was already used. Request a new one.</Alert>
      )}
      {sent ? (
        <Alert severity="success" data-testid="sent-note">
          {emailOff
            ? 'If that address is on the list, a sign-in link was written to the server log (on Render: Logs, search for "Sign-in link for"). It works once and expires in 15 minutes.'
            : 'If that address is on the list, a sign-in link is on its way. It works once and expires in 15 minutes.'}
        </Alert>
      ) : (
        <Box component="form" onSubmit={submit} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button type="submit" variant="contained" size="large" disabled={busy || !email.trim()}>Send sign-in link</Button>
        </Box>
      )}
      <Typography variant="body2" sx={{ mt: 3 }}>
        On a shared tablet? <Link component={RouterLink} to="/device">Enter a device code</Link>
      </Typography>
    </Box>
  );
}
