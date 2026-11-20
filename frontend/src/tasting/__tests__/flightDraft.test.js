import { describe, it, expect } from 'vitest';
import {
  reducer, initialDraft, entryFor, missingOverall, canLog, buildFlightBody, buildEntries, currentCoffee,
  advancedScored, advancedState, advancedTotal, advancedHalfDone, advancedNotesOnly, canLogAdvanced, isAdvancedFlight, unreadLabel,
} from '../log/flightDraft';

const guji = { id: 1, name: 'Guji Shakiso', roaster: 'Maple Roasters', kind: 'house' };
const winter = { id: 2, name: 'Winter Blend', roaster: 'Maple Roasters', kind: 'house' };
const decaf = { id: 3, name: 'Decaf Huila', roaster: 'Harbor Roasters', kind: 'house' };

const run = (actions, start = initialDraft()) => actions.reduce(reducer, start);

describe('flight draft reducer', () => {
  it('switchTaster clears the taster and every score but keeps the flight and screen', () => {
    let d = run([{ type: 'togglePick', coffee: guji }, { type: 'togglePick', coffee: winter },
      { type: 'who', who: { id: 9, name: 'Maya Lin' } }, { type: 'screen', screen: 'entry' },
      { type: 'val', coffeeId: 1, attr: 'overall', value: 4 }, { type: 'cur', cur: 1 }]);
    d = reducer(d, { type: 'switchTaster' });
    expect(d.who).toBeNull();
    expect(d.entries).toEqual({});
    expect(d.cur).toBe(0);
    expect(d.screen).toBe('entry');
    expect(d.picked.map((c) => c.id)).toEqual([1, 2]);
  });

  it('picks, un-picks (renumbering) and reorders', () => {
    let d = run([{ type: 'togglePick', coffee: guji }, { type: 'togglePick', coffee: winter }, { type: 'togglePick', coffee: decaf }]);
    expect(d.picked.map((c) => c.id)).toEqual([1, 2, 3]);
    d = reducer(d, { type: 'togglePick', coffee: winter });
    expect(d.picked.map((c) => c.id)).toEqual([1, 3]);
    d = reducer(d, { type: 'togglePick', coffee: winter });
    d = reducer(d, { type: 'reorder', from: 2, to: 0 });
    expect(d.picked.map((c) => c.id)).toEqual([2, 1, 3]);
    expect(reducer(d, { type: 'reorder', from: 5, to: 0 })).toBe(d);
  });

  it('keeps cur in range when a cup is removed', () => {
    let d = run([{ type: 'togglePick', coffee: guji }, { type: 'togglePick', coffee: winter }, { type: 'cur', cur: 1 }]);
    expect(currentCoffee(d).id).toBe(2);
    d = reducer(d, { type: 'togglePick', coffee: winter });
    expect(d.cur).toBe(0);
    expect(currentCoffee(d).id).toBe(1);
  });

  it('holds every cup\'s entry independently and never mutates the previous state', () => {
    let d = run([{ type: 'togglePick', coffee: guji }, { type: 'togglePick', coffee: winter }]);
    const before = d;
    d = reducer(d, { type: 'val', coffeeId: 1, attr: 'acidity', value: 4 });
    d = reducer(d, { type: 'val', coffeeId: 2, attr: 'overall', value: 3 });
    d = reducer(d, { type: 'cycleTag', coffeeId: 1, term: 'Fruit>Berry>blueberry' });
    d = reducer(d, { type: 'toggleDefect', coffeeId: 2, term: 'papery' });
    d = reducer(d, { type: 'note', coffeeId: 1, note: 'nice' });
    expect(entryFor(d, 1)).toEqual({ vals: { acidity: 4 }, tags: { 'Fruit>Berry>blueberry': 2 }, defects: {}, note: 'nice', advanced: {}, vote: null });
    expect(entryFor(d, 2)).toEqual({ vals: { overall: 3 }, tags: {}, defects: { papery: 1 }, note: '', advanced: {}, vote: null });
    expect(before.entries).toEqual({});
  });

  it('refuses a sixth tag and a heading under a picked leaf, leaving the draft untouched', () => {
    let d = run([{ type: 'togglePick', coffee: guji }]);
    d = reducer(d, { type: 'cycleTag', coffeeId: 1, term: 'Fruit>Berry>blueberry' });
    const same = reducer(d, { type: 'cycleTag', coffeeId: 1, term: 'Fruit' });
    expect(same).toBe(d);
    d = reducer(d, { type: 'removeTag', coffeeId: 1, term: 'Fruit>Berry>blueberry' });
    expect(entryFor(d, 1).tags).toEqual({});
  });

  it('clears a star by writing null and reports what is missing', () => {
    let d = run([{ type: 'togglePick', coffee: guji }, { type: 'togglePick', coffee: winter }]);
    expect(canLog(d)).toBe(false);
    expect(missingOverall(d).map((c) => c.name)).toEqual(['Guji Shakiso', 'Winter Blend']);
    d = reducer(d, { type: 'val', coffeeId: 1, attr: 'overall', value: 4 });
    d = reducer(d, { type: 'val', coffeeId: 2, attr: 'overall', value: 2 });
    expect(canLog(d)).toBe(true);
    d = reducer(d, { type: 'val', coffeeId: 2, attr: 'overall', value: null });
    expect(missingOverall(d).map((c) => c.name)).toEqual(['Winter Blend']);
  });

  it('builds the one-write body for a solo flight', () => {
    let d = run([
      { type: 'togglePick', coffee: winter }, { type: 'togglePick', coffee: guji },
      { type: 'prep', prep: 'cupping' },
      { type: 'val', coffeeId: 2, attr: 'overall', value: 3 },
      { type: 'val', coffeeId: 1, attr: 'overall', value: 5 },
      { type: 'val', coffeeId: 1, attr: 'acidity', value: 4 },
      { type: 'cycleTag', coffeeId: 1, term: 'Fruit>Berry>blueberry' },
      { type: 'cycleTag', coffeeId: 1, term: 'Fruit>Berry>blueberry' },
      { type: 'toggleDefect', coffeeId: 1, term: 'papery' },
      { type: 'note', coffeeId: 1, note: 'wow' },
    ]);
    expect(buildFlightBody(d, { memberId: 9 })).toEqual({
      coffee_ids: [2, 1], prep: 'cupping', member_id: 9,
      entries: [
        { position: 1, coffee_id: 2, overall: 3, tags: {}, defects: [], note: '' },
        { position: 2, coffee_id: 1, overall: 5, acidity: 4, tags: { 'Fruit>Berry>blueberry': 3 }, defects: ['papery'], note: 'wow' },
      ],
    });
    d = run([{ type: 'flightName', name: 'GH samples' }, { type: 'blind', blind: true }], { ...d, shared: true });
    expect(buildFlightBody(d)).toEqual({ coffee_ids: [2, 1], prep: 'cupping', name: 'GH samples', shared: true, blind: true });
  });

  it('seeds a joiner draft from a flight body and resets after Done', () => {
    const flight = {
      id: 12, name: 'GH samples', prep: 'cupping', is_shared: true, is_blind: true, is_host: false,
      cups: [
        { coffee_id: null, position: 1, label: 'Cup A', blind: true, name: null, roaster: null, kind: null },
        { coffee_id: null, position: 2, label: 'Cup B', blind: true, name: null, roaster: null, kind: null },
      ],
    };
    const d = reducer(initialDraft(), { type: 'seedFromFlight', flight });
    expect(d.screen).toBe('entry');
    expect(d.picked.map((c) => c.name)).toEqual(['Cup A', 'Cup B']);
    expect(d.picked.map((c) => c.id)).toEqual(['pos:1', 'pos:2']);
    const d2 = reducer(d, { type: 'val', coffeeId: 'pos:2', attr: 'overall', value: 4 });
    expect(buildEntries(d2)[1]).toEqual({ position: 2, overall: 4, tags: {}, defects: [], note: '' });
    expect(d).toMatchObject({ shared: true, blind: true, flightId: 12, viaLink: true, prep: 'cupping', flightName: 'GH samples' });
    expect(reducer(d, { type: 'reset' })).toEqual(initialDraft());
  });

  it('logged moves to the reveal with the result', () => {
    const d = reducer(initialDraft(), { type: 'logged', result: { cups: [] }, flight: { id: 1 } });
    expect(d.screen).toBe('reveal');
    expect(d.logged).toBe(true);
    expect(d.result).toEqual({ cups: [] });
  });
});

