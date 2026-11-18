/**
 * The flight draft — a pure reducer holding everything a flight collects
 * before the ONE write that logs it. Every cup's form state lives
 * here so switching cups is a state swap with zero network.
 *
 * `picked` holds coffee OBJECTS ({ id, name, roaster, kind, n, ... }) in pour
 * order, so labels never need a second lookup. `entries` is keyed by coffee id.
 * `cur` is the index into `picked` of the cup on screen.
 */
import { cycleTag as cycleLexiconTag, removeTag as removeLexiconTag } from '../lexicon';
import { ATTRIBUTES, ADV_CATEGORIES, ADV_GUIDANCE } from '../content';

export const SCREENS = ['landing', 'who', 'picker', 'add', 'share', 'entry', 'review', 'reveal'];

// `advanced` holds a Advanced cup's scores by category (7 means D/Q); `vote` its bar vote.
export const emptyEntry = () => ({ vals: {}, tags: {}, defects: {}, note: '', advanced: {}, vote: null });

export const initialDraft = () => ({
  screen: 'landing',
  picked: [],
  prep: 'drip',
  sheet: 'basic',       // 'basic' | 'advanced' — only a shared cupping may pick 'advanced'
  advancedStep: 0.5,          // 0.5 | 0.1 — score granularity on the Advanced sheet
  who: null,            // shared device: { id, name }
  entries: {},
  cur: 0,
  flightName: '',
  shared: false,
  blind: false,
  flightId: null,
  viaLink: false,       // opened from a /f/:id link (joiner, not host)
  flight: null,         // the server's flight body once one exists
  logged: false,
  result: null,         // reveal body
  error: null,
});

export const entryFor = (draft, coffeeId) => draft.entries[coffeeId] || emptyEntry();
export const currentCoffee = (draft) => draft.picked[Math.min(draft.cur, Math.max(0, draft.picked.length - 1))] || null;
export const missingOverall = (draft) =>
  draft.picked.filter((c) => entryFor(draft, c.id).vals.overall == null);

export const advancedScored = (entry) => ADV_CATEGORIES.filter((c) => entry.advanced[c] != null).length;
/** empty: nothing entered · done: all ten scores AND a vote · half: anything between. */
export function advancedState(entry) {
  const scored = advancedScored(entry);
  if (scored === 0 && !entry.vote) return 'empty';
  return scored === ADV_CATEGORIES.length && entry.vote ? 'done' : 'half';
}
export const advancedTotal = (entry) =>
  Math.round(ADV_CATEGORIES.reduce((sum, c) => sum + (entry.advanced[c] ?? 0), 0) * 10) / 10;
export const advancedHalfDone = (draft) => draft.picked.filter((c) => advancedState(entryFor(draft, c.id)) === 'half');
/** Cups with flavors, defects or a note but no scores or vote: 'empty', so Log drops them. */
export const advancedNotesOnly = (draft) => draft.picked.filter((c) => {
  const e = entryFor(draft, c.id);
  return advancedState(e) === 'empty' && (Object.keys(e.tags).length > 0 || Object.keys(e.defects).length > 0 || !!e.note?.trim());
});
export const canLogAdvanced = (draft) =>
  draft.picked.some((c) => advancedState(entryFor(draft, c.id)) === 'done') && advancedHalfDone(draft).length === 0;
/** Advanced mode needs the server flight: a 'advanced' choice made on the share screen but never created is still a basic draft. */
export const isAdvancedFlight = (draft) => draft.sheet === 'advanced' && !!draft.flightId;
export const canLog = (draft) => (isAdvancedFlight(draft)
  ? canLogAdvanced(draft)
  : draft.picked.length > 0 && missingOverall(draft).length === 0);

/** The POST body for a solo flight, or the `entries` body for a shared one. */
export function buildEntries(draft) {
  const advanced = isAdvancedFlight(draft);
  return draft.picked.flatMap((c, i) => {
    const e = entryFor(draft, c.id);
    if (advanced && advancedState(e) !== 'done') return [];
    // A cup is named by POSITION (all a blind taster has); coffee_id rides along when known.
    const body = { position: c.position ?? i + 1, tags: e.tags, defects: Object.keys(e.defects), note: e.note || '' };
    if (typeof c.id === 'number') body.coffee_id = c.id;
    if (advanced) {
      ADV_CATEGORIES.forEach((cat) => { body[cat] = e.advanced[cat]; });
      body.bar_vote = e.vote;
    } else {
      ATTRIBUTES.forEach((a) => { if (e.vals[a] != null) body[a] = e.vals[a]; });
    }
    return [body];
  });
}

