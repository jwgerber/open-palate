/**
 * The flavor wheel — a single-ring, drillable radial menu over the SCA/WCR
 * 2016 lexicon. One ring at a time: nine family wedges at the root, and a
 * tapped heading's children redraw to fill the whole circle, so every target
 * stays thumb-sized.
 *
 * Wedges use the SCA 2016 tier-1 hexes (FAMILY_HEX) — the one place the module
 * deliberately leaves the app palette, so the wheel reads as THE wheel.
 *
 * Pick rules live in lexicon.cycleTag (cap 5, specific wins); this component
 * only reports taps: a heading wedge drills (`onPath`), a leaf wedge or the
 * centre disc cycles a term (`onCycle`). Breadcrumb and the "All" button live
 * outside, in FlavorPicker.
 */
import { memo, useMemo } from 'react';
import { Box, Typography } from '@mui/material';
import { keyframes, useTheme } from '@mui/material/styles';
import { nodeAt, ancestorsOf, FAMILY_HEX, tintFor, MAX_TAGS_PER_CUP } from '../lexicon';
import { arc, GEOMETRY } from './wheelGeometry';

const { SIZE, VIEW, R_INNER } = GEOMETRY;

const wedgeIn = keyframes`
  from { transform: scale(.55) rotate(-14deg); opacity: 0; }
  to { transform: scale(1) rotate(0deg); opacity: 1; }
`;
const wedgePop = keyframes`
  0% { transform: scale(1); } 50% { transform: scale(1.07); } 100% { transform: scale(1); }
`;
const labelIn = keyframes`
  from { opacity: 0; transform: translate(-50%, -50%) scale(.8); }
  to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
`;
const ringIn = keyframes`
  from { stroke-dashoffset: 940; } to { stroke-dashoffset: 0; }
`;
const centerIn = keyframes`
  from { opacity: 0; transform: translate(-50%, -50%) scale(.85); }
  to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
`;
const EASE = 'cubic-bezier(.4,0,.2,1)';
const REDUCED = '@media (prefers-reduced-motion: reduce)';

const pct = (v) => `${((v + VIEW / 2) / VIEW) * 100}%`;
const isDarkFamily = (family) => family !== 'sour';
// The drill cascade: a capped stagger so the widest ring (10 wedges) is fully
// painted in ~320ms rather than 690ms — the most repeated tap in the flavor step.
const STAGGER_MS = 20;
const STAGGER_CAP = 4;
const IN_MS = 240;
const delay = (i) => Math.min(i, STAGGER_CAP) * STAGGER_MS;

