/** Admin: group name, members and roles, and one-time codes for shared devices. */
import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, FormControlLabel, MenuItem, Paper, Switch, TextField, Typography,
} from '@mui/material';
import { Autocomplete } from '@mui/material';
import api from '../api';
import { useAuth } from '../auth/AuthContext';
import { apiErrorMessage } from '../apiError';
import { formatWhen, formatTime } from '../time';

const browserZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };
const ZONES = (() => { try { return Intl.supportedValuesOf('timeZone'); } catch { return []; } })();
const ROLES = ['member', 'editor', 'admin'];
const ROLE_HELP = 'Member: taste and log. Editor: also manage coffees and paper sheets. Admin: also manage the group.';

function GroupName({ group, onSaved }) {
  const { refresh } = useAuth();
  const [name, setName] = useState(group.name);
  const [zone, setZone] = useState(group.timezone);
  // A group still on the UTC default is offered the browser's zone, never applied unasked.
  const suggestion = group.timezone === 'UTC' && browserZone() !== 'UTC' && zone !== browserZone() ? browserZone() : null;
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const changed = name !== group.name || zone !== group.timezone;
  const save = async () => {
    setError(null); setSaved(false);
    const body = { name, ...(zone !== group.timezone ? { timezone: zone } : {}) };
    try {
      const res = await api.patch('/group', body);
      onSaved(res.data); setSaved(true);
    } catch (e) {
      const code = e.response?.data?.error;
      setError(code === 'bad_timezone' ? "That isn't a time zone the server knows. Pick one from the list." : apiErrorMessage(e, "Couldn't save the group."));
      return;
    }
    // The save worked; a failed session refresh only means the new zone shows after a reload.
    try { await refresh(); } catch { /* keep the success message */ }
  };
  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
      <Typography variant="h2" sx={{ fontSize: 18, mb: 1.5 }}>Group</Typography>
      {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
      {saved && <Alert severity="success" sx={{ mb: 1 }}>Saved.</Alert>}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <TextField label="Group name" size="small" sx={{ flex: 1, minWidth: 200 }} value={name} onChange={(e) => setName(e.target.value)} />
        <Autocomplete
          freeSolo size="small" sx={{ flex: 1, minWidth: 220 }} options={ZONES} value={zone}
          onChange={(_e, v) => setZone(v ?? '')} onInputChange={(_e, v) => setZone(v)}
          renderInput={(params) => <TextField {...params} label="Time zone" helperText={suggestion
            ? <>Times show in this zone. <Button size="small" onClick={() => setZone(suggestion)} sx={{ p: 0, minWidth: 0, textTransform: 'none' }}>Use {suggestion}</Button></>
            : 'Times on sheets and flights show in this zone.'} />}
        />
        <Button variant="contained" disabled={!name.trim() || !zone.trim() || !changed} onClick={save}>Save</Button>
      </Box>
    </Paper>
  );
}

function MemberRow({ member, onChange, onError }) {
  const patch = async (changes) => {
    try { const res = await api.patch(`/group/members/${member.id}`, changes); onChange(res.data); }
    catch (e) {
      const MESSAGES = {
        last_admin: 'A group needs at least one active admin.',
        member_linked: "This member has already signed in, so their email can't be changed here.",
        email_in_use: 'That email already belongs to another member.',
      };
      onError(MESSAGES[e.response?.data?.error] ?? apiErrorMessage(e, "Couldn't update that member."));
    }
  };
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', py: 1, borderTop: '1px solid', borderColor: 'divider', opacity: member.active ? 1 : 0.6 }}>
      <Box sx={{ flex: 1, minWidth: 160 }}>
        <Typography sx={{ fontWeight: 600 }}>{member.display_name}</Typography>
        <Typography variant="caption" color="text.secondary">
          {member.email || 'No email (roster only)'}{member.email && !member.signed_up ? ' · not signed in yet' : ''}
        </Typography>
      </Box>
      <TextField select size="small" label="Role" value={member.role} onChange={(e) => patch({ role: e.target.value })} sx={{ width: 120 }}>
        {ROLES.map((r) => <MenuItem key={r} value={r}>{r}</MenuItem>)}
      </TextField>
      <FormControlLabel control={<Switch checked={member.active} onChange={(e) => patch({ active: e.target.checked })} />} label="Active" />
    </Box>
  );
}

