/**
 * Basic tastings on My palate — personal calibration from `created_via='account'`
 * reads only: the leave-one-out bias on a ±2 axis, the monthly gap to the group
 * (a falling line is a palate learning the house vocabulary), and the coffees
 * you've tasted with your average against theirs on a shared 1-5 scale.
 */
import { useNavigate } from 'react-router-dom';
import { Box, Typography } from '@mui/material';
import Eyebrow from '../bits/Eyebrow';
import Card from '../bits/Card';
import YouVsRoom from '../bits/YouVsRoom';
import { BigNumber } from '../bits/ConsensusHeadline';
import { plural } from '../format';
import { biasSentence, signed } from '../coffees/coffeeSupport';
import GapLine from './GapLine';
import { PalateRow, ShortLine } from './palateRows';

const monthLabel = (m) => new Date(`${m}-15T12:00:00`).toLocaleString('en-US', { month: 'short' });
const pct = (b) => `${((Math.max(-2, Math.min(2, b)) + 2) / 4) * 100}%`;

export default function BasicSection({ data }) {
  const navigate = useNavigate();
  if (!data.tastings) return <ShortLine>No basic tastings yet.</ShortLine>;
  const series = data.gap_series.map((p) => ({ month: monthLabel(p.month), gap: p.gap }));
  const hasGap = series.some((p) => p.gap != null);
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Typography variant="caption" color="text.secondary">
        {[plural(data.tastings, 'tasting'), plural(data.coffees, 'coffee'), plural(data.terms_used, 'term') + ' used', `${data.specific_terms} specific`].join(' · ')}
      </Typography>
      <Card>
        <Eyebrow>Calibration</Eyebrow>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5, mt: 0.5 }}>
          <BigNumber size={32} data-testid="bias">{signed(data.bias)}</BigNumber>
          <Typography>{biasSentence(data.bias)}</Typography>
        </Box>
        <Box sx={{ position: 'relative', height: 24, my: 1.5 }} aria-hidden>
          <Box sx={{ position: 'absolute', left: 0, right: 0, top: 11, height: 2, bgcolor: 'divider' }} />
          <Box sx={{ position: 'absolute', left: '50%', top: 4, width: 2, height: 16, bgcolor: 'text.disabled', transform: 'translateX(-50%)' }} />
          {data.bias != null && <Box sx={{ position: 'absolute', top: 5, width: 14, height: 14, borderRadius: 7, bgcolor: 'primary.main', left: pct(data.bias), transform: 'translateX(-50%)' }} />}
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
          <Typography variant="caption" color="text.secondary">−2 harsh</Typography>
          <Typography variant="caption" color="text.secondary">generous +2</Typography>
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          Your overall vs. everyone else's on the same coffee, {plural(data.bias_coffees, 'coffee')}. Context, not a grade.
        </Typography>
      </Card>
      <Card>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <Eyebrow>Gap to the group</Eyebrow>
          <Typography variant="caption" color="text.secondary">last 6 months</Typography>
        </Box>
        {hasGap ? (
          <GapLine series={series} />
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>No shared coffees in the last six months yet.</Typography>
        )}
        <Typography variant="caption" color="text.secondary">A falling line is a palate learning the house vocabulary.</Typography>
      </Card>
      <Box>
        <Eyebrow sx={{ mb: 1 }}>Coffees you've tasted</Eyebrow>
        <Card sx={{ p: 0 }}>
          {data.coffees_tasted.map((c, i) => (
            <PalateRow
              key={c.coffee_id}
              first={i === 0}
              onClick={() => navigate(`/coffees/${c.coffee_id}`)}
              title={c.name}
              meta={[c.roaster, c.kind === 'external' ? 'elsewhere' : null, plural(c.reads, 'read')].filter(Boolean).join(' · ')}
              score={c.yours.toFixed(1)}
              scoreLabel={`vs ${c.theirs == null ? '—' : c.theirs.toFixed(1)}`}
              data-testid={`palate-coffee-${c.coffee_id}`}
            >
              <YouVsRoom you={c.yours} room={c.theirs} min={1} max={5} youLabel="Your average" roomLabel="The group's average" />
            </PalateRow>
          ))}
        </Card>
      </Box>
    </Box>
  );
}
