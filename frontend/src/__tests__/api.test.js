import { describe, it, expect, beforeEach } from 'vitest';
import api, { readCsrfToken } from '../api';

// Capture the request config instead of hitting the network.
const capture = () => {
  const seen = [];
  api.defaults.adapter = async (config) => { seen.push(config); return { data: {}, status: 200, statusText: 'OK', headers: {}, config }; };
  return seen;
};

describe('api', () => {
  beforeEach(() => { document.cookie = 'tasting_csrf=; max-age=0'; });

  it('sends the credentials cookie and X-CSRF-Token on a POST', async () => {
    document.cookie = 'tasting_csrf=tok123';
    const seen = capture();
    await api.post('/tasting/coffees', { name: 'x' });
    expect(seen[0].withCredentials).toBe(true);
    expect(seen[0].headers.get('X-CSRF-Token')).toBe('tok123');
  });

  it('adds the header to PUT, PATCH and DELETE, never to GET', async () => {
    document.cookie = 'tasting_csrf=tok9';
    const seen = capture();
    await api.get('/auth/me');
    await api.put('/a', {});
    await api.patch('/b', {});
    await api.delete('/c');
    expect(seen.map((c) => c.headers.get('X-CSRF-Token'))).toEqual([undefined, 'tok9', 'tok9', 'tok9']);
  });

  it('reads no token when the cookie is absent', () => {
    expect(readCsrfToken()).toBeNull();
  });
});
