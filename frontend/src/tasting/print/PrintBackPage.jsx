import { memo } from 'react';
import Box from '@mui/material/Box';
import { ADV_GROUPS, ADV_GUIDANCE } from '../content';

const LINE = 'common.black';
const kicker = { m: 0, fontSize: '9.5pt', fontWeight: 600, letterSpacing: '.12em', textTransform: 'uppercase' };

const RHYTHM = [
  'Smell the dry grounds (fragrance → Aroma)',
  'Pour · at 5:00 break the crust and sniff',
  'Hot pass ~149 °F · comfortable ~131 °F · warm ~113 °F',
  'Score each cup once; change your mind until the last pass',
];

// 7.5 sits 20% from 8 and 9 sits 40% from 10, so neighbours alternate above and below the rule.
const SCALE_MARKS = [
  { left: 0, text: '7.5 some faults', shift: 'none', row: 'below' },
  { left: 20, text: '8 clean', shift: 'translateX(-50%)', bold: true, row: 'above' },
  { left: 60, text: '9 great', shift: 'translateX(-50%)', row: 'above' },
  { left: 100, text: "10 the best you've had", shift: 'translateX(-100%)', row: 'below' },
];
const RULE_TOP = '0.2in';

const GROUP_OF = Object.fromEntries(ADV_GROUPS.flatMap(([g, keys]) => keys.map((k) => [k, g])));
const ORDER = ADV_GROUPS.flatMap(([, keys]) => keys);

const Line = ({ mark, text }) => (
  <Box sx={{ display: 'grid', gridTemplateColumns: '0.33in minmax(0, 1fr)', fontSize: '11.5pt' }}>
    <b>{mark}</b>
    <span>{text}</span>
  </Box>
);

function PrintBackPage() {
  return (
    <Box
      className="advanced-print-page"
      sx={{
        width: '11in', height: '8.5in', boxSizing: 'border-box', overflow: 'hidden', p: '0.29in 0.375in',
        bgcolor: 'common.white', color: 'common.black', fontSize: '12pt', lineHeight: 1.35,
        fontFamily: 'Inter, Arial, sans-serif',
      }}
    >
      <Box sx={{ display: 'flex', gap: '0.29in', alignItems: 'stretch', pb: '0.125in', borderBottom: '2px solid', borderColor: LINE }}>
        <Box sx={{ width: '2.3in' }}>
          <Box component="p" sx={kicker}>How to score</Box>
          <Box component="p" sx={{ m: 0, mt: '2px', fontSize: '20pt', fontWeight: 700 }}>Read me first</Box>
          <Box component="p" sx={{ m: 0, mt: '6px', fontSize: '11pt' }}>
            Score each cup on its own. Don&apos;t look at anyone else&apos;s sheet until the host closes the cupping.
          </Box>
        </Box>
        <Box sx={{ flex: 1, border: '1px solid', borderColor: LINE, px: '0.125in', py: '0.08in' }}>
          <Box component="p" sx={kicker}>The scale</Box>
          {/* Borders, not background colours, so the rule prints with "Background graphics" off. */}
          <Box aria-hidden sx={{ position: 'relative', height: '0.42in', mt: '2px' }}>
            <Box sx={{ position: 'absolute', left: 0, right: 0, top: RULE_TOP, borderTop: '2px solid', borderColor: LINE }} />
            {SCALE_MARKS.map((m) => (
              <Box
                key={m.left}
                sx={{
                  position: 'absolute', top: `calc(${RULE_TOP} - 0.05in)`, height: '0.125in', borderLeft: m.bold ? '2px solid' : '1px solid', borderColor: LINE,
                  left: m.left === 100 ? 'calc(100% - 1px)' : `${m.left}%`,
                }}
              />
            ))}
            {SCALE_MARKS.map((m) => (
              <Box
                key={m.text}
                component="span"
                data-scale-row={m.row}
                sx={{
                  position: 'absolute', fontSize: '10pt', lineHeight: 1.2, whiteSpace: 'nowrap', left: `${m.left}%`, transform: m.shift, fontWeight: m.bold ? 700 : 400,
                  ...(m.row === 'above' ? { top: 0 } : { top: `calc(${RULE_TOP} + 0.09in)` }),
                }}
              >
                {m.text}
              </Box>
            ))}
          </Box>
          <Box component="p" sx={{ m: 0, mt: '6px', fontSize: '11pt' }}>
            Start every category at 8: nothing wrong, nothing special. Go up for good things, down for faults. Under 7.5 is a{' '}
            <b>D/Q</b> — tick the box. Specialty coffee usually totals over 80.
          </Box>
        </Box>
        <Box sx={{ width: '3.4in', fontSize: '11pt' }}>
          <Box component="p" sx={kicker}>The rhythm</Box>
          <Box component="ol" sx={{ m: 0, mt: '4px', pl: '16px' }}>
            {RHYTHM.map((r) => <li key={r}>{r}</li>)}
          </Box>
        </Box>
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', columnGap: '0.29in', mt: '0.125in' }}>
        {ORDER.map((k) => (
          <Box key={k} sx={{ py: '7px', borderBottom: '1px solid', borderColor: 'grey.500', breakInside: 'avoid' }}>
            <Box component="h3" sx={{ fontSize: '13pt', fontWeight: 700, m: '0 0 3px', display: 'flex', justifyContent: 'space-between' }}>
              {ADV_GUIDANCE[k].label}
              <Box component="span" sx={{ fontSize: '9pt', fontWeight: 600, letterSpacing: '.12em', textTransform: 'uppercase', color: 'grey.800' }}>
                {GROUP_OF[k]}
              </Box>
            </Box>
            <Line mark="+" text={ADV_GUIDANCE[k].plus} />
            <Line mark="−" text={ADV_GUIDANCE[k].minus} />
            <Line mark="D/Q" text={ADV_GUIDANCE[k].dq} />
          </Box>
        ))}
      </Box>
    </Box>
  );
}

export default memo(PrintBackPage);
