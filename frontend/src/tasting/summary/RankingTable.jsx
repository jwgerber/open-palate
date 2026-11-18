/**
 * The ranking: rank, coffee (+ "was Cup B" once the blind is lifted), avg
 * total, a stacked Yes/Maybe/No bar with counts, and n. "Score" is the
 * server's order; "Vote" re-sorts by yes share. A withheld coffee (unnamed
 * viewer, n below the consensus threshold) has no average and no vote bar.
 */
import { memo, useMemo, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { visuallyHidden } from '@mui/utils';
import Segments from '../bits/Segments';

const GRID = '24px 1fr 52px 28px';

const SEGMENTS = [
  ['yes', (t) => t.palette.success.main],
  ['maybe', (t) => t.palette.warning.main],
  ['no', (t) => t.palette.grey[500]],
];

export function VoteBar({ votes }) {
  const total = votes.yes + votes.maybe + votes.no;
  const label = `${votes.yes} yes, ${votes.maybe} maybe, ${votes.no} no`;
  return (
    <Box role="img" aria-label={label} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Box sx={{ display: 'flex', flex: 1, height: 10, borderRadius: 5, overflow: 'hidden', bgcolor: (t) => alpha(t.palette.text.primary, 0.08) }}>
        {SEGMENTS.map(([key, color]) => votes[key] > 0 && (
          <Box key={key} sx={{ width: `${(votes[key] / total) * 100}%`, bgcolor: color }} />
        ))}
      </Box>
      <Typography variant="caption" color="text.secondary" aria-hidden sx={{ whiteSpace: 'nowrap' }}>
        {`${votes.yes} Yes · ${votes.maybe} Maybe · ${votes.no} No`}
      </Typography>
    </Box>
  );
}

const byYesShare = (a, b) => (b.yes_share ?? -1) - (a.yes_share ?? -1);

const Row = memo(function Row({ coffee, rank, onSelect }) {
  const hasVotes = coffee.votes && coffee.votes.yes + coffee.votes.maybe + coffee.votes.no > 0;
  return (
    <Box
      data-testid="rank-row"
      role="button"
      tabIndex={0}
      onClick={() => onSelect(coffee.coffee_id)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(coffee.coffee_id); } }}
      sx={{
        display: 'grid', gridTemplateColumns: GRID, gridTemplateRows: 'auto auto', columnGap: 1, rowGap: 0.5,
        alignItems: 'center', minHeight: 56, py: 1, px: 1, borderRadius: 1, cursor: 'pointer',
        '&:hover': { bgcolor: 'action.hover' }, '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' },
      }}
    >
      <Typography sx={{ fontWeight: 600, gridRow: '1 / 3' }}>{rank}</Typography>
      <Box sx={{ minWidth: 0 }}>
        <Typography data-testid="rank-name" noWrap sx={{ fontWeight: 600 }}>{coffee.name}</Typography>
        {coffee.blind_label && <Typography variant="caption" color="text.secondary">was {coffee.blind_label}</Typography>}
      </Box>
      <Typography sx={{ fontWeight: 600, textAlign: 'right' }}>{coffee.avg_total == null ? '—' : coffee.avg_total.toFixed(1)}</Typography>
      <Typography data-testid="rank-n" variant="caption" color="text.secondary" sx={{ textAlign: 'right' }}>{coffee.n}<span style={visuallyHidden}>{coffee.n === 1 ? ' read' : ' reads'}</span></Typography>
      <Box sx={{ gridColumn: '2 / 5' }}>{hasVotes && <VoteBar votes={coffee.votes} />}</Box>
    </Box>
  );
});

export default function RankingTable({ coffees, onSelect }) {
  const [sort, setSort] = useState('score');
  const rows = useMemo(() => (sort === 'vote' ? [...coffees].sort(byYesShare) : coffees), [coffees, sort]);
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 1 }}>
        <Typography variant="caption" color="text.secondary">Sort by</Typography>
        <Box sx={{ width: 180 }}>
          <Segments ariaLabel="Sort ranking" value={sort} onChange={setSort} options={[['score', 'Score'], ['vote', 'Vote']]} />
        </Box>
      </Box>
      <Box
        data-testid="rank-header"
        sx={{ display: 'grid', gridTemplateColumns: GRID, columnGap: 1, px: 1, pb: 0.5, borderBottom: '1px solid', borderColor: 'divider' }}
      >
        <Typography variant="caption" color="text.secondary">#</Typography>
        <Typography variant="caption" color="text.secondary">Coffee</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'right' }}>Avg</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'right' }}>n</Typography>
      </Box>
      {rows.map((c, i) => <Row key={c.coffee_id} coffee={c} rank={i + 1} onSelect={onSelect} />)}
    </Box>
  );
}
