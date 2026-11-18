/**
 * Who's tasting? — shared device only. The tablet is signed in as the group, so
 * the flight needs a name: a grid of 64px tiles from the group's active
 * members. No PIN, ever.
 */
import { useEffect, useState } from 'react';
import { Box, CircularProgress, Typography, Alert } from '@mui/material';
import PersonTile from '../../bits/PersonTile';
import Screen from '../../bits/Screen';
import { tastingApi } from '../../tastingApi';
import { apiErrorMessage } from '../../../apiError';

export default function WhoScreen({ onPick, onClose }) {
  const [members, setMembers] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let live = true;
    tastingApi.getMembers()
      .then((d) => { if (live) { setMembers(d); setError(null); } })
      .catch((e) => { if (live) { setMembers(null); setError(apiErrorMessage(e, "Couldn't load the roster.")); } });
    return () => { live = false; };
  }, []);

  return (
    <Screen title="Who's tasting?" onClose={onClose} bodySx={{ pt: 2 }}>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {!members && !error && <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>}
      {members && members.length === 0 && (
        <Typography color="text.secondary">Nobody is on the roster yet. Ask an admin to add members.</Typography>
      )}
      {members && (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 1 }}>
          {members.map((p) => <PersonTile key={p.id} person={p} onPick={onPick} />)}
        </Box>
      )}
    </Screen>
  );
}
