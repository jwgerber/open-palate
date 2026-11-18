/**
 * Host setup for a Advanced cupping, before the timer: the grams
 * calculator and the table checklist. Ticks and the grams inputs
 * are component state — nothing is saved, and leaving the screen resets them.
 */
import { lazy, Suspense, useState } from 'react';
import { Box, Button, Checkbox, FormControlLabel, IconButton, Snackbar, TextField, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import Screen from '../../bits/Screen';
import Card from '../../bits/Card';
import Eyebrow from '../../bits/Eyebrow';
import Segments from '../../bits/Segments';
import LabelKeyCard from './LabelKeyCard';
import { gramsPerBowl, totalGrams } from './advancedTimer';
import { useTastingIdentity } from '../../useTastingIdentity';
import { mayEnterPaper } from '../../paper/mayEnterPaper';
import { sheetsLink } from '../../log/shareSupport';

const PaperEntryDialog = lazy(() => import('../../paper/PaperEntryDialog'));
const PrintSheetsDialog = lazy(() => import('../../print/PrintSheetsDialog'));

const PRESETS = [['150', '150'], ['180', '180'], ['200', '200']];
const MIN_BOWLS = 1;
const MAX_BOWLS = 6;

const CHECKLIST = [
  ['Purge the grinder with each sample before you grind it', ''],
  ['Weigh each bowl to ±0.1 g', ''],
  ['Water just off the boil, no smell', "Taste it if you're not sure."],
  ['Same fill pace every bowl', 'About 3 bowls a minute.'],
  ['Bowls clean, dry, no smell, room temperature', ''],
  ['Spoons, and a rinse cup of hot water', ''],
];

function GramsCard({ coffees }) {
  const [ml, setMl] = useState('180');
  const [bowls, setBowls] = useState(3);
  const mlNumber = Number(ml) || 0;
  return (
    <Card outlined sx={{ mt: 2 }}>
      <Eyebrow sx={{ mb: 0.5 }}>Coffee per bowl</Eyebrow>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', mb: 1 }}>
        <TextField
          type="number" value={ml} onChange={(e) => setMl(e.target.value)} size="small" sx={{ width: 96 }}
          slotProps={{ htmlInput: { 'aria-label': 'Bowl size (ml)', min: 150, max: 200, inputMode: 'numeric', style: { fontSize: 16 } } }}
        />
        <Segments ariaLabel="Bowl size presets" options={PRESETS} value={ml} onChange={setMl} dense />
      </Box>
      <Typography><b>{gramsPerBowl(mlNumber)} g</b> coffee per bowl at 55 g/L</Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1.5 }}>
        <Typography sx={{ flex: 1 }}>Bowls per coffee</Typography>
        <IconButton aria-label="Fewer bowls" disabled={bowls <= MIN_BOWLS} onClick={() => setBowls((b) => b - 1)}><RemoveIcon /></IconButton>
        <Typography component="span" sx={{ minWidth: 20, textAlign: 'center', fontWeight: 700 }}>{bowls}</Typography>
        <IconButton aria-label="More bowls" disabled={bowls >= MAX_BOWLS} onClick={() => setBowls((b) => b + 1)}><AddIcon /></IconButton>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        {coffees} coffees × {bowls} bowls = {coffees * bowls} bowls · <b>{totalGrams(mlNumber, bowls, coffees)} g</b> in all.
        {' '}Advanced: 2–6 bowls each; 1 is fine for a roast check.
      </Typography>
    </Card>
  );
}

export default function HostSetupScreen({ flight, onBack, onOpenTimer, memberId, onFlightEdited }) {
  const identity = useTastingIdentity();
  const { isSharedDevice } = identity;
  const [enteringPaper, setEnteringPaper] = useState(false);
  const [savedName, setSavedName] = useState('');
  const [savedOpen, setSavedOpen] = useState(false);   // separate flag: the name stays while the toast fades
  const [ticked, setTicked] = useState({});
  const [printing, setPrinting] = useState(false);
  const coffees = flight.cups?.length ?? 0;
  // The server is the authority; this only hides a control it would refuse.
  const mayKey = !!flight.is_host && !!flight.is_blind && !isSharedDevice;
  const meta = [`${coffees} coffees`, flight.is_blind ? 'blind' : null, `${flight.logged_count ?? 0} logged`].filter(Boolean).join(' · ');

  return (
    <Screen
      title="Set up the table"
      onBack={onBack}
      footer={(
        <>
          {!flight.is_open && <Typography align="center" color="text.secondary">This cupping is closed.</Typography>}
          <Button variant="contained" size="large" fullWidth disabled={!flight.is_open} onClick={onOpenTimer} sx={{ minHeight: 52 }}>Open the timer</Button>
          {flight.is_open && (isSharedDevice
            // A shared device is locked with no deep links; a new tab there could open without its session.
            ? <Button variant="outlined" size="large" fullWidth onClick={() => setPrinting(true)} sx={{ minHeight: 48 }}>Print sheets</Button>
            : <Button variant="outlined" size="large" fullWidth component="a" href={sheetsLink(flight.id)} target="_blank" rel="noopener" sx={{ minHeight: 48 }}>Print sheets</Button>)}
          {mayEnterPaper(flight, identity) && <Button variant="outlined" size="large" fullWidth onClick={() => setEnteringPaper(true)} sx={{ minHeight: 48 }}>Enter a paper sheet</Button>}
          <Typography variant="caption" color="text.secondary" align="center">Fragrance comes first — smell the dry grounds before you pour.</Typography>
        </>
      )}
    >
      <Eyebrow sx={{ pt: 2 }}>{flight.name || 'Cupping'}</Eyebrow>
      <Typography variant="body2" color="text.secondary">{meta}</Typography>
      <GramsCard coffees={coffees} />
      <Box sx={{ mt: 2 }}>
        {CHECKLIST.map(([label, hint]) => (
          <Box key={label} sx={{ borderBottom: '1px solid', borderColor: 'divider', py: 0.5 }}>
            <FormControlLabel
              sx={{ m: 0, minHeight: 44, width: '100%' }}
              control={<Checkbox checked={!!ticked[label]} onChange={(e) => setTicked((t) => ({ ...t, [label]: e.target.checked }))} />}
              label={<Typography>{label}</Typography>}
            />
            {hint && <Typography variant="body2" color="text.secondary" sx={{ pl: 4.5, mt: -0.5, pb: 0.5 }}>{hint}</Typography>}
          </Box>
        ))}
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>Ticks stay on this screen only — nothing is saved.</Typography>
      </Box>
      {printing && (
        <Suspense fallback={null}>
          <PrintSheetsDialog open flight={flight} onClose={() => setPrinting(false)} />
        </Suspense>
      )}
      {enteringPaper && (
        <Suspense fallback={null}>
          <PaperEntryDialog
            open flight={flight} memberId={memberId}
            onClose={() => setEnteringPaper(false)}
            onSaved={(r) => { setEnteringPaper(false); setSavedName(r.taster_name); setSavedOpen(true); }}
          />
        </Suspense>
      )}
      <Snackbar open={savedOpen} autoHideDuration={4000} onClose={() => setSavedOpen(false)} message={`Saved ${savedName}'s sheet`} />
      {mayKey && <LabelKeyCard flightId={flight.id} flightName={flight.name} memberId={memberId} flight={flight} onFlightEdited={onFlightEdited} />}
    </Screen>
  );
}
