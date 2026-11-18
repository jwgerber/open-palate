import { memo } from 'react';
import Box from '@mui/material/Box';
import { QRCodeSVG } from 'qrcode.react';
import { ADV_GROUPS, ADV_GUIDANCE } from '../content';
import { PRINT_HINTS, scaleHint } from './printSheet';

const LINE = 'common.black';
const FAINT = 'grey.500';
const TICKS = [0, 20, 40, 60, 80, 100];

const box = { width: '0.16in', height: '0.24in', border: '1.2px solid', borderColor: LINE, bgcolor: 'common.white' };
const Dot = () => <Box component="span" sx={{ fontSize: '14pt', fontWeight: 700, lineHeight: 1, pb: '1px' }}>.</Box>;
const Boxes = ({ n, dot }) => (
  <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: '1px' }}>
    {Array.from({ length: n }, (_, i) => (
      <Box key={i} sx={{ display: 'contents' }}>
        {i === dot && <Dot />}
        <Box sx={box} />
      </Box>
    ))}
  </Box>
);

const oneLine = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
const hintSx = { fontStyle: 'normal', fontSize: '8.5pt', color: 'grey.800', flexShrink: 0, ...oneLine };
const rowLabel = { display: 'flex', flexDirection: 'column', justifyContent: 'center', pl: '0.04in', borderBottom: '1px solid', borderColor: FAINT };
const cellBase = { borderLeft: '1px solid', borderColor: LINE, borderBottom: '1px solid', borderBottomColor: FAINT };

// The rule, ticks and fiducials are SVG strokes/fills, not background colours, so they
// print with the browser's "Background graphics" off. Units are points (0.62in = 44.64pt).
const TICK_W = 44.64;
const TICK_H = 21.6;
const RULE_Y = 10.5;
const tickX = (pct) => 0.5 + (pct / 100) * (TICK_W - 1);

// 8 (the anchor) sits bold above the rule; 7.5, 9 and 10 sit below, so 7.5 and 8 never run together.
function TickLine() {
  return (
    <Box
      component="svg" data-testid="tick-line" aria-hidden width="0.62in" height="0.3in"
      viewBox={`0 0 ${TICK_W} ${TICK_H}`} sx={{ flexShrink: 0, display: 'block', overflow: 'visible' }}
    >
      <line x1={tickX(0)} x2={tickX(100)} y1={RULE_Y} y2={RULE_Y} stroke="black" strokeWidth={0.75} />
      {TICKS.map((t) => (
        <line
          key={t} x1={tickX(t)} x2={tickX(t)} stroke="black"
          y1={t === 20 ? RULE_Y - 3 : RULE_Y - 2} y2={t === 20 ? RULE_Y + 4.5 : RULE_Y + 2}
          strokeWidth={t === 20 ? 1.5 : 0.75}
        />
      ))}
      <text x={tickX(20)} y={6} fontSize={7.5} fontWeight="700" textAnchor="middle">8</text>
      <text x={0} y={TICK_H - 1} fontSize={7.5} textAnchor="start">7.5</text>
      <text x={tickX(60)} y={TICK_H - 1} fontSize={7.5} textAnchor="middle">9</text>
      <text x={TICK_W} y={TICK_H - 1} fontSize={7.5} textAnchor="end">10</text>
    </Box>
  );
}

function ScoreCell() {
  return (
    <Box sx={{ ...cellBase, height: '0.375in', display: 'flex', alignItems: 'center', gap: '5px', px: '0.04in' }}>
      <TickLine />
      <Boxes n={2} dot={1} />
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1px', fontSize: '7.5pt', fontWeight: 700, ml: 'auto' }}>
        <Box sx={{ width: '0.125in', height: '0.125in', border: '1.2px solid', borderColor: LINE }} />
        D/Q
      </Box>
    </Box>
  );
}

