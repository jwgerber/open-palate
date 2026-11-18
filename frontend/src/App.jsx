import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useNavigate, Link as RouterLink } from 'react-router-dom';
import { AppBar, Box, Button, CircularProgress, Toolbar, Typography, Alert } from '@mui/material';
import { useAuth } from './auth/AuthContext';
import SignInPage from './auth/SignInPage';
import DeviceCodePage from './auth/DeviceCodePage';
import SetupPage from './auth/SetupPage';
import { useContent } from './tasting/useContent';
import api from './api';

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
  const signOut = async () => {
    try { await api.post('/auth/logout'); } finally {
      await refresh();
      navigate(kind === 'device' ? '/device' : '/signin', { replace: true });
    }
  };
  return (
    <>
      <AppBar position="static" color="default" elevation={0} sx={{ borderBottom: '1px solid', borderColor: 'divider', mb: 2 }}>
        <Toolbar variant="dense" sx={{ gap: 1 }}>
          <Typography component={RouterLink} to="/" sx={{ fontWeight: 700, flex: 1, color: 'inherit', textDecoration: 'none' }}>Open Palate</Typography>
          {kind === 'user' && role === 'admin' && <Button component={RouterLink} to="/admin" size="small">Group settings</Button>}
          <Button size="small" onClick={signOut}>{kind === 'device' ? 'Disconnect' : 'Sign out'}</Button>
        </Toolbar>
      </AppBar>
      <Box sx={{ px: 2 }}>{children}</Box>
    </>
  );
}

function NoGroup() {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const signOut = async () => { try { await api.post('/auth/logout'); } finally { await refresh(); navigate('/signin', { replace: true }); } };
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

function Protected({ adminOnly = false, children }) {
  const { kind, role, group, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!kind) return <Navigate to="/signin" replace />;
  if (kind === 'user' && !group) return <NoGroup />;
  if (adminOnly && !(kind === 'user' && role === 'admin')) return <Navigate to="/" replace />;
  return <Shell>{children}</Shell>;
}

export default function App() {
  const { loading } = useAuth();
  if (loading) return <Spinner />;
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
