/**
 * A double-tap guard for an async action: `busy` for the UI, and a ref so two
 * taps landing in the same frame (before the state commits) both cannot pass.
 * `run(fn)` ignores calls while one is in flight.
 */
import { useCallback, useRef, useState } from 'react';

export function useBusyAction() {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const run = useCallback(async (fn) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await fn();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);
  return [busy, run];
}
