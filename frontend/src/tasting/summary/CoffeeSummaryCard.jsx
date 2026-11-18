/**
 * One coffee's summary card, collapsed by default. Three bodies: the full card
 * (spread axes, terms, defects, D/Q, and — for a named viewer — every read), a
 * withheld coffee ("Not enough reads yet") and an unscored one.
 */
import { Box, Chip, Collapse, IconButton, Typography } from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import Card from '../bits/Card';
import SpreadAxis from './SpreadAxis';
import { VoteBar } from './RankingTable';
import { BAR_VOTE_LABELS, ADV_CATEGORIES, ADV_GUIDANCE } from '../content';
import { labelOf, tintOf } from '../lexicon';

const dqText = (d, named) => {
  const label = ADV_GUIDANCE[d.category]?.label ?? d.category;
  return named ? `D/Q by ${d.by} (${label})` : `D/Q: ${label.toLowerCase()} ×${d.count}`;
};

function Read({ r, onRemovePaper }) {
  return (
    <Box sx={{ py: 1, borderTop: '1px solid', borderColor: 'divider' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Typography sx={{ fontWeight: 600 }}>{r.taster_name}</Typography>
        {r.created_via === 'paper' && <Chip size="small" label="paper" variant="outlined" />}
        {r.created_via === 'paper' && onRemovePaper && (
          <IconButton size="small" aria-label={`Remove ${r.taster_name}'s paper read`} onClick={() => onRemovePaper(r)} sx={{ minWidth: 44, minHeight: 44 }}>
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        )}
        <Typography sx={{ ml: 'auto' }}>{r.total == null ? '—' : r.total.toFixed(1)}</Typography>
        {r.bar_vote && <Chip size="small" label={BAR_VOTE_LABELS[r.bar_vote] ?? r.bar_vote} />}
      </Box>
      {r.terms.length > 0 && <Typography variant="caption" color="text.secondary">{r.terms.join(', ')}</Typography>}
      {r.note && <Typography variant="body2">{r.note}</Typography>}
    </Box>
  );
}

// A non-named viewer never sees the table's reads, but always sees their own.
function YourRead({ yours }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">Your read</Typography>
      <Read r={{ ...yours, taster_name: 'You', terms: yours.terms ?? [] }} />
    </Box>
  );
}

function Body({ coffee, named, yours, onRemovePaper }) {
  const own = !named && yours ? <YourRead yours={yours} /> : null;
  if (coffee.n === 0 || coffee.avg_total === null) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Typography color="text.secondary">
          {coffee.n === 0 ? 'Nobody scored this cup' : `Not enough reads yet (${coffee.n})`}
        </Typography>
        {own}
      </Box>
    );
  }
  const defects = Object.entries(coffee.defects);
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {coffee.votes && <VoteBar votes={coffee.votes} />}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        {ADV_CATEGORIES.filter((cat) => coffee.categories[cat]).map((cat) => (
          <SpreadAxis key={cat} cat={cat} stat={coffee.categories[cat]} you={named ? null : yours?.scores?.[cat] ?? null} />
        ))}
      </Box>
      {(coffee.top_terms.length > 0 || defects.length > 0 || coffee.dq.length > 0) && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
          {coffee.top_terms.map((t) => (
            <Chip key={t.term} size="small" label={`${t.label} ${t.pct}%`} sx={{ outline: `2px solid ${tintOf(t.term)}`, outlineOffset: -2 }} />
          ))}
          {defects.map(([term, count]) => <Chip key={term} size="small" variant="outlined" label={`${labelOf(term)} ×${count}`} />)}
          {coffee.dq.map((d, i) => <Chip key={i} size="small" color="error" variant="outlined" label={dqText(d, named)} />)}
        </Box>
      )}
      {named && coffee.reads?.length > 0 && <Box>{coffee.reads.map((r) => <Read key={r.taster_key} r={r} onRemovePaper={onRemovePaper} />)}</Box>}
      {own}
    </Box>
  );
}

export default function CoffeeSummaryCard({ coffee, named, yours, open, onToggle, onRemovePaper }) {
  return (
    <Card outlined id={`cup-card-${coffee.coffee_id}`} sx={{ p: 0 }}>
      <Box
        component="button"
        type="button"
        aria-expanded={open}
        aria-label={`${coffee.name} card`}
        onClick={() => onToggle(coffee.coffee_id)}
        sx={{
          all: 'unset', boxSizing: 'border-box', width: '100%', minHeight: 52, px: 2, display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer',
          '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' },
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography noWrap sx={{ fontWeight: 600 }}>{coffee.name}</Typography>
          <Typography variant="caption" color="text.secondary">{coffee.roaster}</Typography>
        </Box>
        <ExpandMoreIcon sx={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }} />
      </Box>
      <Collapse in={open} unmountOnExit>
        <Box sx={{ px: 2, pb: 2 }}><Body coffee={coffee} named={named} yours={yours} onRemovePaper={onRemovePaper} /></Box>
      </Collapse>
    </Card>
  );
}