export function buildFlightBody(draft, { memberId } = {}) {
  const body = {
    coffee_ids: draft.picked.map((c) => c.id),
    prep: draft.prep,
    ...(draft.flightName ? { name: draft.flightName } : {}),
    ...(memberId != null ? { member_id: memberId } : {}),
  };
  if (draft.shared) {
    body.shared = true;
    body.blind = !!draft.blind;
    if (draft.sheet === 'advanced') { body.sheet = 'advanced'; body.adv_step = draft.advancedStep; }
  } else {
    body.entries = buildEntries(draft);
  }
  return body;
}

/** Replace one cup's entry. `fn` gets the CURRENT entry (do not mutate it) and
 * returns the next one, or null/the same object to leave the draft untouched —
 * so a slider drag that lands on the same stop is a no-op render-wise, and
 * only the sub-object that changed gets a new identity (FlavorPicker memoizes
 * on `tags`). */
function withEntry(draft, coffeeId, fn) {
  const e = entryFor(draft, coffeeId);
  const next = fn(e);
  if (!next || next === e) return draft;
  return { ...draft, entries: { ...draft.entries, [coffeeId]: next } };
}

/** What a scan could not read, per coffee id, as raw keys (category / 'vote') so the entry screen
 * can drop each one once the host fills it. */
export function scanUnread(draft, cups) {
  const unread = {};
  cups.forEach((cup) => {
    const coffee = draft.picked.find((c) => (c.position ?? draft.picked.indexOf(c) + 1) === cup.position);
    if (!coffee || !cup.unread?.length) return;
    unread[coffee.id] = cup.unread;
  });
  return unread;
}

/** Human label for an unread key: the entry screen's category label, or the printed sheet's own
 * wording for the bar vote. */
export function unreadLabel(key) {
  return key === 'vote' ? 'On bar?' : ADV_GUIDANCE[key]?.label ?? key;
}

/** Relabel `picked` with the server's blind cup labels, by position. */
function blindPicked(picked, cups = []) {
  return picked.map((c, i) => ({
    id: c.id, label: cups[i]?.label ?? `Cup ${i + 1}`, blind: true, position: cups[i]?.position ?? i + 1,
  }));
}

/** Joiner opened a link: coffees in pour order, prep, blind labels. */
function seedFromFlight(f) {
  // While blind, the server sends no coffee_id; the draft keys the cup by position.
  const picked = f.cups.map((c) => ({
    id: c.coffee_id ?? `pos:${c.position}`, name: c.name ?? c.label, label: c.label, roaster: c.roaster,
    kind: c.kind, blind: c.blind, position: c.position, blindLabel: c.blind_label ?? null,
  }));
  return {
    ...initialDraft(), screen: 'entry', picked, prep: f.prep, sheet: f.sheet ?? 'basic', advancedStep: f.adv_step ?? 0.5,
    flightName: f.name || '', shared: !!f.is_shared, blind: !!f.is_blind, flightId: f.id, flight: f,
    viaLink: !f.is_host,
  };
}

/**
 * A saved draft's scores for a freshly seeded flight, matched by position: a host's
 * blind draft keys cups by coffee id, while a seed keys them `pos:<n>`.
 */
function resumedEntries(seeded, resume) {
  const entries = {};
  (resume?.picked ?? []).forEach((c, i) => {
    const saved = resume.entries[c.id];
    const cup = seeded.picked.find((p) => p.position === (c.position ?? i + 1));
    if (saved && cup) entries[cup.id] = saved;
  });
  return entries;
}

