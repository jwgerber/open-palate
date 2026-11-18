/**
 * `/print/sheets/:flightId` — the Advanced cupping sheets in their own browser tab,
 * outside the module's tab bar. `:flightId` is a flight id or `blank`. Only an OPEN
 * Advanced flight prints: a closed blind flight's cup `label` is the coffee name.
 */
import { useEffect, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { Alert, Box, Button, CircularProgress } from '@mui/material';
import { tastingApi } from '../tastingApi';
import { apiErrorMessage } from '../../apiError';
import PrintSheetsDialog from './PrintSheetsDialog';

const LOG_PATH = '/log';
const NOT_PRINTABLE = 'These sheets are only for an open Advanced cupping.';

function Notice({ message }) {
  return (
    <Box sx={{ maxWidth: 640, mx: 'auto', p: 2 }}>
      <Alert severity="error" sx={{ mb: 2 }}>{message}</Alert>
      <Button component={RouterLink} to={LOG_PATH} variant="outlined" sx={{ minHeight: 44 }}>Back to the log</Button>
    </Box>
  );
}

/** `state` is null while loading, else `{flight}` or `{error}`. */
function useSheetFlight(param) {
  const isBlank = param === 'blank';
  const id = /^\d+$/.test(param ?? '') ? Number(param) : null;
  const [loaded, setLoaded] = useState(null);

  useEffect(() => {
    if (id == null) return undefined;
    let live = true;
    tastingApi.getFlight(id)
      .then((flight) => { if (live) setLoaded({ id, flight }); })
      .catch((e) => { if (live) setLoaded({ id, error: apiErrorMessage(e, "Couldn't load the sheets.") }); });
    return () => { live = false; };
  }, [id]);

  if (isBlank) return { flight: null, ready: true };
  if (id == null) return { error: "That isn't a flight link." };
  return loaded?.id === id ? loaded : null;
}

export default function PrintSheetsPage() {
  const { flightId } = useParams();
  const navigate = useNavigate();
  const state = useSheetFlight(flightId);
  const flight = state?.flight;

  useEffect(() => {
    if (!flight?.name) return undefined;
    const previous = document.title;
    document.title = `Print sheets — ${flight.name}`;
    return () => { document.title = previous; };
  }, [flight?.name]);

  // A tab opened by a link can close itself; if the browser refuses, land on the log.
  const close = () => {
    window.close();
    navigate(LOG_PATH, { replace: true });
  };

  if (!state) return <Box sx={{ display: 'flex', justifyContent: 'center', pt: 8 }}><CircularProgress /></Box>;
  if (state.error) return <Notice message={state.error} />;
  if (flight && (!flight.is_open || flight.sheet !== 'advanced')) return <Notice message={NOT_PRINTABLE} />;
  return <PrintSheetsDialog open flight={flight} onClose={close} />;
}
