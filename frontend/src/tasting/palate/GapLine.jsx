/**
 * The monthly gap-to-the-group line — six points at most, no interaction, so
 * a 40-line inline SVG (like ConsensusAxis and Histogram) rather than a chart
 * library: recharts' cartesian chunk is ~90 kB gzipped, and a taster on a
 * phone whose only module is Tasting would pay it for one polyline.
 */
import { Box, useTheme } from '@mui/material';

const W = 320;
const H = 140;
const PAD = { top: 10, right: 10, bottom: 24, left: 24 };
const Y_MAX = 4;
const REFERENCE = 1;

export default function GapLine({ series }) {
  const theme = useTheme();
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i) => PAD.left + (series.length > 1 ? (i / (series.length - 1)) * innerW : innerW / 2);
  const y = (v) => PAD.top + innerH - (Math.min(Y_MAX, Math.max(0, v)) / Y_MAX) * innerH;
  const points = series.map((p, i) => (p.gap == null ? null : { x: x(i), y: y(p.gap), label: p.month }));
  const line = points.filter(Boolean).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const ink = theme.palette.text.secondary;
  return (
    <Box component="svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Gap to the group by month" sx={{ width: '100%', height: 'auto', display: 'block', mt: 1 }} data-testid="gap-line">
      {[0, 2, 4].map((v) => (
        <text key={v} x={PAD.left - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill={ink}>{v}</text>
      ))}
      <line x1={PAD.left} x2={W - PAD.right} y1={y(REFERENCE)} y2={y(REFERENCE)} stroke={theme.palette.divider} strokeDasharray="4 4" />
      {line && <polyline points={line} fill="none" stroke={theme.palette.primary.main} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
      {points.map((p, i) => (p ? <circle key={i} cx={p.x} cy={p.y} r="3" fill={theme.palette.primary.main} /> : null))}
      {series.map((p, i) => (
        <text key={p.month} x={x(i)} y={H - 6} textAnchor="middle" fontSize="11" fill={ink}>{p.month}</text>
      ))}
    </Box>
  );
}
