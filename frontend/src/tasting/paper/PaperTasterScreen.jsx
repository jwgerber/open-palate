/**
 * Whose sheet is this? — the first step of paper entry. The same roster tiles
 * as WhoScreen plus a guest name for a taster who is not a member.
 */
import { useEffect, useState } from 'react';
import { Alert, Box, Button, CircularProgress, TextField, Typography } from '@mui/material';
import Screen from '../bits/Screen';
import Eyebrow from '../bits/Eyebrow';
import PersonTile from '../bits/PersonTile';
import { tastingApi } from '../tastingApi';
import { apiErrorMessage } from '../../apiError';

const GRID_SX = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 1 };

export default function PaperTasterScreen({ onPick, onClose, onRoster, scanBlock, suggestion, warnings = [], locked = false }) {
  const [members, setMembers] = useState(null);
  const [error, setError] = useState(null);
  // null = untouched, so a scan that lands later can pre-fill without an effect.
  const [typedGuest, setTypedGuest] = useState(null);
  const guest = typedGuest ?? suggestion?.guestName ?? '';
  useEffect(() => {
    let live = true;
    tastingApi.getMembers()
      .then((d) => { if (live) { setMembers(d); setError(null); onRoster?.(d); } })
      .catch((e) => { if (live) { setMembers(null); setError(apiErrorMessage(e, "Couldn't load the roster.")); } });
    return () => { live = false; };
  }, [onRoster]);

  const guestName = guest.trim();
  const pickPerson = (p) => onPick({ memberId: p.id, name: p.name });

  return (
    <Screen title="Whose sheet is this?" onClose={onClose} bodySx={{ pt: 2 }}>
      {scanBlock && (
        <>
          <Eyebrow sx={{ mb: 1 }}>Scan the sheet</Eyebrow>
          {scanBlock}
        </>
      )}
      {warnings.map((w, i) => <Alert key={`${i}-${w}`} severity="info" sx={{ mb: 1 }}>{w}</Alert>)}
      {suggestion && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 3 }}>
          <Typography sx={{ flex: 1, minWidth: 0 }}>{`From the sheet: ${suggestion.readName}`}</Typography>
          {suggestion.memberId != null && (
            <Button variant="contained" disabled={locked} onClick={() => onPick({ memberId: suggestion.memberId, name: suggestion.name })} sx={{ minHeight: 48 }}>
              {`Use ${suggestion.name}`}
            </Button>
          )}
        </Box>
      )}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {!members && !error && <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>}
      {members && (
        <>
          <Eyebrow sx={{ mb: 1 }}>Members</Eyebrow>
          <Box sx={{ ...GRID_SX, mb: 3 }}>
            {members.map((p) => <PersonTile key={p.id} person={p} onPick={pickPerson} disabled={locked} />)}
          </Box>
        </>
      )}
      <Eyebrow sx={{ mb: 1 }}>Not on the roster</Eyebrow>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
        <TextField
          label="Someone else (guest)" value={guest} onChange={(ev) => setTypedGuest(ev.target.value)}
          size="small" fullWidth slotProps={{ htmlInput: { maxLength: 120 } }}
          helperText="Two guests with the same name? Add something to tell them apart, e.g. Sam R."
        />
        <Button variant="contained" disabled={!guestName || locked} onClick={() => onPick({ guestName, name: guestName })} sx={{ minHeight: 40, flexShrink: 0 }}>
          Use this name
        </Button>
      </Box>
    </Screen>
  );
}
