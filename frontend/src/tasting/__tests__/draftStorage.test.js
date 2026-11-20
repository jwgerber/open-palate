import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { DRAFT_TTL_MS, isWorthKeeping, loadDraft, removeDraft, saveDraft, slotOf } from '../log/draftStorage';
import { initialDraft, reducer } from '../log/flightDraft';

const guji = { id: 1, name: 'Guji Shakiso', roaster: 'Maple Roasters', kind: 'house' };
const inProgress = (over = {}) => ({ ...initialDraft(), screen: 'entry', picked: [guji], ...over });

beforeEach(() => localStorage.clear());
afterEach(() => vi.useRealTimers());

describe('what is worth keeping', () => {
  it('keeps a flight with cups that has not been logged', () => {
    expect(isWorthKeeping(inProgress())).toBe(true);
  });
  it.each([
    ['the landing page', { screen: 'landing' }],
    ['no cups picked', { picked: [] }],
    ['an already logged flight', { logged: true }],
    ['the reveal', { screen: 'reveal' }],
  ])('skips %s', (_name, over) => {
    expect(isWorthKeeping(inProgress(over))).toBe(false);
  });
});

describe('saving and loading', () => {
  it('round-trips the scores, screen and current cup', () => {
    const draft = reducer(inProgress({ cur: 0 }), { type: 'val', coffeeId: 1, attr: 'overall', value: 4 });
    saveDraft('u-1', draft);
    const loaded = loadDraft('u-1');
    expect(loaded.entries[1].vals.overall).toBe(4);
    expect(loaded.screen).toBe('entry');
    expect(loaded.picked).toEqual([guji]);
  });

  it('drops tags the lexicon no longer has', () => {
    const entry = { vals: {}, tags: { 'Fruity>Berry>blueberry': 2, 'Fruit>Berry>blueberry': 2 }, defects: {}, note: '', advanced: {}, vote: null };
    saveDraft('u-1', inProgress({ entries: { 1: entry } }));
    expect(loadDraft('u-1').entries[1].tags).toEqual({ 'Fruit>Berry>blueberry': 2 });
  });

  it('never stores a reveal body or a stale error', () => {
    saveDraft('u-1', inProgress({ result: { cups: ['secret'] }, error: 'boom' }));
    const raw = localStorage.getItem(localStorage.key(0));
    expect(raw).not.toContain('secret');
    expect(raw).not.toContain('boom');
    expect(loadDraft('u-1').result).toBeNull();
  });

  it("does not hand one person's draft to another", () => {
    saveDraft('u-1', inProgress());
    expect(loadDraft('u-2')).toBeNull();
  });

  it('stores nothing without an owner', () => {
    saveDraft(null, inProgress());
    expect(localStorage.length).toBe(0);
    expect(loadDraft(null)).toBeNull();
  });

  it('keeps each flight apart and loads the one asked for', () => {
    saveDraft('u-1', inProgress({ flightId: 7, flightName: 'seven' }));
    saveDraft('u-1', inProgress({ flightId: 8, flightName: 'eight' }));
    expect(loadDraft('u-1', { flightId: 7 }).flightName).toBe('seven');
    expect(loadDraft('u-1', { flightId: 8 }).flightName).toBe('eight');
    expect(loadDraft('u-1', { flightId: 9 })).toBeNull();
  });

  it('loads the most recently saved draft when no flight is named', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    saveDraft('u-1', inProgress({ flightId: 7, flightName: 'later' }));
    vi.setSystemTime(500);
    saveDraft('u-1', inProgress({ flightId: 8, flightName: 'earlier' }));
    vi.setSystemTime(1500);
    expect(loadDraft('u-1').flightName).toBe('later');
  });

  it('forgets a draft past its time limit and cleans it up', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    saveDraft('u-1', inProgress());
    vi.setSystemTime(1000 + DRAFT_TTL_MS + 1);
    expect(loadDraft('u-1')).toBeNull();
    expect(localStorage.length).toBe(0);
  });

  it('survives and cleans up unreadable storage', () => {
    saveDraft('u-1', inProgress());
    localStorage.setItem(localStorage.key(0), '{not json');
    expect(loadDraft('u-1')).toBeNull();
    expect(localStorage.length).toBe(0);
  });

  it('fills fields a newer build added', () => {
    saveDraft('u-1', inProgress());
    const key = localStorage.key(0);
    const stored = JSON.parse(localStorage.getItem(key));
    delete stored.draft.advancedStep;
    localStorage.setItem(key, JSON.stringify(stored));
    expect(loadDraft('u-1').advancedStep).toBe(0.5);
  });

  it('removes one slot only', () => {
    saveDraft('u-1', inProgress({ flightId: 7 }));
    saveDraft('u-1', inProgress({ flightId: 8 }));
    removeDraft('u-1', 7);
    expect(loadDraft('u-1', { flightId: 7 })).toBeNull();
    expect(loadDraft('u-1', { flightId: 8 })).not.toBeNull();
  });

  it('still works when storage throws', () => {
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('full'); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => saveDraft('u-1', inProgress())).not.toThrow();
    expect(warn).toHaveBeenCalled();
    spy.mockRestore();
    warn.mockRestore();
  });

  it('names a slot by flight, or new before the server has one', () => {
    expect(slotOf(inProgress())).toBe('new');
    expect(slotOf(inProgress({ flightId: 7 }))).toBe(7);
  });
});

describe('the re-read of a restored flight', () => {
  const started = () => inProgress({ flightId: 7 });
  it('is ignored once the taster has moved to another flight', () => {
    const draft = inProgress({ flightId: 8 });
    expect(reducer(draft, { type: 'restoreChecked', flightId: 7, flight: null })).toBe(draft);
    expect(reducer(draft, { type: 'restoreChecked', flightId: 7, flight: { id: 7, you_logged: true } })).toBe(draft);
  });
  it('clears the draft when the flight is gone', () => {
    expect(reducer(started(), { type: 'restoreChecked', flightId: 7, flight: null })).toEqual(initialDraft());
  });
  it('moves to the wait when the read is already in', () => {
    const next = reducer(started(), { type: 'restoreChecked', flightId: 7, flight: { id: 7, you_logged: true } });
    expect(next.logged).toBe(true);
    expect(next.screen).toBe('reveal');
  });
});

describe('reopening a flight that has saved scores', () => {
  const flight = { id: 7, cups: [{ position: 1, coffee_id: 1, label: 'Guji' }], prep: 'drip', is_shared: true };
  it('brings the saved scores back into a fresh seed', () => {
    const resume = { picked: [guji], entries: { 1: { vals: { overall: 2 } } }, cur: 0 };
    const seeded = reducer(initialDraft(), { type: 'seedFromFlight', flight, resume });
    expect(seeded.entries[1].vals.overall).toBe(2);
  });
  it("carries a blind host's scores across from coffee ids to cup positions", () => {
    const blind = { id: 7, is_shared: true, is_blind: true, is_host: true, prep: 'cupping', cups: [{ position: 1, label: 'Cup A', blind: true }] };
    const started = [
      { type: 'togglePick', coffee: guji },
      { type: 'sharedCreated', flight: blind },
      { type: 'val', coffeeId: 1, attr: 'overall', value: 5 },
    ].reduce(reducer, initialDraft());
    const seeded = reducer(initialDraft(), { type: 'seedFromFlight', flight: blind, resume: started });
    expect(seeded.entries['pos:1'].vals.overall).toBe(5);
  });
  it('starts empty without any', () => {
    expect(reducer(initialDraft(), { type: 'seedFromFlight', flight }).entries).toEqual({});
  });
});