const WriteRow = ({ label, hint, height, lines, cups }) => (
  <>
    <Box sx={{ ...rowLabel, height }}>
      <Box component="b" sx={{ fontSize: '12pt' }}>{label}</Box>
      {hint && <Box component="i" sx={hintSx}>{hint}</Box>}
    </Box>
    {cups.map((c, i) => (
      <Box key={i} sx={{ ...cellBase, height, p: '0.04in' }}>
        {Array.from({ length: lines }, (_, l) => (
          <Box key={l} sx={{ height: '0.167in', borderBottom: l === 2 ? 0 : '1px solid', borderColor: FAINT }} />
        ))}
      </Box>
    ))}
  </>
);

const Fiducial = (pos) => (
  <Box component="svg" data-testid="fiducial" aria-hidden viewBox="0 0 1 1" sx={{ position: 'absolute', width: '0.125in', height: '0.125in', ...pos }}>
    <rect width="1" height="1" fill="black" />
  </Box>
);

function Header({ header, qr, page }) {
  const blank = header.meta === null;
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: '0.2in', height: '1.15in', borderBottom: '2px solid', borderColor: LINE, px: '0.08in', pb: '0.08in' }}>
      <Box sx={{ width: '4.2in' }}>
        <Box component="p" sx={{ m: 0, fontSize: '9.5pt', fontWeight: 600, letterSpacing: '.12em', textTransform: 'uppercase' }}>
          Cupping sheet · Advanced
        </Box>
        {blank ? (
          <>
            <WriteIn label="Cupping" sx={{ mt: '0.03in' }} />
            <WriteIn label="Date" />
          </>
        ) : (
          <>
            <Box component="p" sx={{ m: 0, mt: '2px', fontSize: '20pt', fontWeight: 700 }}>{header.title}</Box>
            <Box component="p" sx={{ m: 0, mt: '2px', fontSize: '11pt' }}>{header.meta}</Box>
          </>
        )}
        <Box component="p" sx={{ m: 0, mt: '2px', fontSize: '11pt' }}>{scaleHint(header.step)}</Box>
      </Box>
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'flex-end', gap: '8px', height: '0.54in', mt: '0.3in', fontSize: '12pt', fontWeight: 600 }}>
        Name
        <Box sx={{ flex: 1, borderBottom: '1px solid', borderColor: LINE, height: '0.23in' }} />
      </Box>
      {qr && (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
          <QRCodeSVG value={qr} size={72} level="M" />
          <Box component="span" sx={{ fontSize: '7.5pt' }}>{`flight ${qr.split(':')[2]} · p${page}`}</Box>
        </Box>
      )}
    </Box>
  );
}

const WriteIn = ({ label, sx }) => (
  <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: '6px', fontSize: '10pt', fontWeight: 600, ...sx }}>
    {label}
    <Box sx={{ flex: 1, borderBottom: '1px solid', borderColor: LINE, height: '0.16in' }} />
  </Box>
);

