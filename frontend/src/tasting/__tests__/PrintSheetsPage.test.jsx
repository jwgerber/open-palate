/** The new-tab print route: /print/sheets/:flightId ("blank" or a flight id). */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const { api } = vi.hoisted(() => ({ api: { getFlight: vi.fn() } }));
vi.mock('../tastingApi', () => ({ tastingApi: api, default: api }));

import PrintSheetsPage from '../print/PrintSheetsPage';
import { sheetsLink, blankSheetsLink } from '../log/shareSupport';

// A blind flight as the server sends it: the cup's coffee `name` is null until the flight closes.
const blindFlight = (over = {}) => ({
  id: 12, name: 'Fall importer samples', sheet: 'advanced', is_open: true, is_blind: true, adv_step: 0.5,
  store_name: 'Central', opened_at: '2026-11-05T15:00:00',
  cups: ['A', 'B', 'C'].map((l, i) => ({ position: i + 1, label: `Cup ${l}`, blind_label: `Cup ${l}`, name: null, roaster: null, blind: true })),
  ...over,
});
const closedBlind = () => blindFlight({
  is_open: false,
  cups: ['A', 'B'].map((l, i) => ({ position: i + 1, label: i ? 'Huila Sample 3' : 'Guji Shakiso', blind_label: `Cup ${l}`, name: i ? 'Huila Sample 3' : 'Guji Shakiso', roaster: 'Onyx', blind: true })),
});

const renderAt = (id) => render(
  <MemoryRouter initialEntries={[`/print/sheets/${id}`]}>
    <Routes>
      <Route path="/print/sheets/:flightId" element={<PrintSheetsPage />} />
      <Route path="/log" element={<div>log-page</div>} />
    </Routes>
  </MemoryRouter>,
);
const pages = () => document.querySelectorAll('.advanced-print-page');

beforeEach(() => { api.getFlight.mockReset(); });
afterEach(() => vi.restoreAllMocks());

describe('share links', () => {
  it('build the print route', () => {
    expect(sheetsLink(12)).toMatch(/\/print\/sheets\/12$/);
    expect(blankSheetsLink()).toMatch(/\/print\/sheets\/blank$/);
  });
});

describe('PrintSheetsPage', () => {
  it('blank renders the blank sheet without fetching', async () => {
    renderAt('blank');
    expect(await screen.findByRole('dialog', { name: 'Print a blank sheet' })).toBeInTheDocument();
    expect(pages().length).toBeGreaterThan(0);
    expect(api.getFlight).not.toHaveBeenCalled();
  });

  it('an id fetches the flight and renders its cup labels', async () => {
    api.getFlight.mockResolvedValue(blindFlight());
    renderAt('12');
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(await screen.findByRole('dialog', { name: 'Print sheets' })).toBeInTheDocument();
    expect(api.getFlight).toHaveBeenCalledWith(12);
    expect(screen.getAllByText('Cup A').length).toBeGreaterThan(0);
  });

  it('titles the tab after the flight and restores it on leaving', async () => {
    document.title = 'Open Palate';
    api.getFlight.mockResolvedValue(blindFlight());
    const { unmount } = renderAt('12');
    await screen.findByRole('dialog', { name: 'Print sheets' });
    expect(document.title).toBe('Print sheets — Fall importer samples');
    unmount();
    expect(document.title).toBe('Open Palate');
  });

  it('refuses a closed flight: alert, no print content, no coffee names', async () => {
    api.getFlight.mockResolvedValue(closedBlind());
    renderAt('12');
    expect(await screen.findByText('These sheets are only for an open Advanced cupping.')).toBeInTheDocument();
    expect(pages()).toHaveLength(0);
    expect(screen.queryByText('Guji Shakiso')).toBeNull();
    expect(screen.getByRole('link', { name: /back to the log/i })).toHaveAttribute('href', expect.stringMatching(/\/log$/));
  });

  it('refuses a flight that is not a Advanced sheet', async () => {
    api.getFlight.mockResolvedValue(blindFlight({ sheet: 'basic' }));
    renderAt('12');
    expect(await screen.findByText('These sheets are only for an open Advanced cupping.')).toBeInTheDocument();
    expect(pages()).toHaveLength(0);
  });

  it('shows the server error and no pages when the fetch fails', async () => {
    api.getFlight.mockRejectedValue({ response: { data: { error: 'Flight not found' } } });
    renderAt('12');
    expect(await screen.findByText('Flight not found')).toBeInTheDocument();
    expect(pages()).toHaveLength(0);
    expect(screen.getByRole('link', { name: /back to the log/i })).toBeInTheDocument();
  });

  it('a non-integer id never calls getFlight', async () => {
    renderAt('12abc');
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(api.getFlight).not.toHaveBeenCalled();
    expect(pages()).toHaveLength(0);
  });

  it('Close closes the tab, then falls back to the log', async () => {
    const close = vi.spyOn(window, 'close').mockImplementation(() => {});
    renderAt('blank');
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
    expect(close).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByText('log-page')).toBeInTheDocument());
  });
});