describe('Advanced draft', () => {
  const CATS = ['aroma', 'flavour', 'aftertaste', 'acidity', 'sweetness', 'bitterness', 'weight', 'texture', 'afterfeel', 'balance'];
  const advancedDraft = () => run([{ type: 'togglePick', coffee: guji }, { type: 'togglePick', coffee: winter }, { type: 'sheet', sheet: 'advanced' }, { type: 'sharedCreated', flight: { id: 7, sheet: 'advanced', adv_step: 0.5 } }]);
  const scoreAll = (d, id, value = 8.5) => CATS.reduce((acc, cat) => reducer(acc, { type: 'advancedScore', coffeeId: id, cat, value }), d);
  const done = (d, id, value) => reducer(scoreAll(d, id, value), { type: 'advancedVote', coffeeId: id, vote: 'yes' });

  it('defaults to the basic sheet at 0.5 steps', () => {
    const d = initialDraft();
    expect(d.sheet).toBe('basic');
    expect(d.advancedStep).toBe(0.5);
  });

  it('advancedState goes empty -> half -> done', () => {
    let d = advancedDraft();
    expect(advancedState(entryFor(d, 1))).toBe('empty');
    d = reducer(d, { type: 'advancedScore', coffeeId: 1, cat: 'aroma', value: 8 });
    expect(advancedState(entryFor(d, 1))).toBe('half');
    expect(advancedScored(entryFor(d, 1))).toBe(1);
    d = done(advancedDraft(), 1);
    expect(advancedState(entryFor(d, 1))).toBe('done');
    expect(advancedScored(entryFor(d, 1))).toBe(10);
  });

  it('a vote alone is half, and a null score removes the category', () => {
    let d = reducer(advancedDraft(), { type: 'advancedVote', coffeeId: 1, vote: 'no' });
    expect(advancedState(entryFor(d, 1))).toBe('half');
    d = reducer(d, { type: 'advancedScore', coffeeId: 1, cat: 'aroma', value: 7 });
    expect(entryFor(d, 1).advanced.aroma).toBe(7);
    d = reducer(d, { type: 'advancedScore', coffeeId: 1, cat: 'aroma', value: null });
    expect(entryFor(d, 1).advanced).toEqual({});
  });

  it('advancedTotal of ten 8.5s is 85', () => {
    expect(advancedTotal(entryFor(done(advancedDraft(), 1, 8.5), 1))).toBe(85);
    expect(advancedTotal(entryFor(initialDraft(), 1))).toBe(0);
  });

  it('canLogAdvanced needs a done cup and no half cups', () => {
    let d = advancedDraft();
    expect(canLogAdvanced(d)).toBe(false);
    d = done(d, 1);
    expect(canLogAdvanced(d)).toBe(true);
    const half = reducer(d, { type: 'advancedScore', coffeeId: 2, cat: 'aroma', value: 8 });
    expect(canLogAdvanced(half)).toBe(false);
    expect(advancedHalfDone(half).map((c) => c.id)).toEqual([2]);
    expect(canLog(half)).toBe(false);
    expect(canLog(d)).toBe(true);
  });

  it('advancedNotesOnly names empty cups that hold flavors, defects or a note', () => {
    let d = advancedDraft();
    expect(advancedNotesOnly(d)).toEqual([]);
    d = reducer(d, { type: 'note', coffeeId: 2, note: '  ' });
    expect(advancedNotesOnly(d)).toEqual([]);
    d = reducer(d, { type: 'note', coffeeId: 2, note: 'smoky' });
    d = reducer(d, { type: 'toggleDefect', coffeeId: 1, term: 'musty' });
    expect(advancedNotesOnly(d).map((c) => c.id)).toEqual([1, 2]);
    // Once a cup has any score it is half-done (blocks Log), not notes-only.
    d = reducer(d, { type: 'advancedScore', coffeeId: 2, cat: 'aroma', value: 8 });
    expect(advancedNotesOnly(d).map((c) => c.id)).toEqual([1]);
  });

  it('buildEntries sends only done cups with bar_vote and no overall', () => {
    let d = done(advancedDraft(), 1, 8.5);
    d = reducer(d, { type: 'advancedScore', coffeeId: 1, cat: 'aroma', value: 7 });
    d = reducer(d, { type: 'note', coffeeId: 1, note: 'jammy' });
    const entries = buildEntries(d);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ position: 1, coffee_id: 1, aroma: 7, flavour: 8.5, balance: 8.5, bar_vote: 'yes', note: 'jammy' });
    expect(entries[0]).not.toHaveProperty('overall');
    expect(entries[0]).not.toHaveProperty('body');
  });

  it('buildFlightBody adds sheet and step only for a shared Advanced flight', () => {
    let d = run([{ type: 'togglePick', coffee: guji }, { type: 'prep', prep: 'cupping' }, { type: 'sheet', sheet: 'advanced' }, { type: 'advancedStep', step: 0.1 }]);
    expect(buildFlightBody({ ...d, shared: true })).toMatchObject({ shared: true, sheet: 'advanced', adv_step: 0.1 });
    const basic = run([{ type: 'togglePick', coffee: guji }, { type: 'prep', prep: 'cupping' }]);
    expect(buildFlightBody({ ...basic, shared: true })).not.toHaveProperty('sheet');
    // A solo body never carries `sheet`, even if a stale 'advanced' choice is left on the draft.
    expect(buildFlightBody({ ...d, shared: false })).not.toHaveProperty('sheet');
  });

  it('a stale advanced choice with no server flight behaves as the basic sheet', () => {
    let d = run([{ type: 'togglePick', coffee: guji }, { type: 'prep', prep: 'cupping' }, { type: 'sheet', sheet: 'advanced' }]);
    expect(d.flightId).toBeNull();
    expect(isAdvancedFlight(d)).toBe(false);
    expect(canLog(d)).toBe(false);
    d = reducer(d, { type: 'val', coffeeId: 1, attr: 'overall', value: 4 });
    expect(canLog(d)).toBe(true);
    expect(buildEntries(d)[0]).toMatchObject({ coffee_id: 1, overall: 4 });
    expect(isAdvancedFlight({ ...d, flightId: 5 })).toBe(true);
  });

  it('seedFromFlight and sharedCreated both copy sheet and step', () => {
    const flight = { id: 7, prep: 'cupping', sheet: 'advanced', adv_step: 0.1, is_shared: true, is_host: false, cups: [{ position: 1, coffee_id: 1, name: 'G' }] };
    const joined = reducer(initialDraft(), { type: 'seedFromFlight', flight });
    expect(joined.sheet).toBe('advanced');
    expect(joined.advancedStep).toBe(0.1);
    const hosted = reducer(initialDraft(), { type: 'sharedCreated', flight: { id: 7, sheet: 'advanced', adv_step: 0.1 } });
    expect(hosted.sheet).toBe('advanced');
    expect(hosted.advancedStep).toBe(0.1);
    const plain = reducer(initialDraft(), { type: 'sharedCreated', flight: { id: 8 } });
    expect(plain.sheet).toBe('basic');
    expect(plain.advancedStep).toBe(0.5);
  });

  it('sharedCreated relabels a blind flight\'s picked cups by position, keeping ids', () => {
    const cups = [{ position: 1, label: 'Cup A', blind: true }, { position: 2, label: 'Cup B', blind: true }];
    const d = run([{ type: 'togglePick', coffee: guji }, { type: 'togglePick', coffee: winter },
      { type: 'sharedCreated', flight: { id: 7, is_blind: true, cups } }]);
    expect(d.picked.map((c) => c.label)).toEqual(['Cup A', 'Cup B']);
    expect(d.picked.every((c) => c.blind)).toBe(true);
    expect(d.picked.map((c) => c.id)).toEqual([1, 2]);
    expect(d.picked.map((c) => c.label || c.name)).not.toContain('Guji Shakiso');
    expect(buildEntries(d).map((e) => e.coffee_id)).toEqual([1, 2]);
  });

  it('sharedCreated leaves a non-blind flight\'s picked cups alone', () => {
    const d = run([{ type: 'togglePick', coffee: guji },
      { type: 'sharedCreated', flight: { id: 7, is_blind: false, cups: [{ position: 1, label: 'Guji Shakiso', blind: false }] } }]);
    expect(d.picked[0]).toBe(guji);
  });

  it('choosing the advanced sheet sets prep to cupping; leaving cupping resets the sheet', () => {
    let d = run([{ type: 'togglePick', coffee: guji }, { type: 'sheet', sheet: 'advanced' }]);
    expect(d).toMatchObject({ sheet: 'advanced', prep: 'cupping' });
    d = reducer(d, { type: 'prep', prep: 'drip' });
    expect(d.sheet).toBe('basic');
    expect(reducer(d, { type: 'sheet', sheet: 'basic' }).prep).toBe('drip');
  });

  it('prep is ignored once the flight exists', () => {
    const d = reducer(advancedDraft(), { type: 'sharedCreated', flight: { id: 7, sheet: 'advanced', adv_step: 0.5, prep: 'cupping' } });
    expect(reducer(d, { type: 'prep', prep: 'drip' })).toBe(d);
  });

  it('advanced chosen, share screen visited, back to picker without create: still not a Advanced flight, not shared', () => {
    let d = run([{ type: 'togglePick', coffee: guji }, { type: 'sheet', sheet: 'advanced' }]);
    d = reducer(reducer(d, { type: 'screen', screen: 'share' }), { type: 'screen', screen: 'picker' });
    expect(d).toMatchObject({ sheet: 'advanced', screen: 'picker', shared: false });
    expect(isAdvancedFlight(d)).toBe(false);
  });

  it('sheet and advancedStep are ignored once the flight exists', () => {
    const d = reducer(advancedDraft(), { type: 'sharedCreated', flight: { id: 7, sheet: 'advanced', adv_step: 0.5 } });
    expect(reducer(d, { type: 'sheet', sheet: 'basic' })).toBe(d);
    expect(reducer(d, { type: 'advancedStep', step: 0.1 })).toBe(d);
  });

  it('advancedClear empties scores and vote but keeps tags, defects and note', () => {
    let d = done(advancedDraft(), 1);
    d = reducer(d, { type: 'note', coffeeId: 1, note: 'keep me' });
    d = reducer(d, { type: 'toggleDefect', coffeeId: 1, term: 'papery' });
    d = reducer(d, { type: 'cycleTag', coffeeId: 1, term: 'Fruit>Berry>blueberry' });
    d = reducer(d, { type: 'advancedClear', coffeeId: 1 });
    const e = entryFor(d, 1);
    expect(e.advanced).toEqual({});
    expect(e.vote).toBeNull();
    expect(e.note).toBe('keep me');
    expect(e.defects).toEqual({ papery: 1 });
    expect(e.tags).toEqual({ 'Fruit>Berry>blueberry': 2 });
  });
});