function PrintFrontPage({ page }) {
  const { cups, header, qr } = page;
  const cols = `1.375in repeat(${Math.max(cups.length, 1)}, minmax(0, 1fr))`;
  return (
    <Box
      className="advanced-print-page"
      sx={{
        position: 'relative', width: '11in', height: '8.5in', boxSizing: 'border-box', overflow: 'hidden',
        p: '0.25in 0.29in', bgcolor: 'common.white', color: 'common.black', fontSize: '11pt', lineHeight: 1.3,
        fontFamily: 'Inter, Arial, sans-serif',
      }}
    >
      {Fiducial({ left: '0.1in', top: '0.1in' })}
      {Fiducial({ right: '0.1in', top: '0.1in' })}
      {Fiducial({ left: '0.1in', bottom: '0.1in' })}
      {Fiducial({ right: '0.1in', bottom: '0.1in' })}
      <Header header={header} qr={qr} page={page.page} />
      <Box sx={{ display: 'grid', gridTemplateColumns: cols }}>
        <Box sx={{ height: '0.31in', display: 'flex', alignItems: 'center', pl: '0.04in', fontSize: '9.5pt', fontWeight: 500, borderBottom: '1px solid', borderColor: LINE }}>
          category
        </Box>
        {cups.map((c, i) => (
          <Box key={i} sx={{ height: '0.31in', minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', px: '0.04in', fontSize: '15pt', fontWeight: 700, borderBottom: '1px solid', borderLeft: '1px solid', borderColor: LINE }}>
            <Box component="span" sx={{ display: 'block', maxWidth: '100%', ...oneLine }}>{c}</Box>
          </Box>
        ))}
        {ADV_GROUPS.map(([group, keys]) => (
          <Box key={group} sx={{ display: 'contents' }}>
            <Box sx={{ gridColumn: '1 / -1', height: '0.167in', fontSize: '9pt', fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', px: '0.04in', pt: '3px', bgcolor: 'grey.300', borderBottom: '1px solid', borderColor: FAINT }}>
              {group}
            </Box>
            {keys.map((k) => (
              <Box key={k} data-testid="cat-row" sx={{ display: 'contents' }}>
                <Box sx={{ ...rowLabel, height: '0.375in' }}>
                  <Box component="b" sx={{ fontSize: '12pt' }}>{ADV_GUIDANCE[k].label}</Box>
                  <Box component="i" sx={hintSx}>{PRINT_HINTS[k]}</Box>
                </Box>
                {cups.map((c, i) => <ScoreCell key={i} />)}
              </Box>
            ))}
          </Box>
        ))}
        <Box sx={{ height: '0.354in', display: 'flex', alignItems: 'center', gap: '6px', pl: '0.04in', fontSize: '12pt', fontWeight: 700, borderTop: '2px solid', borderBottom: '2px solid', borderColor: LINE }}>
          TOTAL<Box component="span" sx={{ fontSize: '8.5pt', fontWeight: 500 }}>/ 100</Box>
        </Box>
        {cups.map((c, i) => (
          <Box key={i} sx={{ height: '0.354in', display: 'flex', alignItems: 'center', justifyContent: 'center', borderLeft: '1px solid', borderTop: '2px solid', borderBottom: '2px solid', borderColor: LINE }}>
            <Boxes n={3} dot={2} />
          </Box>
        ))}
        {/* The row is too short for two lines, so the hint sits beside the label. */}
        <Box sx={{ ...rowLabel, height: '0.3125in', flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: '5px' }}>
          <Box component="b" sx={{ fontSize: '12pt', whiteSpace: 'nowrap' }}>On bar?</Box>
          <Box component="i" sx={hintSx}>tick one</Box>
        </Box>
        {cups.map((c, i) => (
          <Box key={i} sx={{ ...cellBase, height: '0.3125in', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', fontSize: '11pt', fontWeight: 700 }}>
            {['Y', 'M', 'N'].map((v) => (
              <Box key={v} component="span" sx={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                <Box data-testid="vote-box" sx={{ width: '0.135in', height: '0.135in', border: '1.2px solid', borderColor: LINE }} />
                {v}
              </Box>
            ))}
          </Box>
        ))}
        <WriteRow label="Flavors" hint="up to 5 words" height="0.46in" lines={2} cups={cups} />
        <WriteRow label="Defects" height="0.27in" lines={1} cups={cups} />
        <WriteRow label="Notes" height="0.6in" lines={3} cups={cups} />
      </Box>
      <Box sx={{ position: 'absolute', left: '0.29in', right: '0.29in', bottom: '0.15in', display: 'flex', justifyContent: 'space-between', fontSize: '8.5pt', color: 'grey.800' }}>
        <span>Write each score in the boxes, e.g. 8 . 5 — the scan reads the boxes, not the tick line.</span>
        <span>Guidance on the back</span>
      </Box>
    </Box>
  );
}

export default memo(PrintFrontPage);