export function reducer(draft, action) {
  switch (action.type) {
    case 'screen':
      return { ...draft, screen: action.screen, error: null };
    case 'togglePick': {
      const on = draft.picked.some((c) => c.id === action.coffee.id);
      const picked = on ? draft.picked.filter((c) => c.id !== action.coffee.id) : [...draft.picked, action.coffee];
      return { ...draft, picked, cur: Math.min(draft.cur, Math.max(0, picked.length - 1)) };
    }
    case 'reorder': {
      const { from, to } = action;
      if (from === to || from < 0 || to < 0 || from >= draft.picked.length || to >= draft.picked.length) return draft;
      const picked = [...draft.picked];
      const [moved] = picked.splice(from, 1);
      picked.splice(to, 0, moved);
      return { ...draft, picked };
    }
    case 'prep':
      if (draft.flightId) return draft;
      // Only a cupping can use the Advanced sheet; leaving cupping drops back to basic.
      return { ...draft, prep: action.prep, sheet: action.prep === 'cupping' ? draft.sheet : 'basic' };
    // The sheet and step are fixed once the server has the flight. Advanced is a
    // cupping sheet, so choosing it pulls the prep along.
    case 'sheet':
      if (draft.flightId) return draft;
      return { ...draft, sheet: action.sheet, prep: action.sheet === 'advanced' ? 'cupping' : draft.prep };
    case 'advancedStep':
      return draft.flightId ? draft : { ...draft, advancedStep: action.step };
    case 'who':
      return { ...draft, who: action.who };
    case 'flightName':
      return { ...draft, flightName: action.name };
    case 'blind':
      return { ...draft, blind: !!action.blind };
    case 'cur':
      return { ...draft, cur: action.cur };
    case 'val':
      return withEntry(draft, action.coffeeId, (e) => (
        e.vals[action.attr] === action.value ? e : { ...e, vals: { ...e.vals, [action.attr]: action.value } }
      ));
    case 'cycleTag':
      return withEntry(draft, action.coffeeId, (e) => {
        const tags = cycleLexiconTag(e.tags, action.term);
        return tags ? { ...e, tags } : null;
      });
    case 'removeTag':
      return withEntry(draft, action.coffeeId, (e) => ({ ...e, tags: removeLexiconTag(e.tags, action.term) }));
    case 'toggleDefect':
      return withEntry(draft, action.coffeeId, (e) => {
        const defects = { ...e.defects };
        if (defects[action.term]) delete defects[action.term]; else defects[action.term] = 1;
        return { ...e, defects };
      });
    case 'note':
      return withEntry(draft, action.coffeeId, (e) => (e.note === action.note ? e : { ...e, note: action.note }));
    case 'advancedScore':
      return withEntry(draft, action.coffeeId, (e) => {
        if (action.value == null) {
          if (e.advanced[action.cat] == null) return e;
          const { [action.cat]: _removed, ...rest } = e.advanced;
          return { ...e, advanced: rest };
        }
        return e.advanced[action.cat] === action.value ? e : { ...e, advanced: { ...e.advanced, [action.cat]: action.value } };
      });
    case 'advancedVote':
      return withEntry(draft, action.coffeeId, (e) => (e.vote === action.vote ? e : { ...e, vote: action.vote }));
    case 'advancedClear':
      return withEntry(draft, action.coffeeId, (e) => (advancedState(e) === 'empty' ? e : { ...e, advanced: {}, vote: null }));
    case 'scanFill': {
      // A scan REPLACES the cup's entry: it is a photo of the whole sheet, not a patch over typing.
      // `replaceAll` also clears the cups the scan omitted, so a re-scan can't leave the last one's data behind.
      const entries = action.replaceAll ? Object.fromEntries(draft.picked.map((c) => [c.id, emptyEntry()])) : { ...draft.entries };
      action.cups.forEach((cup) => {
        const idx = draft.picked.findIndex((c, i) => (c.position ?? i + 1) === cup.position);
        if (idx < 0) return;
        entries[draft.picked[idx].id] = {
          ...emptyEntry(), advanced: cup.scores || {}, vote: cup.vote ?? null, tags: cup.tags || {},
          defects: Object.fromEntries((cup.defects || []).map((t) => [t, 1])), note: cup.note || '',
        };
      });
      return { ...draft, entries };
    }
    case 'sharedCreated':
      // Host opened a shared flight: remember the server id, keep the draft.
      // A blind flight is blind for the host too: swap the picked names for the
      // server's cup labels (same pour order), keeping each id so entries still
      // key by coffee_id.
      return { ...draft, shared: true, flightId: action.flight.id, flight: action.flight,
        picked: action.flight.is_blind ? blindPicked(draft.picked, action.flight.cups) : draft.picked,
        blind: !!action.flight.is_blind, flightName: action.flight.name || draft.flightName,
        sheet: action.flight.sheet ?? 'basic', advancedStep: action.flight.adv_step ?? 0.5 };
    case 'seedFromFlight': {
      // `resume` is this flight's saved draft, when the taster already started it on this device.
      const seeded = seedFromFlight(action.flight);
      return { ...seeded, entries: resumedEntries(seeded, action.resume), cur: action.resume?.cur ?? 0 };
    }
    case 'resume':
      return action.draft;
    case 'restoreChecked':
      // The re-read of a restored flight landed. The taster may have moved on while it was out.
      if (draft.flightId !== action.flightId) return draft;
      if (!action.flight) return initialDraft();
      return action.flight.you_logged
        ? reducer(draft, { type: 'logged', flight: action.flight })
        : { ...draft, flight: action.flight };
    case 'flightEdited':
      // Scores already started were tied to the old slots, so they go; where the host is stays.
      return { ...seedFromFlight(action.flight), screen: draft.screen, who: draft.who, viaLink: draft.viaLink };
    case 'flightUpdated':
      return { ...draft, flight: action.flight };
    case 'logged':
      return { ...draft, logged: true, screen: 'reveal', flight: action.flight || draft.flight,
        result: action.result || null, error: null };
    case 'revealed':
      return { ...draft, result: action.result, flight: action.result?.flight || draft.flight, screen: 'reveal' };
    case 'error':
      return { ...draft, error: action.error };
    case 'reset':
      return initialDraft();
    default:
      return draft;
  }
}
