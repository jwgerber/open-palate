import { lazy, Suspense, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate, Link as RouterLink } from 'react-router-dom';
import {
  AppBar, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Toolbar, Typography, Alert,
} from '@mui/material';
import { useAuth } from './auth/AuthContext';
import SignInPage from './auth/SignInPage';
import DeviceCodePage from './auth/DeviceCodePage';
import SetupPage from './auth/SetupPage';
import { useContent } from './tasting/useContent';
import api, { getLastKind } from './api';
import { forgetLocalState } from './tasting/forgetLocalState';
import ColorModeButton from './ColorModeButton';

const TastingPage = lazy(() => import('./tasting/TastingPage'));
const GroupSettingsPage = lazy(() => import('./admin/GroupSettingsPage'));

const Centered = ({ children }) => <Box sx={{ display: 'flex', justifyContent: 'center', pt: 10 }}>{children}</Box>;
const Spinner = () => <Centered><CircularProgress /></Centered>;

/** Installs the wheel and sheet wording before any Tasting component loads. */
function ContentGate({ children }) {
  const { ready, error } = useContent();
  if (error) return <Alert severity="error" sx={{ m: 2 }}>Couldn't load the app's content. Reload to try again.</Alert>;
  return ready ? children : <Spinner />;
}

function Shell({ children }) {
  const { kind, role, refresh } = useAuth();
  const navigate = useNavigate();
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const isDevice = kind === 'device';
  const signOut = async () => {
    setConfirmingDisconnect(false);
    try { await api.post('/auth/logout'); } finally {
      forgetLocalState();
      await refresh();
      navigate(isDevice ? '/device' : '/signin', { replace: true });
    }
  };
  return (
    <>
      <AppBar position="static" color="default" elevation={0} sx={{ borderBottom: '1px solid', borderColor: 'divider', mb: 2 }}>
        <Toolbar variant="dense" sx={{ gap: 1 }}>
          <Typography component={RouterLink} to="/" sx={{ fontWeight: 700, flex: 1, color: 'inherit', textDecoration: 'none' }}>Open Palate</Typography>
          <ColorModeButton />
          {kind === 'user' && role === 'admin' && <Button component={RouterLink} to="/admin" size="small">Group settings</Button>}
          <Button size="small" onClick={isDevice ? () => setConfirmingDisconnect(true) : signOut}>{isDevice ? 'Disconnect' : 'Sign out'}</Button>
        </Toolbar>
      </AppBar>
      <Box sx={{ px: 2 }}>{children}</Box>
      <Dialog open={confirmingDisconnect} onClose={() => setConfirmingDisconnect(false)}>
        <DialogTitle>Disconnect this device?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            To connect it again, a group admin will need to make a new device code.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmingDisconnect(false)}>Cancel</Button>
          <Button color="error" onClick={signOut}>Disconnect</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

function NoGroup() {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const signOut = async () => {
    try { await api.post('/auth/logout'); } finally { forgetLocalState(); await refresh(); navigate('/signin', { replace: true }); }
  };
  return (
    <Centered>
      <Box sx={{ maxWidth: 420, p: 2, textAlign: 'center' }} data-testid="no-group">
        <Typography variant="h1" sx={{ fontSize: 24, mb: 1 }}>You're not in a group yet</Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>Ask your café's admin to add your email, then sign in again.</Typography>
        <Button onClick={signOut}>Sign out</Button>
      </Box>
    </Centered>
  );
}

/** Shown when the server can't be reached: the session is unknown, not ended. */
function Unreachable() {
  const { refresh } = useAuth();
  const [retrying, setRetrying] = useState(false);
  const retry = async () => { setRetrying(true); try { await refresh(); } finally { setRetrying(false); } };
  return (
    <Centered>
      <Box sx={{ maxWidth: 420, p: 2, textAlign: 'center' }} data-testid="unreachable">
        <Typography variant="h1" sx={{ fontSize: 24, mb: 1 }}>Can't reach the server</Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>Check the connection, then try again.</Typography>
        <Button variant="contained" onClick={retry} disabled={retrying}>Retry</Button>
      </Box>
    </Centered>
  );
}

function Protected({ adminOnly = false, children }) {
  const { kind, role, group, loading, error } = useAuth();
  if (loading) return <Spinner />;
  if (error) return <Unreachable />;
  if (!kind) return <Navigate to={getLastKind() === 'device' ? '/device' : '/signin'} replace />;
  if (kind === 'user' && !group) return <NoGroup />;
  if (adminOnly && !(kind === 'user' && role === 'admin')) return <Navigate to="/" replace />;
  return <Shell>{children}</Shell>;
}

export default function App() {
  const { loading, setup } = useAuth();
  const { pathname } = useLocation();
  if (loading) return <Spinner />;
  if (setup?.needed && pathname !== '/setup') return <Navigate to="/setup" replace />;
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="/signin" element={<SignInPage />} />
        <Route path="/device" element={<DeviceCodePage />} />
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/admin" element={<Protected adminOnly><GroupSettingsPage /></Protected>} />
        <Route path="/*" element={<Protected><ContentGate><TastingPage /></ContentGate></Protected>} />
      </Routes>
    </Suspense>
  );
}
