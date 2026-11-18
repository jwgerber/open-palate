import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { sheetPages, qrPayload, scaleHint, CUPS_PER_PAGE, PRINT_HINTS, PRINT_HINT_MAX } from '../print/printSheet';
import PrintFrontPage from '../print/PrintFrontPage';
import PrintBackPage from '../print/PrintBackPage';
import PrintSheetsDialog from '../print/PrintSheetsDialog';
import { PRINT_CSS, PAGE_CSS } from '../print/printCss';
import { ADV_GUIDANCE } from '../content';

const cupsOf = (n, blind) =>
  Array.from({ length: n }, (_, i) => ({
    position: i + 1,
    label: blind ? `Cup ${String.fromCharCode(65 + i)}` : `Coffee ${i + 1}`,
    name: 'Ethiopia Guji',
    roaster: 'Onyx',
    blind,
  }));

const flight = (n, { blind = true, step = 0.5 } = {}) => ({
  id: 418,
  name: 'Fall importer samples',
  opened_at: '2026-10-21T15:00:00',
  is_blind: blind,
  adv_step: step,
  cups: cupsOf(n, blind).reverse(),
});

const wrap = (ui) => render(<ThemeProvider theme={createTheme()}>{ui}</ThemeProvider>);

describe('print page model', () => {
  it('chunks 13 cups into 6/6/1 pages', () => {
    const pages = sheetPages(flight(13), { back: false });
    expect(CUPS_PER_PAGE).toBe(6);
    expect(pages.map((p) => p.cups.length)).toEqual([6, 6, 1]);
    expect(pages.map((p) => p.page)).toEqual([1, 2, 3]);
    expect(pages.every((p) => p.pages === 3)).toBe(true);
    expect(pages[0].cups[0]).toBe('Cup A');
    expect(pages[0].qr).toBe('palate-cupping:v1:418:1');
  });
  it('puts a back page after every front when asked', () => {
    const pages = sheetPages(flight(13), { back: true });
    expect(pages.map((p) => p.kind)).toEqual(['front', 'back', 'front', 'back', 'front', 'back']);
  });
  it('builds the header meta line', () => {
    const [p] = sheetPages(flight(8), { back: false });
    expect(p.header.title).toBe('Fall importer samples');
    expect(p.header.meta).toBe('Wed Oct 21 · blind · page 1 of 2 · Cups A–F');
    const sighted = sheetPages(flight(3, { blind: false }), { back: false })[0];
    expect(sighted.header.meta).toContain('sighted');
    expect(sighted.header.meta).toContain('Cups 1–3');
  });
  it('numbers cup ranges by overall position on later pages', () => {
    const blind = sheetPages(flight(13), { back: false });
    expect(blind[1].header.meta).toMatch(/page 2 of 3 · Cups G–L$/);
    expect(blind[2].header.meta).toMatch(/page 3 of 3 · Cup M$/);
    const sighted = sheetPages(flight(13, { blind: false }), { back: false });
    expect(sighted[1].header.meta).toMatch(/Cups 7–12$/);
  });
  it('range uses custom labels', () => {
    const f = flight(8);
    f.cups = f.cups.map((c) => ({ ...c, blind_label: `H${c.position}`, label: `Cup H${c.position}` }));
    const pages = sheetPages(f, { back: false });
    expect(pages[0].header.meta).toMatch(/Cups H1–H6$/);
    expect(pages[1].header.meta).toMatch(/Cups H7–H8$/);
  });
  it('single-cup page uses its label', () => {
    const f = flight(7);
    f.cups = f.cups.map((c) => ({ ...c, blind_label: `H${c.position}`, label: `Cup H${c.position}` }));
    expect(sheetPages(f, { back: false })[1].header.meta).toMatch(/Cup H7$/);
  });
  it('range falls back to the position letter when blind_label is null, and never reads label', () => {
    const f = flight(3);
    f.cups = f.cups.map((c) => ({ ...c, blind_label: null, label: 'Ethiopia Guji' }));
    expect(sheetPages(f, { back: false })[0].header.meta).toMatch(/Cups A–C$/);
  });
  it('a flight with no cups still yields one page without a bogus range', () => {
    const [p] = sheetPages(flight(0), { back: false });
    expect(p.cups).toEqual([]);
    expect(p.header.meta).not.toMatch(/@/);
    wrap(<PrintFrontPage page={p} />);
  });
  it('blank sheet is one page of Cup ___ with no qr', () => {
    const pages = sheetPages(null, { back: false });
    expect(pages).toHaveLength(1);
    expect(pages[0].qr).toBeNull();
    expect(pages[0].cups).toEqual(Array(6).fill('Cup ___'));
    expect(pages[0].header.title).toBe('Cupping');
    expect(pages[0].header.meta).toBeNull();
  });
  it('qrPayload and scaleHint', () => {
    expect(qrPayload(418, 2)).toBe('palate-cupping:v1:418:2');
    expect(scaleHint(0.5)).toBe('Score 7.5–10 in halves. 8 = clean. Below 7.5: tick D/Q.');
    expect(scaleHint(0.1)).toContain('tenths');
    expect(scaleHint(null)).toBe('Score 7.5–10. 8 = clean. Below 7.5: tick D/Q.');
  });
});