function Members() {
  const [members, setMembers] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ display_name: '', email: '', role: 'member' });
  const load = useCallback(() => api.get('/group/members').then((r) => setMembers(r.data))
    .catch((e) => setError(apiErrorMessage(e, "Couldn't load members."))), []);
  useEffect(() => { load(); }, [load]);

  const replace = (m) => setMembers((list) => list.map((x) => (x.id === m.id ? m : x)));
  const add = async (ev) => {
    ev.preventDefault();
    setError(null);
    try {
      const body = { display_name: form.display_name.trim(), role: form.role, ...(form.email.trim() ? { email: form.email.trim() } : {}) };
      const res = await api.post('/group/members', body);
      setMembers((list) => [...list, res.data]);
      setForm({ display_name: '', email: '', role: 'member' });
    } catch (e) {
      setError(e.response?.data?.error === 'email_in_use' ? 'That email already belongs to a member.' : apiErrorMessage(e, "Couldn't add that member."));
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
      <Typography variant="h2" sx={{ fontSize: 18, mb: 0.5 }}>Members</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {ROLE_HELP} A member with no email can still be picked on a shared device.
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError(null)}>{error}</Alert>}
      {!members && <CircularProgress size={24} />}
      {members?.map((m) => <MemberRow key={m.id} member={m} onChange={replace} onError={setError} />)}
      <Box component="form" onSubmit={add} sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 2, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
        <TextField label="Name" size="small" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
        <TextField label="Email (optional)" size="small" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <TextField select size="small" label="New role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} sx={{ width: 120 }}>
          {ROLES.map((r) => <MenuItem key={r} value={r}>{r}</MenuItem>)}
        </TextField>
        <Button type="submit" variant="contained" disabled={!form.display_name.trim()}>Add member</Button>
      </Box>
    </Paper>
  );
}

const codeStatus = (c) => {
  if (c.revoked_at) return 'revoked';
  if (new Date(`${c.expires_at}Z`) < new Date() && !c.used_at) return 'expired';
  if (c.used_at) return `used · ${c.active_sessions} active`;
  return 'waiting';
};

function DeviceCodes() {
  const [codes, setCodes] = useState(null);
  const [fresh, setFresh] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(() => api.get('/group/device-codes').then((r) => setCodes(r.data))
    .catch((e) => setError(apiErrorMessage(e, "Couldn't load device codes."))), []);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    setError(null);
    try { const res = await api.post('/group/device-codes'); setFresh(res.data); await load(); }
    catch (e) { setError(apiErrorMessage(e, "Couldn't make a code.")); }
  };
  const revoke = async (id) => {
    setError(null);
    try { await api.delete(`/group/device-codes/${id}`); setFresh((f) => (f?.id === id ? null : f)); await load(); }
    catch (e) { setError(apiErrorMessage(e, "Couldn't revoke that code.")); }
  };

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="h2" sx={{ fontSize: 18, mb: 0.5 }}>Shared devices</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        A code connects one tablet, once. Revoking a code also signs that tablet out.
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
      {fresh && (
        <Alert severity="success" sx={{ mb: 1.5 }} data-testid="fresh-code">
          Enter this code on the device. It is shown only now:
          <Typography component="div" sx={{ fontSize: 28, letterSpacing: 4, fontWeight: 700, my: 0.5 }}>{fresh.code}</Typography>
          Expires {formatWhen(fresh.expires_at)} at {formatTime(fresh.expires_at)}.
        </Alert>
      )}
      <Button variant="contained" onClick={create}>Make a device code</Button>
      {codes?.map((c) => (
        <Box key={c.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1, mt: 1, borderTop: '1px solid', borderColor: 'divider' }}>
          <Typography sx={{ flex: 1 }}>Made {formatWhen(c.created_at)} at {formatTime(c.created_at)}</Typography>
          <Chip size="small" label={codeStatus(c)} />
          {!c.revoked_at && <Button size="small" color="error" onClick={() => revoke(c.id)}>Revoke</Button>}
        </Box>
      ))}
    </Paper>
  );
}

export default function GroupSettingsPage() {
  const [group, setGroup] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    api.get('/group').then((r) => setGroup(r.data)).catch((e) => setError(apiErrorMessage(e, "Couldn't load the group.")));
  }, []);
  return (
    <Box sx={{ maxWidth: 720, mx: 'auto', p: 2 }}>
      <Typography variant="h1" sx={{ fontSize: 24, mb: 2 }}>Group settings</Typography>
      {error && <Alert severity="error">{error}</Alert>}
      {!group && !error && <CircularProgress />}
      {group && <GroupName group={group} onSaved={setGroup} />}
      {group && <Members />}
      {group && <DeviceCodes />}
    </Box>
  );
}
