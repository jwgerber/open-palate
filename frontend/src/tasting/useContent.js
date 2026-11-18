import { useEffect, useState } from 'react';
import api from '../api';
import { setContent, contentLoaded } from './content';

let inflight = null;

/** Fetch /api/content once per page load and install it (see content.js). */
export function loadContent() {
  if (contentLoaded()) return Promise.resolve();
  if (!inflight) {
    inflight = api.get('/content').then((res) => { setContent(res.data); }).finally(() => { inflight = null; });
  }
  return inflight;
}

/** `{ ready, error }`: ready once the wheel and sheet wording are installed. */
export function useContent() {
  const [state, setState] = useState({ ready: contentLoaded(), error: null });
  useEffect(() => {
    if (state.ready) return undefined;
    let live = true;
    loadContent().then(
      () => { if (live) setState({ ready: true, error: null }); },
      (error) => { if (live) setState({ ready: false, error }); },
    );
    return () => { live = false; };
  }, [state.ready]);
  return state;
}