describe('PrintFrontPage', () => {
  it('never shows coffee names on a blind flight', () => {
    const [page] = sheetPages(flight(6), { back: false });
    const { container } = wrap(<PrintFrontPage page={page} />);
    expect(screen.queryByText(/Ethiopia|Onyx/)).toBeNull();
    expect(container.textContent).not.toMatch(/Ethiopia|Onyx/);
    expect(screen.getByText('Cup A')).toBeInTheDocument();
  });
  it('shows labels on a sighted flight', () => {
    const [page] = sheetPages(flight(3, { blind: false }), { back: false });
    wrap(<PrintFrontPage page={page} />);
    expect(screen.getByText('Coffee 1')).toBeInTheDocument();
  });
  it('renders 10 category rows, 3 vote boxes per cup and a QR', () => {
    const [page] = sheetPages(flight(6), { back: false });
    const { container } = wrap(<PrintFrontPage page={page} />);
    expect(container.querySelectorAll('[data-testid="cat-row"]')).toHaveLength(10);
    expect(container.querySelectorAll('[data-testid="vote-box"]')).toHaveLength(18);
    expect(container.querySelector('svg')).not.toBeNull();
    expect(screen.getByText('flight 418 · p1')).toBeInTheDocument();
    expect(container.querySelector('.advanced-print-page')).not.toBeNull();
  });
  it('keeps every hint on one line', () => {
    // 1.375in label column at 8.5pt fits ~22 characters; 20 leaves margin.
    expect(PRINT_HINT_MAX).toBe(20);
    Object.values(PRINT_HINTS).forEach((h) => expect(h.length).toBeLessThanOrEqual(PRINT_HINT_MAX));
    const [page] = sheetPages(flight(6), { back: false });
    wrap(<PrintFrontPage page={page} />);
    expect(screen.getByText(PRINT_HINTS.sweetness)).toHaveStyle({ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' });
  });
  it('a long sighted coffee name stays on one line with an ellipsis', () => {
    const long = { ...flight(3, { blind: false }) };
    long.cups = long.cups.map((c) => ({ ...c, label: 'Ethiopia Guji Shakiso Natural Lot 7' }));
    const [page] = sheetPages(long, { back: false });
    wrap(<PrintFrontPage page={page} />);
    const head = screen.getAllByText('Ethiopia Guji Shakiso Natural Lot 7')[0];
    expect(head).toHaveStyle({ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' });
  });
  it('draws the tick line, its labels and the fiducials without background colours', () => {
    const [page] = sheetPages(flight(1), { back: false });
    const { container } = wrap(<PrintFrontPage page={page} />);
    const tick = container.querySelector('[data-testid="tick-line"]');
    expect(tick.tagName.toLowerCase()).toBe('svg');
    expect(tick.querySelectorAll('line').length).toBeGreaterThanOrEqual(7);
    const labels = [...tick.querySelectorAll('text')];
    expect(labels.map((t) => t.textContent)).toEqual(['8', '7.5', '9', '10']);
    // 8 sits above the rule, the rest below, so 7.5 and 8 can never run together.
    const y = Object.fromEntries(labels.map((t) => [t.textContent, Number(t.getAttribute('y'))]));
    expect(y['8']).toBeLessThan(y['7.5']);
    expect(labels[0].getAttribute('font-weight')).toBe('700');
    const fids = container.querySelectorAll('[data-testid="fiducial"]');
    expect(fids).toHaveLength(4);
    fids.forEach((f) => expect(f.tagName.toLowerCase()).toBe('svg'));
  });
  it('blank sheet has write-in lines and no QR text', () => {
    const [page] = sheetPages(null, { back: false });
    wrap(<PrintFrontPage page={page} />);
    expect(screen.queryByText(/flight \d+/)).toBeNull();
    expect(screen.getByText('Date')).toBeInTheDocument();
    expect(screen.getAllByText('Cup ___')).toHaveLength(6);
  });
});

describe('PrintBackPage', () => {
  it('lists every ADV_GUIDANCE category with its D/Q line', () => {
    wrap(<PrintBackPage />);
    const heads = screen.getAllByRole('heading').map((h) => h.firstChild.textContent);
    expect(heads).toEqual(Object.values(ADV_GUIDANCE).map((g) => g.label));
    expect(screen.getByText(ADV_GUIDANCE.aroma.dq)).toBeInTheDocument();
    expect(screen.getAllByText('D/Q').length).toBeGreaterThanOrEqual(10);
    expect(within(screen.getAllByRole('heading')[0]).getByText('Aromatic')).toBeInTheDocument();
  });
});

describe('PrintBackPage scale', () => {
  it('puts 8 and 9 above the rule and 7.5 and 10 below, so no labels overlap', () => {
    const { container } = wrap(<PrintBackPage />);
    const above = [...container.querySelectorAll('[data-scale-row="above"]')].map((n) => n.textContent);
    const below = [...container.querySelectorAll('[data-scale-row="below"]')].map((n) => n.textContent);
    expect(above).toEqual(['8 clean', '9 great']);
    expect(below).toEqual(['7.5 some faults', "10 the best you've had"]);
  });
});

describe('PrintSheetsDialog', () => {
  // The printer gets the unscaled copy in the `.advanced-print-root` body portal; the dialog is the screen preview.
  const pagesIn = () => document.querySelectorAll('.advanced-print-root .advanced-print-page');
  const previewPages = () => document.querySelectorAll('.MuiDialog-root .advanced-print-page');

  it('renders one page per sheetPages entry and drops the backs when unticked', () => {
    wrap(<PrintSheetsDialog open flight={flight(13)} onClose={() => {}} />);
    expect(pagesIn()).toHaveLength(6);
    expect(previewPages()).toHaveLength(6);
    const box = screen.getByRole('checkbox', { name: 'Add the guidance page on the back' });
    expect(box).toBeChecked();
    fireEvent.click(box);
    expect(pagesIn()).toHaveLength(3);
    expect(previewPages()).toHaveLength(3);
  });

  it('has an accessible title and the copies hint', () => {
    wrap(<PrintSheetsDialog open flight={flight(2)} onClose={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'Print sheets' })).toBeInTheDocument();
    expect(screen.getByText('Set copies in the print dialog \u2014 one per taster.')).toBeInTheDocument();
  });

  it('calls window.print once on Print, and onClose on Close', () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    const onClose = vi.fn();
    wrap(<PrintSheetsDialog open flight={flight(2)} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    expect(print).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
    print.mockRestore();
  });

  it('prints the blank sheet with Cup ___ columns and no QR', () => {
    wrap(<PrintSheetsDialog open flight={null} onClose={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'Print a blank sheet' })).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getAllByText('Cup ___')).toHaveLength(6);
    expect(document.querySelector('svg[role="img"], .advanced-print-page canvas')).toBeNull();
  });

  // The print copy must be a plain block in normal flow straight under <body>: a named @page
  // (landscape) is ignored on out-of-flow boxes, and the dialog's own layout clipped pages.
  it('prints from a plain body portal outside every dialog', () => {
    wrap(<PrintSheetsDialog open flight={flight(2)} onClose={() => {}} />);
    const root = document.querySelector('.advanced-print-root');
    expect(root.parentElement).toBe(document.body);
    expect(root.closest('.MuiDialog-root')).toBeNull();
    expect(document.querySelector('.MuiDialog-root.advanced-print-root')).toBeNull();
  });

  // Chromium settles conflicting @page sizes by stylesheet order, and Cashout's global
  // `@page { size: Letter }` (portrait) loads after emotion's styles. The sheet's own @page
  // rules must be the LAST stylesheet while the dialog is open, and gone when it closes.
  it('appends the landscape @page rules last in <head> while open, and removes them on close', () => {
    const late = document.createElement('style');
    late.textContent = '@media print { @page { size: Letter; } }';
    document.head.appendChild(late);
    const { unmount } = wrap(<PrintSheetsDialog open flight={null} onClose={() => {}} />);
    const last = document.head.lastElementChild;
    expect(last.getAttribute('data-advanced-print-page')).not.toBeNull();
    expect(last.textContent).toMatch(/@page\s*\{[^}]*size:\s*letter landscape/);
    expect(last.textContent).toMatch(/@page advancedCuppingSheet\s*\{[^}]*size:\s*letter landscape/);
    unmount();
    expect(document.head.querySelector('[data-advanced-print-page]')).toBeNull();
    late.remove();
  });

  it('renders nothing when closed', () => {
    wrap(<PrintSheetsDialog open={false} flight={flight(2)} onClose={() => {}} />);
    expect(pagesIn()).toHaveLength(0);
  });
});

describe('PRINT_CSS', () => {
  const SHORTHANDS = new Set(['p', 'px', 'py', 'pt', 'pb', 'pl', 'pr', 'm', 'mx', 'my', 'mt', 'mb', 'ml', 'mr', 'bgcolor']);
  const keysDeep = (o) => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keysDeep(v) : [k]));

  it('uses only real CSS property names', () => {
    expect(keysDeep(PRINT_CSS).filter((k) => SHORTHANDS.has(k))).toEqual([]);
  });
  it('shows only the print root in print, and it is hidden on screen', () => {
    const print = PRINT_CSS['@media print'];
    expect(print['body > *:not(.advanced-print-root)'].display).toMatch(/^none/);
    expect(PRINT_CSS['.advanced-print-root'].display).toBe('none');
    expect(print['.advanced-print-root'].display).toMatch(/^block/);
    // No MUI dialog rule at all: every dialog (FlightDialog with the label key, the preview) stays hidden.
    expect(Object.keys(print).filter((k) => /MuiDialog|MuiBackdrop/.test(k))).toEqual([]);
  });
  it('asks the browser to print the band colours exactly', () => {
    const rule = PRINT_CSS['@media print']['.advanced-print-page, .advanced-print-page *'];
    expect(rule.printColorAdjust).toBe('exact');
    expect(rule.WebkitPrintColorAdjust).toBe('exact');
  });
  it('breaks between pages but not after the last, each on the named sheet page', () => {
    const print = PRINT_CSS['@media print'];
    expect(print['.advanced-print-page-wrap'].breakAfter).toBe('page');
    expect(print['.advanced-print-page-wrap:last-child'].breakAfter).toBe('auto');
    expect(print['.advanced-print-page-wrap'].page).toBe('advancedCuppingSheet');
  });
  it('declares the page size only in PAGE_CSS, so ordering is in one place', () => {
    expect(Object.keys(PRINT_CSS).filter((k) => k.startsWith('@page'))).toEqual([]);
    expect(PAGE_CSS).toMatch(/@page\s*\{[^}]*size:\s*letter landscape/);
    expect(PAGE_CSS).toMatch(/@page advancedCuppingSheet\s*\{[^}]*size:\s*letter landscape/);
  });
  it('prints without the screen-preview zoom', async () => {
    wrap(<PrintSheetsDialog open flight={flight(2)} onClose={() => {}} />);
    document.querySelectorAll('.advanced-print-root .advanced-print-page-wrap').forEach((w) => expect(w.style.zoom).toBe(''));
  });
});
