/**
 * The session list on a coffee's page: filter pills (All / Cuppings / Basic), then
 * one card per shared session and one row per solo tasting, ten at a time.
 * A change to `reloadKey` (a delete elsewhere on the page) refetches from page 1.
 */
import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Chip, CircularProgress, Typography } from '@mui/material';
import { tastingApi } from '../../tastingApi';
import { apiErrorMessage } from '../../../apiError';
import Eyebrow from '../../bits/Eyebrow';
import SessionCard from './SessionCard';
import SoloRow from './SoloRow';

const PILLS = [['All', undefined], ['Cuppings', 'advanced'], ['Basic', 'basic']];

export default function CoffeeSessions({ coffeeId, onDeleteRead, canManage, isPerson, reloadKey = 0 }) {
  const [sheet, setSheet] = useState(undefined);
  const [sessions, setSessions] = useState([]);
  const [nextBefore, setNextBefore] = useState(null);
  const [moreLoading, setMoreLoading] = useState(false);
  // The request key whose page 1 last settled; loading is "the key has moved on".
  const [settledKey, setSettledKey] = useState(null);
  const [error, setError] = useState(null);
  const [retry, setRetry] = useState(0);
  const key = `${coffeeId}|${sheet ?? ''}|${reloadKey}|${retry}`;
  // A response for a superseded request (filter flipped, reload) must not land.
  const latest = useRef(0);

  useEffect(() => {
    const id = ++latest.current;
    tastingApi.getCoffeeSessions(coffeeId, { before: undefined, sheet })
      .then((page) => {
        if (id !== latest.current) return;
        setMoreLoading(false);
        setSessions(page.sessions);
        setNextBefore(page.next_before);
        setError(null);
        setSettledKey(key);
      })
      .catch((e) => {
        if (id !== latest.current) return;
        setMoreLoading(false);
        setSessions([]);
        setNextBefore(null);
        setError(apiErrorMessage(e, "Couldn't load the tastings."));
        setSettledKey(key);
      });
  }, [coffeeId, sheet, key]);

  const loadMore = () => {
    const id = ++latest.current;
    setMoreLoading(true);
    tastingApi.getCoffeeSessions(coffeeId, { before: nextBefore, sheet })
      .then((page) => {
        if (id !== latest.current) return;
        setSessions((prev) => [...prev, ...page.sessions]);
        setNextBefore(page.next_before);
      })
      .catch((e) => { if (id === latest.current) setError(apiErrorMessage(e, "Couldn't load the tastings.")); })
      .finally(() => { if (id === latest.current) setMoreLoading(false); });
  };

  const loading = settledKey !== key || moreLoading;

  return (
    <Box component="section" aria-label="Tastings" sx={{ mt: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1 }}>
        <Eyebrow sx={{ mr: 1 }}>Sessions</Eyebrow>
        {PILLS.map(([label, value]) => (
          <Chip
            key={label} component="button" label={label} clickable
            color={sheet === value ? 'primary' : 'default'} variant={sheet === value ? 'filled' : 'outlined'}
            aria-pressed={sheet === value}
            onClick={() => setSheet(value)}
            sx={{ minHeight: 36 }}
          />
        ))}
      </Box>
      {error && (
        <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => setRetry((n) => n + 1)}>Try again</Button>}>{error}</Alert>
      )}
      {!error && !loading && sessions.length === 0 && <Typography color="text.secondary" sx={{ py: 2 }}>No tastings yet.</Typography>}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {sessions.map((s) => (s.shared === false
          ? <SoloRow key={s.flight_id} session={s} onDeleteRead={onDeleteRead} canManage={canManage} isPerson={isPerson} />
          : <SessionCard key={s.flight_id} session={s} onDeleteRead={onDeleteRead} canManage={canManage} isPerson={isPerson} />))}
      </Box>
      {loading && <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}><CircularProgress size={24} aria-label="Loading tastings" /></Box>}
      {!loading && !error && nextBefore != null && (
        <Button fullWidth onClick={loadMore} sx={{ minHeight: 44, mt: 1 }}>Load more</Button>
      )}
    </Box>
  );
}
