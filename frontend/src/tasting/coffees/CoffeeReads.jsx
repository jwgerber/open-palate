/**
 * The three cards on top of a coffee's page: Cuppings (Advanced, out of 100),
 * the Basic sheet (out of 5) and "You vs everyone else". The two scales are never
 * averaged or compared: each card, and each side of the lean card, stands alone.
 */
import { Box, Typography } from '@mui/material';
import Card from '../bits/Card';
import Eyebrow from '../bits/Eyebrow';
import VoteBar from '../bits/VoteBar';
import { ADV_GUIDANCE } from '../content';
import { plural } from '../format';
import { signed } from './sessions/sessionFormat';

const ATTRS = ['acidity', 'sweetness', 'body', 'balance'];

function TopCard({ label, sub, value, reads, testId, children }) {
  return (
    <Card data-testid={testId} sx={{ minWidth: 0 }}>
      <Eyebrow>{label}</Eyebrow>
      {sub && <Typography variant="caption" color="text.secondary">{sub}</Typography>}
      <Typography sx={{ fontWeight: 600, mt: 0.5, color: value ? 'text.primary' : 'text.disabled' }}>
        {value ? `${value} · ${plural(reads, 'read')}` : '—'}
      </Typography>
      {children}
    </Card>
  );
}

function BasicCard({ basic }) {
  const words = basic ? ATTRS.map((a) => basic.profile?.[a]?.word).filter(Boolean) : [];
  const terms = basic ? basic.descriptors.slice(0, 2) : [];
  return (
    <TopCard testId="basic-card" label="Basic sheet" value={basic?.avg_overall != null ? `${basic.avg_overall.toFixed(1)} out of 5` : null} reads={basic?.n}>
      {words.length > 0 && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{words.join(' · ')}</Typography>}
      {terms.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 1 }}>
          {terms.map((d) => <Typography key={d.term} component="span" variant="body2" sx={{ fontWeight: 500 }}>{d.label}</Typography>)}
        </Box>
      )}
    </TopCard>
  );
}

function CuppingCard({ cupping }) {
  return (
    <TopCard testId="cupping-card" label="Cuppings" sub="Advanced" value={cupping ? `${cupping.avg_total.toFixed(1)} out of 100` : null} reads={cupping?.n}>
      {cupping && <Box sx={{ mt: 1 }}><VoteBar votes={cupping.votes} /></Box>}
    </TopCard>
  );
}

const catLabel = (c) => ADV_GUIDANCE[c]?.label ?? c;

function LeanCard({ lean }) {
  if (!lean || (!lean.advanced && !lean.basic)) return null;
  return (
    <Card data-testid="lean-card" sx={{ minWidth: 0 }}>
      <Eyebrow>You vs everyone else</Eyebrow>
      {lean.advanced && (
        <Box sx={{ mt: 0.5 }}>
          <Typography sx={{ fontWeight: 600 }}>{signed(lean.advanced.total)} points on the cupping sheet</Typography>
          {lean.advanced.top?.length > 0 && (
            <Typography variant="body2" color="text.secondary">{lean.advanced.top.map((t) => `${catLabel(t.category)} ${signed(t.diff)}`).join(' · ')}</Typography>
          )}
        </Box>
      )}
      {lean.basic && <Typography sx={{ fontWeight: 600, mt: 0.5 }}>{signed(lean.basic.overall)} ★ overall</Typography>}
    </Card>
  );
}

export function TopCards({ coffee }) {
  return (
    <Box sx={{ display: 'grid', gap: 1.5, mb: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' } }}>
      <CuppingCard cupping={coffee.cupping} />
      <BasicCard basic={coffee.consensus} />
      <LeanCard lean={coffee.your_lean} />
    </Box>
  );
}
