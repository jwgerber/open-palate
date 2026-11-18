/**
 * Stable per-cup callbacks for the entry screen. Each one closes over the
 * reducer's `dispatch` and the cup's id and nothing else, so the memoized
 * sliders, stars, picker, wheel and defects card only repaint when their own
 * value changes — not on every keystroke elsewhere on the screen.
 */
import { useCallback } from 'react';

export function useEntryActions(dispatch, coffeeId) {
  const onSet = useCallback((attr, value) => dispatch({ type: 'val', coffeeId, attr, value }), [dispatch, coffeeId]);
  const onOverall = useCallback((value) => dispatch({ type: 'val', coffeeId, attr: 'overall', value }), [dispatch, coffeeId]);
  const onCycle = useCallback((term) => dispatch({ type: 'cycleTag', coffeeId, term }), [dispatch, coffeeId]);
  const onRemove = useCallback((term) => dispatch({ type: 'removeTag', coffeeId, term }), [dispatch, coffeeId]);
  const onToggleDefect = useCallback((term) => dispatch({ type: 'toggleDefect', coffeeId, term }), [dispatch, coffeeId]);
  const onNote = useCallback((note) => dispatch({ type: 'note', coffeeId, note }), [dispatch, coffeeId]);
  const onAdvancedScore = useCallback((cat, value) => dispatch({ type: 'advancedScore', coffeeId, cat, value }), [dispatch, coffeeId]);
  const onAdvancedVote = useCallback((vote) => dispatch({ type: 'advancedVote', coffeeId, vote }), [dispatch, coffeeId]);
  return { onSet, onOverall, onCycle, onRemove, onToggleDefect, onNote, onAdvancedScore, onAdvancedVote };
}

/** Commit whatever is focused (the note) before leaving the screen by button. */
export const blurActive = () => { if (typeof document !== 'undefined') document.activeElement?.blur?.(); };
