/** Admin: copy a one-time sign-in link for a member (or your own row), for people without working email. */
import { useId, useRef, useState } from 'react';
import { Box, Button, TextField, Typography } from '@mui/material';
import api from '../api';
import { apiErrorMessage } from '../apiError';

const LINK_ERRORS = {
  other_group: 'This email belongs to someone in another group.',
  not_linked: "Couldn't link this person's account.",
  manager_member: 'Admins and editors sign in by email.',
};

function pointsAtLocalhost(link) {
  try { return ['localhost', '127.0.0.1'].includes(new URL(link).hostname); }
  catch { return false; }
}

export default function CopySigninLink({ member, isSelf, onError }) {
  // The link lives in this state only: never stored, never logged. It is set only when the clipboard refuses.
  const [fallbackLink, setFallbackLink] = useState(null);
  const [copied, setCopied] = useState(false);
  const [linkBusy, setLinkBusy] = useState(false);
  const [localhostLink, setLocalhostLink] = useState(false);
  // A ref, not state: two clicks can land before the first re-render.
  const inFlight = useRef(false);
  const emailHintId = useId();

  const copyLink = async () => {
    // Each request supersedes the last link, so a second click while one is pending would kill the first.
    if (inFlight.current) return;
    inFlight.current = true;
    setLinkBusy(true);
    setCopied(false); setFallbackLink(null); setLocalhostLink(false);
    try {
      let link;
      try {
        link = (await api.post(`/group/members/${member.id}/signin-link`)).data.link;
      } catch (e) {
        onError(LINK_ERRORS[e.response?.data?.error] ?? apiErrorMessage(e, "Couldn't make a sign-in link."));
        return;
      }
      setLocalhostLink(pointsAtLocalhost(link));
      try { await navigator.clipboard.writeText(link); setCopied(true); }
      catch { setFallbackLink(link); }
    } finally {
      inFlight.current = false;
      setLinkBusy(false);
    }
  };

  // The server refuses links for other admins and editors; don't offer what it will refuse.
  const isManager = member.role === 'admin' || member.role === 'editor';
  if (!member.active || (isManager && !isSelf)) return null;
  return (
    <Box sx={{ flexBasis: '100%' }}>
      <Button size="small" onClick={copyLink} disabled={!member.email || linkBusy} aria-describedby={member.email ? undefined : emailHintId}>Copy sign-in link</Button>
      {!member.email && <Typography id={emailHintId} component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>Add an email first</Typography>}
      <span aria-live="polite">
        {copied && <Typography component="span" variant="caption" color="success.main" sx={{ ml: 1 }}>Copied. Works once, for 24 hours.</Typography>}
      </span>
      {localhostLink && (
        <Typography variant="caption" color="warning.main" sx={{ display: 'block' }}>
          This link points at localhost. Set BASE_URL to your server's address so it works on other devices.
        </Typography>
      )}
      {fallbackLink && (
        <TextField
          size="small" fullWidth value={fallbackLink} onFocus={(e) => e.target.select()}
          slotProps={{ htmlInput: { readOnly: true, 'aria-label': 'Sign-in link' } }}
          helperText="Copy it from here. Works once, for 24 hours."
          sx={{ mt: 0.5 }}
        />
      )}
    </Box>
  );
}
