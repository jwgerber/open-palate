/** Scan step in paper entry: photograph a Advanced sheet, pre-fill, confirm the taster, check flags, save. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { api, shrink } = vi.hoisted(() => ({
  api: { enterPaperSheet: vi.fn(), getMembers: vi.fn(), scanPaperSheet: vi.fn() },
  shrink: vi.fn(),
}));
vi.mock('../tastingApi', () => ({ tastingApi: api, default: api }));
const { online } = vi.hoisted(() => ({ online: { v: true } }));
vi.mock('../../common/useOnline', () => ({ useOnline: () => online.v }));
vi.mock('../paper/shrinkPhoto', () => ({ shrinkPhoto: shrink }));

import PaperEntryDialog from '../paper/PaperEntryDialog';

const cup = (p) => ({ position: p, label: `Cup ${String.fromCharCode(64 + p)}`, blind: false, coffee_id: p, name: `Coffee ${p}`, roaster: 'Maple Roasters' });
const FLIGHT = {
  id: 9, name: 'Thursday cupping', prep: 'cupping', sheet: 'advanced', adv_step: 0.5, is_shared: true, is_blind: false, is_host: true, is_open: true,
  roster: [], logged_count: 0, cups: [1, 2].map(cup),
};
const BIG = { ...FLIGHT, cups: [1, 2, 3, 4, 5, 6, 7].map(cup) };
const MEMBERS = [{ id: 5, name: 'Sam Rivera', first_name: 'Sam' }, { id: 6, name: 'Ana Ruiz', first_name: 'Ana' }];
const ALL = ['aroma', 'flavour', 'aftertaste', 'acidity', 'sweetness', 'bitterness', 'weight', 'texture', 'afterfeel', 'balance'];
const fullScores = (v = 8.5) => Object.fromEntries(ALL.map((c) => [c, v]));
const SCAN = (over = {}) => ({ taster: { read_name: 'Sam' }, cups: [{ position: 1, scores: fullScores(), vote: 'yes', tags: {}, defects: [], note: '', unread: [] }], warnings: [], ...over });
const photo = (n = 'a.jpg') => new File(['x'], n, { type: 'image/jpeg' });
const pick = (...files) => fireEvent.change(screen.getByTestId('scan-input'), { target: { files } });

beforeEach(() => {
  online.v = true;
  Object.values(api).forEach((f) => f.mockReset());
  shrink.mockReset().mockImplementation(async (f) => new Blob([f.name], { type: 'image/jpeg' }));
  api.getMembers.mockResolvedValue(MEMBERS);
  api.enterPaperSheet.mockResolvedValue({ taster_key: 'paper:5', taster_name: 'Sam Rivera', count: 1 });
  api.scanPaperSheet.mockResolvedValue(SCAN());
});

const setup = (props = {}) => {
  render(<PaperEntryDialog open flight={FLIGHT} memberId={3} onClose={() => {}} onSaved={() => {}} {...props} />);
};

describe('paper scan', () => {
  it('scan, confirm suggested taster, and save posts the scanned entries', async () => {
    const onSaved = vi.fn();
    setup({ onSaved });
    pick(photo());
    expect(await screen.findByText('From the sheet: Sam')).toBeInTheDocument();
    expect(api.scanPaperSheet).toHaveBeenCalledTimes(1);
    expect(api.scanPaperSheet.mock.calls[0][0]).toBe(9);
    expect(api.scanPaperSheet.mock.calls[0][1]).toMatchObject({ memberId: 3 });
    fireEvent.click(await screen.findByRole('button', { name: 'Use Sam Rivera' }));
    expect(screen.getByRole('heading', { name: 'Paper sheet · Sam Rivera' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^All 2/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save 1 cup' }));
    await waitFor(() => expect(api.enterPaperSheet).toHaveBeenCalledTimes(1));
    const [id, body] = api.enterPaperSheet.mock.calls[0];
    expect(id).toBe(9);
    expect(body.tasterMemberId).toBe(5);
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]).toMatchObject({ position: 1, bar_vote: 'yes' });
    ALL.forEach((c) => expect(body.entries[0][c]).toBe(8.5));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('an unread category keeps Save disabled and says what could not be read', async () => {
    const scores = fullScores(); delete scores.aroma;
    api.scanPaperSheet.mockResolvedValue(SCAN({ cups: [{ position: 1, scores, vote: null, tags: {}, defects: [], note: '', unread: ['aroma', 'vote'] }] }));
    setup();
    pick(photo());
    fireEvent.click(await screen.findByRole('button', { name: 'Use Sam Rivera' }));
    expect(screen.getByText("Couldn't read: Aroma, On bar? — check the sheet.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^All 2/ }));
    expect(await screen.findByRole('button', { name: 'Save 0 cups' })).toBeDisabled();
  });

  it('an unmatched read name pre-fills the guest field', async () => {
    api.scanPaperSheet.mockResolvedValue(SCAN({ taster: { read_name: 'Zed Quill' } }));
    setup();
    pick(photo());
    expect(await screen.findByText('From the sheet: Zed Quill')).toBeInTheDocument();
    expect(screen.getByLabelText('Someone else (guest)')).toHaveValue('Zed Quill');
    expect(screen.queryByRole('button', { name: /^Use Zed/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Use this name' }));
    expect(screen.getByRole('heading', { name: 'Paper sheet · Zed Quill' })).toBeInTheDocument();
  });

  it('a 2-page cupping asks for page 2 before reading', async () => {
    setup({ flight: BIG });
    const read = screen.getByRole('button', { name: 'Read the sheet' });
    expect(read).toBeDisabled();
    pick(photo('p1.jpg'));
    expect(await screen.findByText(/Photo of page 1/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add page 2' })).toBeInTheDocument();
    expect(api.scanPaperSheet).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Read the sheet' })).toBeEnabled();
    pick(photo('p2.jpg'));
    fireEvent.click(screen.getByRole('button', { name: 'Read the sheet' }));
    await waitFor(() => expect(api.scanPaperSheet).toHaveBeenCalledTimes(1));
    expect(api.scanPaperSheet.mock.calls[0][1].photos).toHaveLength(2);
  });

  it('shows each scan warning on the taster screen', async () => {
    api.scanPaperSheet.mockResolvedValue(SCAN({ warnings: ['Photo 2 is from cupping 4, not this one — skipped.', 'Two photos of page 1 — used the first.'] }));
    setup();
    pick(photo());
    const a = await screen.findByText('Photo 2 is from cupping 4, not this one — skipped.');
    expect(a.closest('.MuiAlert-root')).toHaveClass('MuiAlert-standardInfo');
    expect(screen.getByText('Two photos of page 1 — used the first.').closest('.MuiAlert-root')).toHaveClass('MuiAlert-standardInfo');
  });

  it('a 503 shows the server message and typing in still works', async () => {
    api.scanPaperSheet.mockRejectedValue({ response: { status: 503, data: { error: "Couldn't read the photo right now — type the sheet in instead." } } });
    setup();
    pick(photo());
    expect(await screen.findByText("Couldn't read the photo right now — type the sheet in instead.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Someone else (guest)'), { target: { value: 'Sam' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use this name' }));
    expect(screen.getByRole('heading', { name: 'Paper sheet · Sam' })).toBeInTheDocument();
  });

  it('an unreadable photo file shows a friendly message and sends nothing', async () => {
    shrink.mockRejectedValue(new DOMException('bad', 'InvalidStateError'));
    setup();
    pick(photo());
    expect(await screen.findByText("Couldn't open that photo — try another, or type the sheet in.")).toBeInTheDocument();
    expect(api.scanPaperSheet).not.toHaveBeenCalled();
  });

  it('a second scan replaces the first fill', async () => {
    setup();
    pick(photo());
    await screen.findByText('From the sheet: Sam');
    api.scanPaperSheet.mockResolvedValue(SCAN({ cups: [{ position: 1, scores: fullScores(9), vote: 'no', tags: {}, defects: [], note: '', unread: [] }] }));
    pick(photo('b.jpg'));
    await waitFor(() => expect(api.scanPaperSheet).toHaveBeenCalledTimes(2));
    fireEvent.click(await screen.findByRole('button', { name: 'Use Sam Rivera' }));
    fireEvent.click(screen.getByRole('button', { name: /^All 2/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save 1 cup' }));
    await waitFor(() => expect(api.enterPaperSheet).toHaveBeenCalled());
    expect(api.enterPaperSheet.mock.calls[0][1].entries[0]).toMatchObject({ aroma: 9, bar_vote: 'no' });
  });

  it('the file input offers camera and library (no capture attribute)', () => {
    setup();
    const input = screen.getByTestId('scan-input');
    expect(input).toHaveAttribute('accept', 'image/*');
    expect(input).not.toHaveAttribute('capture');
  });

  it('a scanned draft asks before discarding', async () => {
    const onClose = vi.fn();
    setup({ onClose });
    pick(photo());
    fireEvent.click(await screen.findByRole('button', { name: 'Use Sam Rivera' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(await screen.findByText('Discard this paper sheet? Nothing has been saved.')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a re-scan clears cups the second scan did not return', async () => {
    api.scanPaperSheet.mockResolvedValueOnce(SCAN({ cups: [1, 2].map((p) => ({ position: p, scores: fullScores(), vote: 'yes', tags: {}, defects: [], note: '', unread: [] })) }));
    setup();
    pick(photo());
    await screen.findByText('From the sheet: Sam');
    pick(photo('b.jpg')); // default mock: cup 1 only
    await waitFor(() => expect(api.scanPaperSheet).toHaveBeenCalledTimes(2));
    fireEvent.click(await screen.findByRole('button', { name: 'Use Sam Rivera' }));
    fireEvent.click(screen.getByRole('button', { name: /^All 2/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save 1 cup' }));
    await waitFor(() => expect(api.enterPaperSheet).toHaveBeenCalled());
    expect(api.enterPaperSheet.mock.calls[0][1].entries).toHaveLength(1);
  });

  it('locks the tiles and guest button while reading', async () => {
    let finish;
    api.scanPaperSheet.mockReturnValue(new Promise((r) => { finish = r; }));
    setup();
    await screen.findByRole('button', { name: 'Ana' });
    fireEvent.change(screen.getByLabelText('Someone else (guest)'), { target: { value: 'Zed' } });
    pick(photo());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Ana' })).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Use this name' })).toBeDisabled();
    finish(SCAN());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Ana' })).toBeEnabled());
  });

  it('drops a Couldn\'t read item once the host fills it', async () => {
    const scores = fullScores(); delete scores.aroma;
    api.scanPaperSheet.mockResolvedValue(SCAN({ cups: [{ position: 1, scores, vote: null, tags: {}, defects: [], note: '', unread: ['aroma', 'vote'] }] }));
    setup();
    pick(photo());
    fireEvent.click(await screen.findByRole('button', { name: 'Use Sam Rivera' }));
    expect(screen.getByText("Couldn't read: Aroma, On bar? — check the sheet.")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByTestId('advanced-slider-aroma'), { key: 'ArrowRight' });
    expect(screen.getByText("Couldn't read: On bar? — check the sheet.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /Yes/ }));
    expect(screen.queryByText(/Couldn't read/)).toBeNull();
  });

  it('offline disables scanning and says why', () => {
    online.v = false;
    setup();
    expect(screen.getByRole('button', { name: 'Scan the sheet' })).toBeDisabled();
    expect(screen.getByText('Scanning needs a connection.')).toBeInTheDocument();
  });

  it('a roster that arrives after the scan upgrades the suggestion to a match', async () => {
    let load;
    api.getMembers.mockReturnValue(new Promise((r) => { load = r; }));
    setup();
    pick(photo());
    expect(await screen.findByText('From the sheet: Sam')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use Sam Rivera' })).toBeNull();
    load(MEMBERS);
    expect(await screen.findByRole('button', { name: 'Use Sam Rivera' })).toBeInTheDocument();
  });
});
