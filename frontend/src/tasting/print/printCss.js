// Real CSS property names only: GlobalStyles is plain emotion, so sx shorthands (p, bgcolor) are dropped.
// The printer gets ONLY `.advanced-print-root`, a plain block portal straight under <body> holding the
// unscaled pages. Every MUI Dialog, Drawer and Snackbar is also a portal under <body> — the preview
// dialog, and an open FlightDialog that may be showing the blind label key — so print hides every
// body child but the print root. The pages sit in plain normal flow because printing the dialog
// itself (fixed, flex, full height) clipped pages.
// Page size lives in PAGE_CSS, not here: Cashout's print sheets declare a global
// `@page { size: Letter }` (portrait) that stays loaded once that chunk has been visited. In
// Chromium print-to-PDF probes our @page rules, named or not, lost to it from emotion's early
// <head> tags and won once appended after it, so PrintSheetsDialog appends PAGE_CSS as the LAST
// stylesheet while it is open.
export const PAGE_CSS = '@page { size: letter landscape; margin: 0; }\n'
  + '@page advancedCuppingSheet { size: letter landscape; margin: 0; }';

export const PRINT_CSS = {
  '.advanced-print-root': { display: 'none' },
  '@media print': {
    'body > *:not(.advanced-print-root)': { display: 'none !important' },
    body: { overflow: 'visible !important', margin: '0 !important' },
    '.advanced-print-root': { display: 'block !important' },
    '.advanced-print-page-wrap': {
      page: 'advancedCuppingSheet', breakAfter: 'page', overflow: 'hidden', height: '8.49in', width: '11in',
    },
    '.advanced-print-page-wrap:last-child': { breakAfter: 'auto' },
    // The grey group bands are backgrounds; ask for them even with "Background graphics" off.
    '.advanced-print-page, .advanced-print-page *': { printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' },
  },
};
