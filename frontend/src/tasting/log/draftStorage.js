/**
 * Unlogged flight drafts saved on this device, so a refresh cannot lose them.
 *
 * One slot per person per flight (`new` before the server has a flight):
 * scanning a second flight's QR must not put that flight's cups over the first
 * one's scores, since every blind flight's cups read "Cup A, Cup B".
 *
 * A reveal body is never stored, and neither is anything once the flight is
 * logged: from there the server holds the read. Storage is a convenience, so a
 * failure only loses the protection, never the tasting in progress.
 */
import { initialDraft } from './flightDraft';
import { isValidTerm } from '../lexicon';

const PREFIX = 'tasting.draft.v1:';
export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

const keyFor = (owner, slot) => `${PREFIX}${owner}:${slot}`;

export const slotOf = (draft) => draft.flightId ?? 'new';

export const isWorthKeeping = (draft) => draft.screen !== 'landing' && draft.screen !== 'reveal'
  && !draft.logged && draft.picked.length > 0;

/**
 * A copy of `draft` whose entries keep only tags `isTerm` accepts. A draft saved
 * before a lexicon change can hold keys the server would now reject.
 */
export function dropUnknownTags(draft, isTerm) {
  const entries = Object.fromEntries(Object.entries(draft.entries || {}).map(([id, e]) => [
    id, { ...e, tags: Object.fromEntries(Object.entries(e.tags || {}).filter(([k]) => isTerm(k))) },
  ]));
  return { ...draft, entries };
}

export function saveDraft(owner, draft) {
  if (owner == null) return;
  const { result: _result, error: _error, ...kept } = draft;
  try {
    localStorage.setItem(keyFor(owner, slotOf(draft)), JSON.stringify({ savedAt: Date.now(), draft: kept }));
  } catch (e) {
    console.warn('Could not save the tasting draft on this device', e);
  }
}

export function removeDraft(owner, slot) {
  if (owner == null) return;
  try {
    localStorage.removeItem(keyFor(owner, slot));
  } catch (e) {
    console.warn('Could not remove the saved tasting draft', e);
  }
}

/** Every draft key on this device, whoever saved it. */
function draftKeys() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key?.startsWith(PREFIX)) keys.push(key);
  }
  return keys;
}

/** Parse one saved draft, dropping it from storage when unreadable or past its time limit. */
function readSaved(key) {
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    if (saved?.draft && Date.now() - saved.savedAt <= DRAFT_TTL_MS) return saved;
  } catch { /* unreadable: removed below, same as an expired draft */ }
  localStorage.removeItem(key);
  return null;
}

/**
 * The saved draft for one flight when `flightId` is given, otherwise this
 * person's most recent one. Expired drafts go from every account's slots, since
 * a shared device may never see that person sign in again.
 */
export function loadDraft(owner, { flightId = null } = {}) {
  if (owner == null) return null;
  try {
    const ownerPrefix = `${PREFIX}${owner}:`;
    const wanted = flightId != null ? keyFor(owner, flightId) : null;
    let best = null;
    draftKeys().forEach((key) => {
      const saved = readSaved(key);
      if (!saved || !key.startsWith(ownerPrefix) || (wanted && key !== wanted)) return;
      if (!best || saved.savedAt > best.savedAt) best = saved;
    });
    return best ? dropUnknownTags({ ...initialDraft(), ...best.draft }, isValidTerm) : null;
  } catch (e) {
    console.warn('Could not read the saved tasting draft', e);
    return null;
  }
}

/** Test/reset hook: forget every saved draft. */
export function clearSavedDrafts() {
  try {
    draftKeys().forEach((key) => localStorage.removeItem(key));
  } catch (e) {
    console.warn('Could not clear the saved tasting drafts', e);
  }
}
