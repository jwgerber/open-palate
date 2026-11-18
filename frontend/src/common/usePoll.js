/**
 * Poll while `active`: one leading tick, then every `ms` — but never while
 * the tab is hidden (a reveal left open on a shared device
 * must not hit the API 720 times an hour), with a catch-up tick the moment
 * it is visible again. `tick` receives an `isLive()` guard for its async
 * continuation.
 *
 * Used by Tasting (reveal roster and live flight polls);
 * `tick` must be `useCallback`d by the caller — this effect re-fires
 * whenever `tick`'s identity changes.
 */
import { useEffect } from 'react';

export function usePoll(active, tick, ms) {
  useEffect(() => {
    if (!active) return undefined;
    let live = true;
    const isLive = () => live;
    const run = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      tick(isLive);
    };
    run();
    const id = setInterval(run, ms);
    document.addEventListener('visibilitychange', run);
    return () => { live = false; clearInterval(id); document.removeEventListener('visibilitychange', run); };
  }, [active, tick, ms]);
}
