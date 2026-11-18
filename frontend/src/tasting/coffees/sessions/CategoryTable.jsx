/**
 * Per-category table for one session: You / Others / Lean, a range strip, and one
 * column per other reader when the server named them. Below `sm` each row stacks
 * over its strip. Never mixes scales: advanced is 7.0-10 points, basic is 1-5.
 */
import { Box, Typography } from '@mui/material';
import { ATTRIBUTES, ADV_GROUPS, ADV_GUIDANCE, SCALE_WORDS } from '../../content';
import RangeStrip from './RangeStrip';

const MINUS = '−';
const NAME_COL = 'minmax(120px, 1.4fr)';
const NUM_COL = '56px';
const STRIP_COL = 'minmax(140px, 2fr)';
const PERSON_COL = '72px';

const f1 = (v) => (v == null ? '—' : Number(v).toFixed(1));

function formatLean(d) {
  const r = Math.round(d * 10) / 10;
  if (r > 0) return `+${r.toFixed(1)}`;
  if (r < 0) return `${MINUS}${Math.abs(r).toFixed(1)}`;
  return '0.0';
}

const advancedCell = (v) => (v == null ? '—' : Number(v) === 7 ? 'D/Q' : Number(v).toFixed(1));
const basicCell = (v) => (v == null ? '—' : String(v));

const scoreOf = (read, cat) => read?.scores?.[cat] ?? (cat === 'overall' ? read?.overall : null) ?? null;

function leanColor(theme, d) {
  if (d == null || Math.abs(d) < 0.05) return theme.palette.text.secondary;
  // Light mode: info.dark and the theme's warning ink clear 4.5:1 on paper (.main / warning.dark do not).
  // Dark mode: .main is the readable one.
  const dark = theme.palette.mode === 'dark';
  if (d > 0) return dark ? theme.palette.info.main : theme.palette.info.dark;
  return theme.palette.warning.ink ?? theme.palette.warning.main;
}

