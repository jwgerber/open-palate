import { useEffect, useRef, useState } from 'react';

const TICK_MS = 1000;
const REANCHOR_DRIFT_S = 2;

const countFrom = ({ base, at }) => base + Math.floor((Date.now() - at) / 1000);

/**
 * Seconds on the cupping timer, counted locally between polls. Anchors on the
 * server's `timer_elapsed_s` at the moment the response arrived
 * (`received_at_ms`, stamped by tastingApi), so a banner that remounts later —
 * say after a detour to Review — picks up where the clock really is instead of
 * restarting from a stale value. Never reads a server timestamp, so a skewed
 * device clock cannot move it. A fresh flight only re-anchors when its count
 * differs from the local count by more than 2 s (a restart, or a long
 * background gap). Null when the timer hasn't started or the flight is closed.
 *
 * Call this inside the banner / timer face so the 1 s tick repaints only that.
 */
export function useElapsed(flight) {
  const serverS = flight?.is_open ? flight.timer_elapsed_s : null;
  const receivedAt = flight?.received_at_ms ?? null;
  const running = serverS != null;
  const anchor = useRef(null); // {base, at}: `base` seconds elapsed at Date.now() === `at`
  const [elapsed, setElapsed] = useState(() => (
    running ? countFrom({ base: serverS, at: receivedAt ?? Date.now() }) : null
  ));

  useEffect(() => {
    if (!running) {
      anchor.current = null; // the return below hides any stale count
      return undefined;
    }
    const fresh = { base: serverS, at: receivedAt ?? Date.now() };
    if (!anchor.current || Math.abs(countFrom(fresh) - countFrom(anchor.current)) > REANCHOR_DRIFT_S) {
      anchor.current = fresh;
    }
    setElapsed(countFrom(anchor.current));
    const id = setInterval(() => setElapsed(countFrom(anchor.current)), TICK_MS);
    return () => clearInterval(id);
  }, [running, serverS, receivedAt]);

  return running ? elapsed : null;
}
