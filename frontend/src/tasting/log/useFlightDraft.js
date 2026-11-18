/**
 * The flight draft as React state, surviving tab switches and refreshes.
 *
 * Switching to Coffees or My palate unmounts the Log tab; a half-entered
 * flight must not die with it (spec §5.3). The last draft is parked in a
 * module-level slot and re-adopted on the next mount — screen reset to the
 * tab root is the caller's job (`dispatch({ type: 'screen', screen: 'landing' })`)
 * when that is what the product wants.
 *
 * A refresh clears that slot too, so an unlogged draft is also saved on the
 * device after every change (`draftStorage.js`). That is refresh protection
 * only: logging still needs a connection and there is no offline queue
 * (decision 2026-09-10).
 */
import { useEffect, useReducer, useRef, useState } from 'react';
import { reducer, initialDraft } from './flightDraft';
import { clearSavedDrafts, isWorthKeeping, loadDraft, removeDraft, saveDraft, slotOf } from './draftStorage';

/** True on a mount or a poll: nothing the taster did, so the saved draft's age must stand. */
const onlyFlightChanged = (prev, next) => Object.keys(next).every((k) => k === 'flight' || prev[k] === next[k]);

let parked = null;
let parkedOwner = null;

function firstDraft(owner, flightId) {
  if (parked && parkedOwner === owner) return { draft: parked, restored: false };
  const saved = loadDraft(owner, { flightId });
  return saved ? { draft: saved, restored: true } : { draft: initialDraft(), restored: false };
}

/**
 * `owner` scopes the draft to an identity (the Supabase user id): a sign-out
 * is a SPA state change, not a reload, so without this the next person to sign
 * in on the same device would inherit a half-scored flight and log it under
 * their own name. `flightId` is the flight a link names: only that flight's
 * saved draft may open over its invite.
 *
 * Returns `[draft, dispatch, restored]`; `restored` means the draft came from
 * storage, so the flight it holds may be out of date.
 */
export function useFlightDraft(owner = null, { flightId = null } = {}) {
  const [first] = useState(() => firstDraft(owner, flightId));
  const [draft, dispatch] = useReducer(reducer, first.draft);
  const savedSlot = useRef(isWorthKeeping(first.draft) ? slotOf(first.draft) : null);
  const lastDraft = useRef(first.draft);

  useEffect(() => {
    parked = draft;
    parkedOwner = owner;
    const previous = lastDraft.current;
    lastDraft.current = draft;
    const slot = slotOf(draft);
    // The draft moved on from this slot: discarded, or a new flight got its server id.
    if (savedSlot.current != null && savedSlot.current !== slot) removeDraft(owner, savedSlot.current);
    if (isWorthKeeping(draft)) {
      if (!onlyFlightChanged(previous, draft)) saveDraft(owner, draft);
      savedSlot.current = slot;
      return;
    }
    if (savedSlot.current === slot) removeDraft(owner, slot);
    // A flight opened as already logged never passed through a save, but may have an old one.
    if (draft.flightId != null) removeDraft(owner, draft.flightId);
    savedSlot.current = null;
  }, [draft, owner]);

  return [draft, dispatch, first.restored];
}

/** Drop the in-memory draft only, which is what a page refresh does. */
export function forgetParkedDraft() { parked = null; parkedOwner = null; }

/** Test/reset hook — forget the parked draft and every saved one. */
export function clearParkedDraft() { forgetParkedDraft(); clearSavedDrafts(); }