const headSx = { color: 'text.secondary', fontSize: 13 };
const numSx = { textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

// Stacked layout (strip under the numbers) only when there are no person columns to scroll.
function Row({ cols, hasRoom, stack, children, testId, sx }) {
  return (
    <Box
      role="row"
      data-testid={testId}
      sx={{
        display: 'grid', alignItems: 'center', columnGap: 1.5, rowGap: 0.5, minHeight: 44,
        gridTemplateColumns: stack ? { xs: `1fr repeat(${hasRoom ? 3 : 1}, ${NUM_COL})`, sm: cols } : cols,
        borderBottom: '1px solid', borderColor: 'divider',
        ...sx,
      }}
    >
      {children}
    </Box>
  );
}

function stripLabel(label, domain, room, you, cat) {
  const r = room?.range?.[cat];
  if (!r) return `${label}, you ${you ?? 'none'}`;
  return `${label}: range ${f1(r[0])} to ${f1(r[1])}, others average ${f1(room.others_avg?.[cat])}, you ${you == null ? 'none' : f1(you)}, scale ${domain[0]} to ${domain[1]}`;
}

export default function CategoryTable({ session }) {
  const isAdvanced = session.sheet === 'advanced';
  const { room, yours } = session;
  const hasRoom = !!room;
  const people = hasRoom && session.reads ? session.reads.filter((r) => !r.is_you) : [];
  const domain = isAdvanced ? [7, 10] : [1, 5];
  const stack = people.length === 0;
  const cell = isAdvanced ? advancedCell : basicCell;

  const cols = [NAME_COL, NUM_COL, ...(hasRoom ? [NUM_COL, NUM_COL, STRIP_COL] : []), ...people.map(() => PERSON_COL)].join(' ');

  const leanOf = (you, others) => (you == null || others == null ? null : you - others);

  const renderRow = (cat, label, sub) => {
    const you = scoreOf(yours, cat);
    const others = room?.others_avg?.[cat] ?? null;
    const lean = hasRoom ? leanOf(you, others) : null;
    const range = room?.range?.[cat];
    return (
      <Row key={cat} cols={cols} hasRoom={hasRoom} stack={stack} testId="category-row" sx={{ fontSize: 15 }}>
        <Box role="rowheader" sx={{ display: 'flex', flexDirection: 'column' }}>
          <span>{label}</span>
          {sub && <Typography variant="caption" color="text.secondary">{sub}</Typography>}
        </Box>
        <Box role="cell" sx={{ ...numSx, fontWeight: 600 }}>{cell(you)}</Box>
        {hasRoom && (
          <>
            <Box role="cell" sx={numSx}>{f1(others)}</Box>
            <Box role="cell" sx={{ ...numSx, fontWeight: 600, color: (t) => leanColor(t, lean) }}>{lean == null ? '—' : formatLean(lean)}</Box>
            <Box role="cell" sx={{ gridColumn: stack ? { xs: '1 / -1', sm: 'auto' } : 'auto', minWidth: 0, pb: stack ? { xs: 1, sm: 0 } : 0 }}>
              <RangeStrip
                lo={range?.[0]} hi={range?.[1]} min={domain[0]} max={domain[1]}
                avg={others} you={you} label={stripLabel(label, domain, room, you, cat)}
              />
            </Box>
          </>
        )}
        {people.map((p) => (
          <Box key={p.taster_key} role="cell" sx={{ ...numSx, color: 'text.secondary' }}>
            {cell(scoreOf(p, cat))}
          </Box>
        ))}
      </Row>
    );
  };

  const total = isAdvanced && hasRoom ? room.others_avg?.total : null;
  const youTotal = yours?.total ?? null;
  const totalLean = hasRoom ? leanOf(youTotal, total) : null;

  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Box role="table" sx={{ minWidth: people.length ? 520 + people.length * 84 : { sm: hasRoom ? 520 : 0 } }}>
        <Box role="rowgroup">
          <Row cols={cols} hasRoom={hasRoom} stack={stack} sx={{ ...headSx, minHeight: 36, alignItems: 'end', pb: 0.5, '& > *': { minWidth: 0 } }}>
            <Box role="columnheader">{isAdvanced ? 'Category' : 'Attribute'}</Box>
            <Box role="columnheader" sx={{ ...numSx, fontWeight: 600, color: 'text.primary' }}>You</Box>
            {hasRoom && (
              <>
                <Box role="columnheader" sx={numSx}>Others</Box>
                <Box role="columnheader" sx={numSx}>Lean</Box>
                <Box role="columnheader" aria-label="Range" sx={{ display: stack ? { xs: 'none', sm: 'flex' } : 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                  <span>{domain[0] === 7 ? '7.0' : domain[0]}</span><span>{domain[1]}</span>
                </Box>
              </>
            )}
            {people.map((p) => (
              <Box
                key={p.taster_key} role="columnheader" data-testid="person-header"
                sx={{ ...numSx, fontWeight: 600, color: 'text.primary', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                {p.taster_name}
                {isAdvanced && p.total != null && <Typography component="span" variant="caption" display="block" color="text.secondary">{f1(p.total)}</Typography>}
              </Box>
            ))}
          </Row>
        </Box>
        {isAdvanced ? ADV_GROUPS.map(([group, cats]) => (
          <Box key={group} role="rowgroup" aria-label={group}>
            <Typography role="presentation" sx={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'text.secondary', pt: 1.5, pb: 0.5 }}>
              {group}
            </Typography>
            {cats.map((c) => renderRow(c, ADV_GUIDANCE[c].label))}
          </Box>
        )) : <Box role="rowgroup">{ATTRIBUTES.map((a) => {
          const v = scoreOf(yours, a);
          const word = v != null ? SCALE_WORDS[a][v - 1] : null;
          return renderRow(a, a.charAt(0).toUpperCase() + a.slice(1), word ? `you: ${word}` : null);
        })}</Box>}
        {isAdvanced && (
          <Box role="rowgroup">
          <Row cols={cols} hasRoom={hasRoom} stack={stack} testId="total-row" sx={{ fontWeight: 700, fontSize: 15, borderBottom: 0 }}>
            <Box role="rowheader">Total</Box>
            <Box role="cell" sx={numSx}>{f1(youTotal)}</Box>
            {hasRoom && (
              <>
                <Box role="cell" sx={numSx}>{f1(total)}</Box>
                <Box role="cell" sx={{ ...numSx, color: (t) => leanColor(t, totalLean) }}>{totalLean == null ? '—' : formatLean(totalLean)}</Box>
                <Typography role="cell" sx={{ fontSize: 12, fontWeight: 400, color: 'text.secondary', display: stack ? { xs: 'none', sm: 'block' } : 'block' }}>
                  bar = low{'–'}high {'·'} tick = others {'·'} dot = you
                </Typography>
              </>
            )}
            {people.map((p) => (
              <Box key={p.taster_key} role="cell" sx={numSx}>{f1(p.total)}</Box>
            ))}
          </Row>
          </Box>
        )}
      </Box>
    </Box>
  );
}
