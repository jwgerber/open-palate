/**
 * `navigator.onLine`, live. Used by online-only flows (Tasting) to disable
 * write buttons with a clear message and keep the draft in memory.
 */
import { useEffect, useState } from 'react';

export function useOnline() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);
  return online;
}
