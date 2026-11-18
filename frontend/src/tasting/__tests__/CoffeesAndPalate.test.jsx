import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { Route } from 'react-router-dom';

const { api, auth } = vi.hoisted(() => ({
  api: {
    getCoffees: vi.fn(), getCoffee: vi.fn(), updateCoffee: vi.fn(), archiveCoffee: vi.fn(), unarchiveCoffee: vi.fn(), deleteTastings: vi.fn(),
    matchCoffee: vi.fn(), createCoffee: vi.fn(), getPalate: vi.fn(), getCoffeeSessions: vi.fn(),
  },
  auth: { role: 'member' },
}));
vi.mock('../tastingApi', () => ({ tastingApi: api, default: api }));
vi.mock('../../auth/AuthContext', async () => {
  const { authValue } = await import('./helpers');
  return { useAuth: () => authValue(auth) };
});

import CoffeesTab from '../coffees/CoffeesTab';
import CoffeePage from '../coffees/CoffeePage';
import PalateTab from '../palate/PalateTab';
import { sectionsFor, factChips, blankFacts, biasSentence, signed } from '../coffees/coffeeSupport';
import { renderAt, guji, lot as huila } from './helpers';

const B = 'Fruity>Berry>blueberry';
const winter = { id: 2, name: 'Winter Blend', roaster: 'Maple Roasters', kind: 'house', n: 2, basic_n: 2, cupping: null, avg_overall: null, top_terms: [], tasted_by_me: false, archived_at: null };
const lot = { ...huila, name: 'Kirinyaga AA', roaster: 'Ridge Roasters' };

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  auth.role = 'member';
});

describe('coffeeSupport', () => {
  it('sections by kind, and filters by roaster and tasted-by-me', () => {
    const s = sectionsFor([guji, winter, lot], { filter: 'all' });
    expect(s.map((x) => [x.label, x.rows.map((r) => r.name)])).toEqual([
      ['On bar', ['Guji Shakiso', 'Winter Blend']], ['Cupping lots', ['Kirinyaga AA']],
    ]);
    expect(sectionsFor([guji, winter, lot], { filter: 'roaster:Ridge Roasters' }).flatMap((x) => x.rows.map((r) => r.name))).toEqual(['Kirinyaga AA']);
    expect(sectionsFor([guji, winter, lot], { filter: 'mine' }).flatMap((x) => x.rows.map((r) => r.name))).toEqual(['Guji Shakiso']);
  });

  it('builds fact chips and names the first blanks', () => {
    const c = { roaster: 'Maple Roasters', origin: 'Ethiopia', process: 'natural', roast_level: 'med_dark', kind: 'house' };
    expect(factChips(c).map((f) => f.label)).toEqual(['Maple Roasters', 'Ethiopia', 'Natural', 'Med-dark roast', 'On bar here']);
    expect(blankFacts(c)).toEqual(['region', 'variety', 'altitude']);
  });

  it('words the bias', () => {
    expect(biasSentence(0.6)).toBe('You run a little generous.');
    expect(biasSentence(-0.6)).toBe('You run a little tough.');
    expect(biasSentence(0.1)).toBe("You're right on the room.");
    expect(signed(0.6)).toBe('+0.6');
    expect(signed(-1.25)).toBe('-1.3');
    expect(signed(null)).toBe('—');
  });
});

