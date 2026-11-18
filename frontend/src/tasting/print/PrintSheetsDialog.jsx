/**
 * Full-screen preview + print for the Advanced cupping sheets. `flight === null`
 * prints the blank sheet. The dialog is the on-screen preview only; the
 * printer gets a separate unscaled copy in a plain `.advanced-print-root` portal
 * under <body> (see printCss.js for why). "copies" is the browser dialog's count.
 */
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Box, Button, Checkbox, Dialog, FormControlLabel, GlobalStyles, Typography } from '@mui/material';
import PrintFrontPage from './PrintFrontPage';
import PrintBackPage from './PrintBackPage';
import { sheetPages } from './printSheet';
import { PRINT_CSS, PAGE_CSS } from './printCss';

// 11in x 8.5in at 96 dpi; the preview is scaled by `zoom` to fit the dialog width.
const PAGE_W_PX = 11 * 96;
const PAGE_H_PX = 8.5 * 96;
const GUTTER_PX = 32;

function useFitScale() {
  const [node, setNode] = useState(null);
  const [scale, setScale] = useState(() => Math.min(1, (window.innerWidth - GUTTER_PX) / PAGE_W_PX));
  useEffect(() => {
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => { if (node.clientWidth > 0) setScale(Math.min(1, (node.clientWidth - GUTTER_PX) / PAGE_W_PX)); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => ro.disconnect();
  }, [node]);
  return [setNode, scale];
}

/** Keep the sheet's @page rules as the last stylesheet in <head> while printing is possible (see PAGE_CSS). */
function useLastPageStyle(active) {
  useEffect(() => {
    if (!active) return undefined;
    const style = document.createElement('style');
    style.setAttribute('data-advanced-print-page', '');
    style.textContent = PAGE_CSS;
    document.head.appendChild(style);
    return () => style.remove();
  }, [active]);
}

export default function PrintSheetsDialog({ open, flight, onClose }) {
  const [back, setBack] = useState(true);
  const pages = useMemo(() => sheetPages(flight, { back }), [flight, back]);
  const [setWrap, scale] = useFitScale();
  useLastPageStyle(open);
  const title = flight ? 'Print sheets' : 'Print a blank sheet';

  const sheet = (p) => (p.kind === 'front' ? <PrintFrontPage page={p} /> : <PrintBackPage />);

  return (
    <>
      {open && <GlobalStyles styles={PRINT_CSS} />}
      {open && createPortal(
        <div className="advanced-print-root" aria-hidden="true">
          {pages.map((p, i) => <div key={i} className="advanced-print-page-wrap">{sheet(p)}</div>)}
        </div>,
        document.body,
      )}
      <Dialog open={open} onClose={onClose} fullScreen aria-labelledby="print-sheets-title">
        <Box
          sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider', position: 'sticky', top: 0, zIndex: 1, bgcolor: 'background.paper' }}
        >
          <Typography id="print-sheets-title" variant="h6" component="h2">{title}</Typography>
          <FormControlLabel
            control={<Checkbox checked={back} onChange={(e) => setBack(e.target.checked)} />}
            label="Add the guidance page on the back"
          />
          <Typography variant="body2" color="text.secondary" sx={{ flex: 1, minWidth: 200 }}>
            Set copies in the print dialog — one per taster.
          </Typography>
          <Button variant="contained" onClick={() => window.print()} sx={{ minHeight: 44 }}>Print</Button>
          <Button onClick={onClose} sx={{ minHeight: 44 }}>Close</Button>
        </Box>
        <Box ref={setWrap} sx={{ bgcolor: 'grey.200', p: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          {pages.map((p, i) => (
            // zoom shrinks layout size too, so pages never overlap on screen.
            <Box key={i} sx={{ zoom: scale, width: PAGE_W_PX, height: PAGE_H_PX, flexShrink: 0, boxShadow: 3 }}>
              {sheet(p)}
            </Box>
          ))}
        </Box>
      </Dialog>
    </>
  );
}
