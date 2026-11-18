import fs from 'node:fs';
import path from 'node:path';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { setContent } from '../tasting/content';
import { setGroupTimezone } from '../time';

// Pin the browser zone so date-only rendering tests are deterministic anywhere.
process.env.TZ = 'America/New_York';
setGroupTimezone('America/New_York');

// The server's real content files (the same bytes GET /api/content serves), installed
// before any test module loads so module-level constants see a populated wheel.
const contentDir = path.resolve(__dirname, '../../../content');
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(contentDir, name), 'utf8'));
setContent({ lexicon: readJson('lexicon.json'), forms: readJson('forms.json') });

// In-memory localStorage: Node's experimental global shadows jsdom's and can throw.
{
  const store = {};
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
      clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
      get length() { return Object.keys(store).length; },
      key: (i) => Object.keys(store)[i] ?? null,
    },
  });
}

// recharts' ResponsiveContainer needs ResizeObserver; jsdom has none.
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

afterEach(() => { cleanup(); });
