/**
 * Coffees — every coffee the group has logged, in picker order (on bar · cupping lots ·
 * elsewhere): top-3 descriptors and average stars once a coffee has 3 basic
 * tastings, beside a separate cupping-score column (the scales never combine).
 * Filter chips are client-side; "Tasted by me" asks the server for `mine`.
 *
 * "+ Add a coffee" (row and FAB) opens the three-field form: "Add & taste it"
 * hands the new coffee to the Log tab (`/log?taste=<id>`), "Just add
 * it" opens its page.
 *
 * Editor or admin (`canManage`) also get Export CSV / Import CSV: export every coffee,
 * edit in a spreadsheet, re-import through a preview (`CoffeeImportDialog`).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, ButtonBase, Chip, CircularProgress, Dialog, Fab, Typography,
} from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import AddIcon from '@mui/icons-material/Add';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { tastingApi } from '../tastingApi';
import { apiErrorMessage } from '../../apiError';
import { CONSENSUS_THRESHOLD } from '../content';
import TermChip from '../entry/TermChip';
import AddCoffeeForm from '../log/screens/AddCoffeeForm';
import { ScreenHeader } from '../bits/Screen';
import Eyebrow from '../bits/Eyebrow';
import Card from '../bits/Card';
import SampleDataCard from '../bits/SampleDataCard';
import ToggleChip from '../bits/ToggleChip';
import { useTastingIdentity } from '../useTastingIdentity';
import { plural } from '../format';
import { sectionsFor } from './coffeeSupport';
import CoffeeImportDialog from './CoffeeImportDialog';

// Stars and Advanced cupping totals are different scales: two columns, never merged.
const COL_WIDTH = 48;
const COL_GAP = 0.5;
const CHEVRON = 24;
const ROW_PAD_X = 2;
const ROW_GAP = 1.5;

function ScoreCell({ value, kind }) {
  return (
    <Typography
      component="span"
      sx={{ width: COL_WIDTH, flexShrink: 0, textAlign: 'right', fontSize: 18, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: value == null ? 'text.disabled' : 'text.primary' }}
    >
      <Box component="span" sx={visuallyHidden}>{kind} </Box>
      {value == null ? (
        <>
          <span aria-hidden>—</span>
          <Box component="span" sx={visuallyHidden}>no score</Box>
        </>
      ) : <span>{value.toFixed(1)}</span>}
    </Typography>
  );
}

/** Column titles for a section, lined up with the cells of its rows. */
function ColumnHeadings() {
  return (
    <Box aria-hidden sx={(t) => ({ display: 'flex', gap: COL_GAP, flexShrink: 0, pr: `calc(${t.spacing(ROW_PAD_X)} + ${CHEVRON}px + ${t.spacing(ROW_GAP)})` })}>
      {['Stars', 'Cupping'].map((label) => (
        <Eyebrow key={label} sx={{ width: COL_WIDTH, textAlign: 'right', letterSpacing: 0, textTransform: 'none', fontSize: 12 }}>{label}</Eyebrow>
      ))}
    </Box>
  );
}

function thinHint(coffee) {
  if (coffee.n === 0) return 'not tasted yet';
  // No basic tastings (cupping-only, or a cupping still open): no consensus to wait for.
  if (coffee.basic_n === 0) return null;
  return `${plural(coffee.basic_n, 'tasting')} — consensus at ${CONSENSUS_THRESHOLD}`;
}

export function CoffeeRow({ coffee, onOpen, last }) {
  const thin = coffee.basic_n < CONSENSUS_THRESHOLD;
  const hint = thin ? thinHint(coffee) : null;
  return (
    <ButtonBase
      onClick={() => onOpen(coffee)}
      sx={{ width: '100%', display: 'flex', alignItems: 'center', gap: ROW_GAP, px: ROW_PAD_X, py: 1.5, minHeight: 72, textAlign: 'left', borderBottom: last ? 'none' : '1px solid', borderColor: 'divider' }}
      data-testid={`coffee-row-${coffee.id}`}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: 15, fontWeight: 600, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {coffee.name}
          {coffee.archived_at && <Chip label="archived" size="small" sx={{ ml: 1, height: 18, fontSize: 10 }} />}
        </Typography>
        {coffee.roaster && <Typography noWrap variant="caption" color="text.secondary" sx={{ display: 'block' }}>{coffee.roaster}</Typography>}
        {thin ? (
          hint && <Typography variant="caption" color="text.secondary">{hint}</Typography>
        ) : (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
            {coffee.top_terms.map((t) => <TermChip key={t.term} term={t.term} size="sm" />)}
          </Box>
        )}
      </Box>
      <Box sx={{ display: 'flex', gap: COL_GAP, flexShrink: 0 }}>
        <ScoreCell kind="Average stars" value={thin ? null : coffee.avg_overall} />
        <ScoreCell kind="Cupping score" value={coffee.cupping?.avg_total ?? null} />
      </Box>
      <ChevronRightIcon sx={{ color: 'text.disabled', flexShrink: 0 }} />
    </ButtonBase>
  );
}

