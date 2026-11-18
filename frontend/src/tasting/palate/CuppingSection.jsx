/**
 * Cuppings on My palate: lean against the room per Advanced category, bar votes, and
 * one row per coffee per flight. Totals (75-100) live on their own scale and are
 * never combined with the basic 1-5 stars.
 */
import { useNavigate } from 'react-router-dom';
import { Box, Typography } from '@mui/material';
import Eyebrow from '../bits/Eyebrow';
import Card from '../bits/Card';
import VoteBar from '../bits/VoteBar';
import YouVsRoom from '../bits/YouVsRoom';
import CategoryLean from './CategoryLean';
import { PalateRow, ShortLine } from './palateRows';
import { cupDate } from './cupDate';

export default function CuppingSection({ cupping }) {
  const navigate = useNavigate();
  const { reads, open_reads: openReads, lean, votes, room_yes_share: yesShare, cups } = cupping;
  if (!reads) {
    return <ShortLine>{openReads > 0 ? 'Your cupping scores show here once the cupping closes.' : 'No cuppings yet.'}</ShortLine>;
  }
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Card>
        <Eyebrow sx={{ mb: 1 }}>Compared with the room</Eyebrow>
        {Object.keys(lean).length ? (
          <CategoryLean lean={lean} />
        ) : (
          <Typography variant="body2" color="text.secondary">Not enough other cuppers on your coffees to compare yet.</Typography>
        )}
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          Right of the line means you scored higher than the others on the same coffee. Context, not a grade.
        </Typography>
      </Card>
      <Card>
        <Eyebrow sx={{ mb: 1 }}>On bar? Your votes</Eyebrow>
        <VoteBar votes={votes} />
        {yesShare != null && (
          <Typography variant="body2" sx={{ mt: 1 }}>The room voted yes {Math.round(yesShare * 100)}% of the time on the coffees it could compare.</Typography>
        )}
      </Card>
      <Box>
        <Eyebrow sx={{ mb: 1 }}>Coffees you cupped</Eyebrow>
        <Card sx={{ p: 0 }}>
          {cups.map((c, i) => (
            <PalateRow
              key={`${c.coffee_id}-${c.flight_id}`}
              first={i === 0}
              onClick={() => navigate(`/coffees/${c.coffee_id}`)}
              title={c.name}
              meta={[c.roaster, cupDate(c.date)].filter(Boolean).join(' · ')}
              score={c.total.toFixed(1)}
              scoreLabel={c.room_total == null ? '—' : `room ${c.room_total.toFixed(1)}`}
              data-testid={`palate-cup-${c.coffee_id}-${c.flight_id}`}
            >
              <YouVsRoom you={c.total} room={c.room_total} min={75} max={100} />
            </PalateRow>
          ))}
        </Card>
      </Box>
    </Box>
  );
}