function FlavorWheel({ path, tags, onPath, onCycle }) {
  const theme = useTheme();
  const { node, children } = nodeAt(path);
  const n = children.length;
  // Re-keying the three layers on the path replays the drill animation in the
  // same commit as the new ring (a state bump would paint the ring twice).
  const gen = path.join('>') || 'root';
  const dark = theme.palette.mode === 'dark';
  const ink = theme.palette.text.primary;
  const paper = theme.palette.background.paper;
  const deep = theme.palette.surface?.deep || '#2A2630';
  const atCap = Object.keys(tags).length >= MAX_TAGS_PER_CUP;
  const hereStrength = node ? tags[node.key] || 0 : 0;
  // One pass over the picked terms: heading key → the picked terms beneath it.
  const insideOf = useMemo(() => {
    const m = new Map();
    Object.keys(tags).forEach((t) => ancestorsOf(t).forEach((a) => m.set(a, [...(m.get(a) || []), t])));
    return m;
  }, [tags]);
  const hereInside = node ? insideOf.get(node.key) || [] : [];
  const covered = !!node && hereInside.length > 0;
  const familyHex = node ? FAMILY_HEX[node.family] : null;

  const tapWedge = (child) => (child.leaf ? onCycle(child.key) : onPath([...path, child.label]));
  const tapCenter = () => { if (node && !covered) onCycle(node.key); };
  const onKey = (fn) => (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } };
  const stateOf = (s) => (s === 3 ? ', strong' : s ? ', picked' : '');

  return (
    <Box sx={{ position: 'relative', width: SIZE, height: SIZE, maxWidth: '100%', touchAction: 'manipulation', mx: 'auto' }} data-testid="flavor-wheel">
      <svg
        key={`g${gen}`}
        viewBox={`${-VIEW / 2} ${-VIEW / 2} ${VIEW} ${VIEW}`}
        width={SIZE}
        height={SIZE}
        role="group"
        aria-label={node ? `Flavors under ${node.label}` : 'All flavors'}
        style={{ position: 'absolute', inset: 0, display: 'block', overflow: 'visible', maxWidth: '100%' }}
      >
        {node && (
          <Box
            component="circle"
            r={148}
            fill="none"
            stroke={familyHex}
            strokeWidth={5}
            strokeLinecap="round"
            strokeDasharray={940}
            sx={{
              transform: 'rotate(-90deg)', transformOrigin: '0px 0px',
              animation: `${ringIn} 520ms ${EASE} both`, [REDUCED]: { animation: 'none' },
            }}
          />
        )}
        {children.map((c, i) => {
          const s = tags[c.key] || 0;
          const g = arc(i, n);
          const capped = c.leaf && !s && atCap;
          return (
            <Box
              component="path"
              key={c.key}
              d={g.d}
              fill={FAMILY_HEX[c.family]}
              stroke={s ? ink : paper}
              strokeWidth={s === 3 ? 5 : s ? 3 : 2}
              fillOpacity={capped ? 0.25 : c.leaf && !s ? 0.45 : s ? 1 : 0.85}
              role="button"
              tabIndex={0}
              aria-label={c.leaf ? `${c.label}${stateOf(s)}` : `Open ${c.label}`}
              aria-pressed={c.leaf ? !!s : undefined}
              aria-disabled={capped || undefined}
              data-testid={`wedge-${c.key}`}
              onClick={() => tapWedge(c)}
              onKeyDown={onKey(() => tapWedge(c))}
              sx={{
                cursor: 'pointer', transformOrigin: '0px 0px',
                animation: s ? `${wedgePop} 240ms ${EASE}` : `${wedgeIn} ${IN_MS}ms ${EASE} ${delay(i)}ms both`,
                [REDUCED]: { animation: 'none' },
                '&:focus-visible': { outline: 'none', strokeWidth: 4, stroke: theme.palette.primary.main },
              }}
            />
          );
        })}
        <circle
          r={R_INNER - 4}
          fill={hereStrength ? tintFor(node.key, theme.palette.mode) : paper}
          stroke={hereStrength ? theme.palette.primary.main : theme.palette.divider}
          strokeWidth={hereStrength === 3 ? 3 : 1.5}
          onClick={tapCenter}
          style={{ cursor: node ? 'pointer' : 'default' }}
        />
      </svg>
      {/* Labels are decorative: inert to the pointer (the wedge path takes every
          tap, so a label box can never steal a tap from its neighbour) and hidden
          from assistive tech (the path carries the accessible name). */}
      <Box key={`l${gen}`} aria-hidden sx={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {children.map((c, i) => {
          const s = tags[c.key] || 0;
          const inside = c.leaf ? 0 : (insideOf.get(c.key) || []).length;
          const g = arc(i, n);
          // A dim (unpicked leaf) wedge composites over the paper, so its label
          // takes the paper's ink; a solid wedge takes white, except the yellow
          // sour family which stays dark ink.
          const solid = !(c.leaf && !s);
          const color = solid ? (isDarkFamily(c.family) ? '#FFFFFF' : deep) : ink;
          return (
            <Box
              key={c.key}
              sx={{
                position: 'absolute', left: pct(g.lx), top: pct(g.ly), transform: 'translate(-50%,-50%)',
                width: n > 6 ? 62 : 84, textAlign: 'center', fontSize: n > 8 ? 10.5 : 12, lineHeight: 1.15, fontWeight: 600,
                color, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', userSelect: 'none',
                opacity: c.leaf && !s && atCap ? 0.5 : 1,
                animation: `${labelIn} ${IN_MS}ms ${EASE} ${delay(i) + 40}ms both`, [REDUCED]: { animation: 'none' },
              }}
            >
              <span style={{ wordBreak: 'break-word' }}>{c.label}</span>
              {s ? <Badge dark={dark}>{s === 3 ? '! strong' : '✓'}</Badge> : null}
              {!c.leaf && inside ? <Badge dark={dark}>{`${inside} in`}</Badge> : null}
              {!c.leaf && !inside ? <span style={{ fontSize: 10, opacity: 0.85 }}>{`${c.children.length} ›`}</span> : null}
            </Box>
          );
        })}
      </Box>
      <Box
        key={`c${gen}`}
        onClick={tapCenter}
        onKeyDown={onKey(tapCenter)}
        role={node && !covered ? 'button' : undefined}
        tabIndex={node && !covered ? 0 : undefined}
        aria-label={node && !covered ? `Take ${node.label} as is${stateOf(hereStrength)}` : undefined}
        data-testid="wheel-center"
        sx={{
          position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: 100, textAlign: 'center',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', cursor: node ? 'pointer' : 'default',
          userSelect: 'none', animation: `${centerIn} 300ms ${EASE} both`, [REDUCED]: { animation: 'none' },
        }}
      >
        <Typography sx={{ fontSize: 10.5, color: covered ? 'text.disabled' : 'primary.main' }}>
          {!node ? 'tap a family' : covered ? 'covered by' : hereStrength === 3 ? '! strong' : hereStrength ? '✓ picked' : '＋ take as is'}
        </Typography>
        <Typography sx={{ fontFamily: (t) => t.typography.h4.fontFamily, fontWeight: 600, lineHeight: 1.15, fontSize: node && node.label.length > 10 ? 12.5 : 14, color: 'text.primary' }}>
          {node ? (covered ? hereInside.map((k) => k.split('>').pop()).join(', ') : node.label) : 'All flavors'}
        </Typography>
      </Box>
    </Box>
  );
}

function Badge({ children, dark }) {
  return (
    <span style={{ fontSize: 10, color: dark ? '#1A171F' : '#FFFFFF', background: dark ? '#F2EFEA' : '#2A2630', borderRadius: 9999, padding: '1px 6px' }}>{children}</span>
  );
}

export default memo(FlavorWheel);