describe('scanFill / unreadLabel', () => {
  const CATS = ['aroma', 'flavour', 'aftertaste', 'acidity', 'sweetness', 'bitterness', 'weight', 'texture', 'afterfeel', 'balance'];
  const full = Object.fromEntries(CATS.map((c) => [c, 8.5]));
  const advancedDraft = () => run([
    { type: 'togglePick', coffee: { ...guji, position: 1 } },
    { type: 'togglePick', coffee: { ...winter, position: 2 } },
    { type: 'togglePick', coffee: { ...decaf, position: 3 } },
    { type: 'sheet', sheet: 'advanced' },
    { type: 'sharedCreated', flight: { id: 7, sheet: 'advanced', adv_step: 0.5 } },
  ]);
  const cup = (position, over = {}) => ({
    position, scores: full, vote: 'yes', tags: { 'fruit>berry>blackberry': 2 }, defects: ['stale'], note: 'jammy', unread: [], ...over,
  });

  it('fills the cup at each position and leaves other cups alone', () => {
    const d = reducer(advancedDraft(), { type: 'scanFill', cups: [cup(2)] });
    expect(entryFor(d, 2)).toEqual({
      vals: {}, advanced: full, vote: 'yes', tags: { 'fruit>berry>blackberry': 2 }, defects: { stale: 1 }, note: 'jammy',
    });
    expect(advancedState(entryFor(d, 2))).toBe('done');
    expect(d.entries[1]).toBeUndefined();
    expect(d.entries[3]).toBeUndefined();
  });

  it('overwrites an existing typed entry rather than merging', () => {
    let d = reducer(advancedDraft(), { type: 'advancedScore', coffeeId: 1, cat: 'balance', value: 9 });
    d = reducer(d, { type: 'note', coffeeId: 1, note: 'typed' });
    d = reducer(d, { type: 'scanFill', cups: [cup(1, { scores: { aroma: 8 }, vote: null, tags: {}, defects: [], note: '' })] });
    expect(entryFor(d, 1).advanced).toEqual({ aroma: 8 });
    expect(entryFor(d, 1).note).toBe('');
  });

  it('ignores a position with no picked cup', () => {
    const before = advancedDraft();
    expect(reducer(before, { type: 'scanFill', cups: [cup(9)] }).entries).toEqual(before.entries);
  });

  it('a cup with an unread category is half, not done', () => {
    const { balance: _b, ...rest } = full;
    const d = reducer(advancedDraft(), { type: 'scanFill', cups: [cup(1, { scores: rest, unread: ['balance'] })] });
    expect(advancedState(entryFor(d, 1))).toBe('half');
  });

  it('unreadLabel uses the category label, and the printed On bar? wording for the vote', () => {
    expect(['aroma', 'vote'].map(unreadLabel)).toEqual(['Aroma', 'On bar?']);
  });
});