describe('CoffeesTab', () => {
  it('lists sections with descriptors above threshold and thin-data hints below, filters, and opens a page', async () => {
    api.getCoffees.mockResolvedValue({ coffees: [guji, winter, lot], roasters: ['Maple Roasters', 'Ridge Roasters'] });
    renderAt('/coffees', <>
      <Route path="/coffees" element={<CoffeesTab />} />
      <Route path="/coffees/:coffeeId" element={<div>page</div>} />
    </>);
    await screen.findByText('Guji Shakiso');
    expect(api.getCoffees).toHaveBeenCalledWith({ mine: true });
    expect(screen.getByText('On bar')).toBeInTheDocument();
    expect(within(screen.getByTestId('coffee-row-1')).getByText('blueberry')).toBeInTheDocument();
    expect(within(screen.getByTestId('coffee-row-2')).getByText('2 tastings — consensus at 3')).toBeInTheDocument();
    expect(within(screen.getByTestId('coffee-row-3')).getByText('not tasted yet')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tasted by me' }));
    expect(screen.queryByTestId('coffee-row-2')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('coffee-row-1'));
    await screen.findByText('page');
  });

  describe('two columns', () => {
    const show = async (coffee) => {
      api.getCoffees.mockResolvedValue({ coffees: [{ ...guji, ...coffee }], roasters: [] });
      renderAt('/coffees', <Route path="/coffees" element={<CoffeesTab />} />);
      await screen.findByTestId('coffee-row-1');
      return screen.getByTestId('coffee-row-1');
    };

    it('shows stars and cupping side by side, each labelled by kind', async () => {
      const row = await show({ basic_n: 11, avg_overall: 3.9, cupping: { n: 6, avg_total: 88.4, votes: null } });
      expect(within(row).getByText('3.9')).toBeInTheDocument();
      expect(within(row).getByText('88.4')).toBeInTheDocument();
      expect(within(row).getByText('Average stars')).toBeInTheDocument();
      expect(within(row).getByText('Cupping score')).toBeInTheDocument();
      expect(within(row).getByText('blueberry')).toBeInTheDocument();
    });

    it('dashes the stars column for a cupping-only coffee and drops the consensus hint', async () => {
      const row = await show({ n: 6, basic_n: 0, avg_overall: null, top_terms: [], cupping: { n: 6, avg_total: 88.4, votes: null } });
      expect(within(row).getAllByText('—')).toHaveLength(1);
      expect(within(row).getByText('88.4')).toBeInTheDocument();
      expect(within(row).queryByText(/consensus at/)).not.toBeInTheDocument();
    });

    it('dashes both columns under the consensus threshold with no cupping', async () => {
      const row = await show({ n: 8, basic_n: 2, avg_overall: 3.5, top_terms: [], cupping: null });
      expect(within(row).getAllByText('—')).toHaveLength(2);
      expect(within(row).queryByText('3.5')).not.toBeInTheDocument();
      expect(within(row).getByText('2 tastings — consensus at 3')).toBeInTheDocument();
    });

    it('says not tasted yet when nothing exists', async () => {
      const row = await show({ n: 0, basic_n: 0, avg_overall: null, top_terms: [], cupping: null });
      expect(within(row).getByText('not tasted yet')).toBeInTheDocument();
    });

    it('shows nothing under a tasted coffee with no basic tastings and no cupping total', async () => {
      const row = await show({ n: 5, basic_n: 0, avg_overall: null, top_terms: [], cupping: null });
      expect(within(row).queryByText('not tasted yet')).not.toBeInTheDocument();
      expect(within(row).queryByText(/consensus at/)).not.toBeInTheDocument();
    });

    it('ties each screen-reader label to its own number, with a space between', async () => {
      const row = await show({ basic_n: 11, avg_overall: 3.9, cupping: { n: 6, avg_total: 88.4, votes: null } });
      expect(within(row).getByText('Average stars').parentElement).toHaveTextContent(/^Average stars 3\.9$/);
      expect(within(row).getByText('Cupping score').parentElement).toHaveTextContent(/^Cupping score 88\.4$/);
    });

    it('reads no score to a screen reader for a missing value', async () => {
      const row = await show({ n: 6, basic_n: 0, avg_overall: null, top_terms: [], cupping: { n: 6, avg_total: 88.4, votes: null } });
      const stars = within(row).getByText('Average stars').parentElement;
      expect(stars).toHaveTextContent('Average stars');
      expect(stars).toHaveTextContent('no score');
      expect(within(row).getByText('Cupping score').parentElement).not.toHaveTextContent('no score');
    });

    it('titles the columns in every section', async () => {
      api.getCoffees.mockResolvedValue({ coffees: [guji, lot], roasters: [] });
      renderAt('/coffees', <Route path="/coffees" element={<CoffeesTab />} />);
      await screen.findByTestId('coffee-row-1');
      const sectionCount = screen.getAllByText('Stars').length;
      expect(sectionCount).toBeGreaterThanOrEqual(2);
      expect(screen.getAllByText('Cupping')).toHaveLength(sectionCount);
    });
  });

  it('adds a coffee and hands it to the Log tab', async () => {
    api.getCoffees.mockResolvedValue({ coffees: [], roasters: [] });
    api.matchCoffee.mockResolvedValue({ match: null });
    api.createCoffee.mockResolvedValue({ id: 77, name: 'New One', kind: 'house' });
    renderAt('/coffees', <>
      <Route path="/coffees" element={<CoffeesTab />} />
      <Route path="/log" element={<div>log-tab</div>} />
    </>);
    await screen.findByText('No coffees here yet.');
    fireEvent.click(screen.getAllByRole('button', { name: 'Add a coffee' })[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Add a coffee' });
    fireEvent.change(within(dialog).getByLabelText('Coffee name'), { target: { value: 'New One' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Add & taste it/ }));
    await waitFor(() => expect(api.createCoffee).toHaveBeenCalledWith({ name: 'New One', roaster: '', kind: 'house' }));
    await screen.findByText('log-tab');
  });
});

describe('CoffeePage', () => {
  const thick = {
    id: 1, name: 'Winter Blend', roaster: 'Maple Roasters', kind: 'house', origin: 'Brazil', process: 'natural', roast_level: 'medium',
    notes: 'Cocoa, caramel.', archived_at: null, n: 3,
    consensus: {
      n: 3, avg_overall: 3.6, spread: 0.6, histogram: [0, 0, 1, 2, 0], trend: 'steady over 6 weeks',
      profile: { acidity: { mean: 2.0, low: 1, high: 3, n: 3, word: 'mellow' }, sweetness: null, body: { mean: 4, low: 3, high: 5, n: 3, word: 'syrupy' }, balance: null },
      descriptors: [
        { term: 'a', label: 'dark chocolate', family: 'nutty', pct: 67 },
        { term: 'b', label: 'caramel', family: 'sweet', pct: 50 },
        { term: 'c', label: 'walnut', family: 'nutty', pct: 33 },
      ],
      sentence: 'Mostly dark chocolate.',
    },
    cupping: null,
    your_lean: null,
  };
  const CUP = { n: 6, avg_total: 88.4, votes: { yes: 3, maybe: 2, no: 1 } };
  const sess = (over = {}) => ({ flight_id: 41, date: '2026-11-05', name: null, prep: 'drip', sheet: 'basic', shared: false, yours: { scores: {}, overall: 4, terms: [], defects: [] }, room: null, reads: null, ...over });
  const mountPage = () => renderAt('/coffees/1', <Route path="/coffees/:coffeeId" element={<CoffeePage />} />);

  beforeEach(() => api.getCoffeeSessions.mockResolvedValue({ sessions: [], next_before: null }));

  it('shows the facts and the basic card, hides the pencil below editor, and drops the old sections', async () => {
    api.getCoffee.mockResolvedValue(thick);
    mountPage();
    await screen.findAllByText('Maple Roasters');
    expect(screen.getByText('Natural')).toBeInTheDocument();
    const basic = screen.getByTestId('basic-card');
    expect(within(basic).getByText('3.6 out of 5 · 3 reads')).toBeInTheDocument();
    expect(within(basic).getByText(/mellow/)).toBeInTheDocument();
    expect(within(basic).getByText(/syrupy/)).toBeInTheDocument();
    expect(within(basic).getByText('dark chocolate')).toBeInTheDocument();
    expect(within(basic).getByText('caramel')).toBeInTheDocument();
    expect(within(basic).queryByText('walnut')).not.toBeInTheDocument();   // top two only
    expect(screen.queryByLabelText('Star histogram')).not.toBeInTheDocument();
    expect(screen.queryByText('What the room tastes')).not.toBeInTheDocument();
    expect(screen.queryByText('Tastings')).not.toBeInTheDocument();
    expect(screen.queryByTestId('your-read')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit details' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Taste this coffee' })).toBeInTheDocument();
  });

  it('shows the cuppings card with its room votes, and dashes it with no cupping', async () => {
    api.getCoffee.mockResolvedValue({ ...thick, cupping: CUP });
    const { unmount } = mountPage();
    const card = await screen.findByTestId('cupping-card');
    expect(within(card).getByText('88.4 out of 100 · 6 reads')).toBeInTheDocument();
    expect(within(card).getByText('Advanced')).toBeInTheDocument();
    expect(screen.getByText('3 yes · 2 maybe · 1 no')).toBeInTheDocument();
    unmount();
    api.getCoffee.mockResolvedValue(thick);
    mountPage();
    const empty = await screen.findByTestId('cupping-card');
    expect(within(empty).getByText('—')).toBeInTheDocument();
    expect(screen.queryByText(/ yes · /)).not.toBeInTheDocument();
  });

  it('dashes the basic card when there are no basic tastings', async () => {
    api.getCoffee.mockResolvedValue({ ...thick, n: 0, consensus: null, cupping: CUP });
    mountPage();
    const card = await screen.findByTestId('basic-card');
    expect(within(card).getByText('—')).toBeInTheDocument();
  });

  it('shows the thin-data note under threshold, with the privacy line only without a cupping', async () => {
    api.getCoffee.mockResolvedValue({ ...thick, n: 2, consensus: null, cupping: null });
    const { unmount } = mountPage();
    expect(await screen.findByText(/2 tastings so far/)).toHaveTextContent('Individual reads stay private until then.');
    unmount();
    api.getCoffee.mockResolvedValue({ ...thick, n: 0, consensus: null, cupping: CUP });
    mountPage();
    await screen.findByText('88.4 out of 100 · 6 reads');
    expect(screen.queryByText(/Individual reads stay private/)).not.toBeInTheDocument();
    expect(screen.queryByText(/0 tastings so far/)).not.toBeInTheDocument();
  });

  it('shows the lean card on each scale without combining them, and hides it when null', async () => {
    api.getCoffee.mockResolvedValue({ ...thick, your_lean: { advanced: { total: 2.1, top: [{ category: 'aroma', diff: 0.8 }, { category: 'acidity', diff: -0.6 }] }, basic: { overall: -0.4 } } });
    const { unmount } = mountPage();
    const card = await screen.findByTestId('lean-card');
    expect(card).toHaveTextContent('+2.1 points on the cupping sheet');
    expect(card).toHaveTextContent('Aroma');
    expect(card).toHaveTextContent('−0.4 ★ overall');
    unmount();
    api.getCoffee.mockResolvedValue({ ...thick, your_lean: { advanced: null, basic: { overall: 0.5 } } });
    const again = mountPage();
    const basicOnly = await screen.findByTestId('lean-card');
    expect(basicOnly).toHaveTextContent('+0.5 ★ overall');
    expect(basicOnly).not.toHaveTextContent('cupping sheet');
    again.unmount();
    api.getCoffee.mockResolvedValue({ ...thick, your_lean: { advanced: null, basic: null } });
    mountPage();
    await screen.findByTestId('basic-card');
    expect(screen.queryByTestId('lean-card')).not.toBeInTheDocument();
    expect(screen.queryByText('You vs everyone else')).not.toBeInTheDocument();
  });

  it('keeps the coffee shown after saving Edit details, and shows the error when the reload fails', async () => {
    auth.role = 'editor';
    api.getCoffee.mockResolvedValueOnce(thick).mockRejectedValue(new Error('boom'));
    api.updateCoffee.mockResolvedValue({ ...thick, origin: 'Colombia' });
    mountPage();
    await screen.findAllByText('Maple Roasters');
    fireEvent.click(screen.getByRole('button', { name: 'Edit details' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit details' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save details' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
  });

  it('lets an editor edit and archive', async () => {
    auth.role = 'editor';
    const thin = { ...thick, n: 2, consensus: null };
    api.updateCoffee.mockResolvedValue({ ...thin, origin: 'Colombia' });
    // Every save reloads the page body: edit first, then archive.
    api.getCoffee.mockResolvedValueOnce(thin)
      .mockResolvedValueOnce({ ...thin, origin: 'Colombia' })
      .mockResolvedValue({ ...thin, origin: 'Colombia', archived_at: '2026-09-10T00:00:00' });
    api.archiveCoffee.mockResolvedValue({ ...thin, archived_at: '2026-09-10T00:00:00' });
    mountPage();
    await screen.findByText(/2 tastings so far/);
    fireEvent.click(screen.getByRole('button', { name: 'Edit details' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit details' });
    fireEvent.change(within(dialog).getByLabelText('Origin'), { target: { value: 'Colombia' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save details' }));
    await waitFor(() => expect(api.updateCoffee).toHaveBeenCalledWith(1, expect.objectContaining({ origin: 'Colombia', process: 'natural' })));
    await screen.findByText('Colombia');
    // The dialog's exit transition keeps the page aria-hidden for a beat.
    fireEvent.click(await screen.findByRole('button', { name: 'Edit details' }));
    fireEvent.click(await screen.findByText('Archive this coffee'));
    fireEvent.click(await screen.findByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(api.archiveCoffee).toHaveBeenCalledWith(1));
    await screen.findByText('Archived — kept for its history, off the picker');
    expect(screen.queryByRole('button', { name: 'Taste this coffee' })).not.toBeInTheDocument();
  });

  it('deletes a read from a session through the confirm, then reloads the coffee and the sessions', async () => {
    api.getCoffee.mockResolvedValue(thick);
    api.getCoffeeSessions.mockResolvedValue({ sessions: [sess()], next_before: null });
    api.deleteTastings.mockResolvedValue({ deleted: 1, flight_deleted: true });
    mountPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete your read' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.deleteTastings).toHaveBeenCalledWith(41, {}));
    await waitFor(() => expect(api.getCoffee).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(api.getCoffeeSessions).toHaveBeenCalledTimes(2));
  });

  it('keeps the page and shows an inline alert when a delete fails', async () => {
    api.getCoffee.mockResolvedValue(thick);
    api.getCoffeeSessions.mockResolvedValue({ sessions: [sess()], next_before: null });
    api.deleteTastings.mockRejectedValue(new Error('boom'));
    mountPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete your read' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/delete that tasting|boom/i);
    expect(screen.getByRole('button', { name: 'Delete your read' })).toBeInTheDocument();
    expect(screen.getByText(thick.name)).toBeInTheDocument();
  });

  it('lets an editor delete someone else\'s solo read by taster key', async () => {
    auth.role = 'editor';
    api.getCoffee.mockResolvedValue(thick);
    api.getCoffeeSessions.mockResolvedValue({ sessions: [sess({ flight_id: 40, yours: null, reads: [{ taster_key: 'user:kel', taster_name: 'Robin', overall: 4, terms: [], scores: {}, defects: [] }] })], next_before: null });
    api.deleteTastings.mockResolvedValue({ deleted: 1, flight_deleted: true });
    mountPage();
    fireEvent.click(await screen.findByRole('button', { name: "Delete Robin's read" }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.deleteTastings).toHaveBeenCalledWith(40, { tasterKey: 'user:kel' }));
  });

  it('lets an editor unarchive from the same dialog', async () => {
    auth.role = 'editor';
    const archived = { ...thick, archived_at: '2026-09-10T00:00:00' };
    api.getCoffee.mockResolvedValueOnce(archived).mockResolvedValue({ ...archived, archived_at: null });
    api.unarchiveCoffee.mockResolvedValue({ ...archived, archived_at: null });
    mountPage();
    await screen.findByText('Archived — kept for its history, off the picker');
    fireEvent.click(screen.getByRole('button', { name: 'Edit details' }));
    fireEvent.click(await screen.findByText('Put it back on the picker'));
    await waitFor(() => expect(api.unarchiveCoffee).toHaveBeenCalledWith(1));
    await waitFor(() => expect(screen.queryByText('Archived — kept for its history, off the picker')).not.toBeInTheDocument());
  });
});

const NO_CUPPING = { reads: 0, coffees: 0, open_reads: 0, lean: {}, lean_mean: null, lean_coffees: 0, votes: { yes: 0, maybe: 0, no: 0 }, room_yes_share: null, cups: [] };
const BASIC = {
  tastings: 62, coffees: 27, terms_used: 31, specific_terms: 14, bias: 0.6, bias_coffees: 27,
  gap_series: [{ month: '2026-04', gap: 1.2, n: 3 }, { month: '2026-09', gap: 0.4, n: 2 }],
  coffees_tasted: [{ coffee_id: 1, name: 'Winter Blend', roaster: 'Maple Roasters', kind: 'house', reads: 5, yours: 3.7, theirs: 3.55, others_n: 4 },
    { coffee_id: 3, name: 'La Palma', roaster: 'Broadsheet', kind: 'external', reads: 1, yours: 3.0, theirs: null, others_n: 0 }],
};
const NO_BASIC = { tastings: 0, coffees: 0, terms_used: 0, specific_terms: 0, bias: null, bias_coffees: 0, gap_series: [], coffees_tasted: [] };
const CUPS = Array.from({ length: 46 }, (_, i) => ({ coffee_id: 100 + i, name: `Lot ${i}`, roaster: 'RFP', flight_id: 9, date: `${new Date().getFullYear()}-11-05`, total: 85 + (i % 5) / 2, room_total: i === 0 ? null : 84.2 }));
const CUPPING = {
  reads: 46, coffees: 46, open_reads: 0, lean: { aroma: 0.3, flavour: -0.3 }, lean_mean: 0.4, lean_coffees: 45,
  votes: { yes: 20, maybe: 10, no: 16 }, room_yes_share: 0.5, cups: CUPS,
};
const mountPalate = (body) => {
  api.getPalate.mockResolvedValueOnce(body);
  return renderAt('/palate', <>
    <Route path="/palate" element={<PalateTab />} />
    <Route path="/coffees/:coffeeId" element={<div>page</div>} />
  </>);
};

describe('PalateTab', () => {
  it('shows one message when there is nothing of either kind', async () => {
    mountPalate({ ...NO_BASIC, cupping: NO_CUPPING });
    await screen.findByText('Nothing here yet.');
  });

  it('shows both summary cards and both sections, and basic rows still navigate', async () => {
    mountPalate({ ...BASIC, cupping: CUPPING });
    await screen.findByText('Cuppings', { selector: 'span' });
    expect(screen.getByText('Basic tastings', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Basic tastings' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Cuppings' })).toBeInTheDocument();
    expect(screen.getByTestId('bias')).toHaveTextContent('+0.6');
    expect(screen.getByText('You run a little generous.')).toBeInTheDocument();
    expect(screen.getByText('Your overall vs. everyone else\'s on the same coffee, 27 coffees. Context, not a grade.')).toBeInTheDocument();
    expect(screen.getByTestId('gap-line')).toBeInTheDocument();
    expect(screen.getByText('Broadsheet · elsewhere · 1 read')).toBeInTheDocument();
    expect(screen.getByText('vs —')).toBeInTheDocument();
    expect(screen.getByText('20 yes · 10 maybe · 16 no')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('palate-coffee-1'));
    await screen.findByText('page');
  });

  it('lists every cup with the room total and opens the coffee page', async () => {
    mountPalate({ ...BASIC, cupping: CUPPING });
    await screen.findByTestId('palate-cup-100-9');
    expect(screen.getAllByTestId(/^palate-cup-/)).toHaveLength(46);
    const nullRoom = screen.getByTestId('palate-cup-100-9');
    expect(within(nullRoom).getByText('—')).toBeInTheDocument();
    expect(within(nullRoom).getAllByTestId(/^marker-/)).toHaveLength(1);
    const withRoom = screen.getByTestId('palate-cup-101-9');
    expect(within(withRoom).getByText('room 84.2')).toBeInTheDocument();
    expect(within(withRoom).getByText('RFP · Nov 5')).toBeInTheDocument();
    fireEvent.click(withRoom);
    await screen.findByText('page');
  });

  it('with cups only, shows a short basic line and no old log-a-flight text', async () => {
    mountPalate({ ...NO_BASIC, cupping: CUPPING });
    await screen.findByText('No basic tastings yet.');
    expect(screen.queryByTestId('gap-line')).not.toBeInTheDocument();
    expect(screen.queryByText(/Log a flight from your own phone/)).not.toBeInTheDocument();
    expect(screen.getAllByTestId(/^palate-cup-/)).toHaveLength(46);
    expect(screen.getByText('Basic tastings', { selector: 'span' }).parentElement).toHaveTextContent('Not yet');
  });

  it('words the room vote as a share of the coffees it could compare', async () => {
    mountPalate({ ...BASIC, cupping: CUPPING });
    await screen.findByText('The room voted yes 50% of the time on the coffees it could compare.');
  });

  it('shows the year on a cup from another year', async () => {
    const cups = [{ ...CUPS[1], date: '2025-11-05' }];
    mountPalate({ ...BASIC, cupping: { ...CUPPING, cups } });
    const row = await screen.findByTestId(`palate-cup-${CUPS[1].coffee_id}-9`);
    expect(within(row).getByText('RFP · Nov 5, 2025')).toBeInTheDocument();
  });

  it('does not read Not yet on the Cuppings card when you have reads but no room to compare', async () => {
    mountPalate({ ...BASIC, cupping: { ...CUPPING, lean: {}, lean_mean: null, lean_coffees: 0 } });
    await screen.findAllByTestId(/^palate-cup-/);
    const card = screen.getByText('Cuppings', { selector: 'span' }).parentElement;
    expect(card).toHaveTextContent('—');
    expect(card).toHaveTextContent('Needs 3 others on a coffee');
    expect(card).not.toHaveTextContent('Not yet');
  });

  it('captions the Cuppings card with the coffees that gave the lean', async () => {
    mountPalate({ ...BASIC, cupping: CUPPING });
    await screen.findAllByTestId(/^palate-cup-/);
    expect(screen.getByText('Cuppings', { selector: 'span' }).parentElement).toHaveTextContent('45 coffees · per category');
  });

  it('renders when the server has no cupping block yet', async () => {
    mountPalate({ ...BASIC });
    await screen.findByText('No cuppings yet.');
    expect(screen.getByTestId('bias')).toHaveTextContent('+0.6');
  });

  it('with basic only, shows a short cupping line and an em dash card', async () => {
    mountPalate({ ...BASIC, cupping: NO_CUPPING });
    await screen.findByText('No cuppings yet.');
    expect(screen.getByText('Cuppings', { selector: 'span' }).parentElement).toHaveTextContent('Not yet');
  });

  it('tells a cupper with only an open cupping to wait for it to close', async () => {
    mountPalate({ ...BASIC, cupping: { ...NO_CUPPING, open_reads: 10 } });
    await screen.findByText('Your cupping scores show here once the cupping closes.');
  });
});