export default function CoffeesTab() {
  const navigate = useNavigate();
  // `mine` asks the server to flag coffees THIS person tasted — only an account
  // that is a person has an identity to resolve; a shared device has none.
  const { isPerson, isSharedDevice, canManage } = useTastingIdentity();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');
  const [adding, setAdding] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [notice, setNotice] = useState(null);
  const fileInput = useRef(null);

  const load = useCallback(() => tastingApi.getCoffees({ mine: isPerson })
    .then((d) => { setData(d); setError(null); })
    .catch((e) => setError(apiErrorMessage(e, "Couldn't load coffees."))), [isPerson]);
  useEffect(() => { load(); }, [load]);

  const sections = useMemo(() => (data ? sectionsFor(data.coffees, { filter }) : []), [data, filter]);
  const chips = [
    ['all', 'All'],
    ...(data?.roasters || []).map((r) => [`roaster:${r}`, r]),
    ...(isPerson ? [['mine', 'Tasted by me']] : []),
  ];
  const open = (c) => navigate(`/coffees/${c.id}`);
  const exportCsv = () => tastingApi.downloadCoffeesCsv()
    .catch((e) => setError(apiErrorMessage(e, "Couldn't export coffees.")));
  const pickFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';  // picking the same file again must still fire onChange
    if (file) { setNotice(null); setImportFile(file); }
  };
  const applied = ({ created, updated, skipped = 0 }) => {
    setImportFile(null);
    setNotice(`Imported: ${created} new, ${updated} updated${skipped ? `, ${skipped} skipped` : ''}`);
    load();
  };

  return (
    <Box sx={{ pb: 10 }}>
      <Box sx={{ display: 'flex', gap: 1, overflowX: 'auto', pb: 1.5, mx: -0.5, px: 0.5, '&::-webkit-scrollbar': { display: 'none' } }} role="group" aria-label="Filter coffees">
        {chips.map(([value, label]) => (
          <ToggleChip key={value} label={label} on={filter === value} onClick={() => setFilter(value)} sx={{ flexShrink: 0 }} />
        ))}
      </Box>
      {canManage && (
        <Box sx={{ display: 'flex', gap: 1, mb: 1.5 }}>
          <Button size="small" variant="outlined" onClick={exportCsv}>Export CSV</Button>
          <Button size="small" variant="outlined" onClick={() => fileInput.current?.click()}>Import CSV</Button>
          <input ref={fileInput} type="file" accept=".csv,text/csv" hidden onChange={pickFile} data-testid="coffee-csv-input" />
        </Box>
      )}
      <Box sx={{ mb: 1.5 }}><SampleDataCard onLoaded={load} /></Box>
      {notice && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice(null)}>{notice}</Alert>}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {!data && !error && <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>}
      {data && sections.length === 0 && <Typography color="text.secondary" sx={{ py: 2 }}>No coffees here yet.</Typography>}
      {sections.map((s) => (
        <Box key={s.key} sx={{ mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 1, mb: 1 }}>
            <Eyebrow sx={{ minWidth: 0 }}>{s.label}</Eyebrow>
            <ColumnHeadings />
          </Box>
          <Card sx={{ p: 0 }}>
            {s.rows.map((c, i) => <CoffeeRow key={c.id} coffee={c} onOpen={open} last={i === s.rows.length - 1} />)}
          </Card>
        </Box>
      ))}
      <ButtonBase onClick={() => setAdding(true)} sx={{ minHeight: 48, gap: 1, px: 1, borderRadius: 2, color: 'primary.main', fontWeight: 600, fontSize: 15 }}>
        <AddIcon /> Add a coffee
      </ButtonBase>
      <Fab color="primary" aria-label="Add a coffee" onClick={() => setAdding(true)} sx={{ position: 'fixed', right: 20, bottom: 'calc(20px + env(safe-area-inset-bottom))', borderRadius: 4 }}>
        <AddIcon />
      </Fab>
      <Dialog open={adding} onClose={() => setAdding(false)} fullWidth maxWidth="sm" slotProps={{ paper: { 'aria-label': 'Add a coffee' } }}>
        <ScreenHeader title="Add a coffee" onClose={() => setAdding(false)} />
        <Box sx={{ p: 2 }}>
          <AddCoffeeForm
            mode="coffees" roasters={data?.roasters || []} allowTaste={!isSharedDevice}
            onUseExisting={(c) => { setAdding(false); open(c); }}
            onAdded={(c) => { setAdding(false); load(); open(c); }}
            onAddAndTaste={(c) => { setAdding(false); navigate(`/log?taste=${c.id}`); }}
          />
        </Box>
      </Dialog>
      {importFile && (
        <CoffeeImportDialog open file={importFile} onClose={() => setImportFile(null)} onApplied={applied} />
      )}
    </Box>
  );
}
