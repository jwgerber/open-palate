/**
 * The one axios instance. Cookies carry the session (`withCredentials`); every
 * non-GET echoes the `tasting_csrf` cookie into `X-CSRF-Token` (double-submit).
 * A 401 from anywhere but the auth probe sends the browser to /signin.
 */
import axios from 'axios';

const SAFE_METHODS = new Set(['get', 'head', 'options']);
const CSRF_COOKIE = 'tasting_csrf';
const PUBLIC_PATHS = ['/signin', '/device', '/setup'];

export function readCsrfToken() {
  const hit = document.cookie.split('; ').find((c) => c.startsWith(`${CSRF_COOKIE}=`));
  return hit ? decodeURIComponent(hit.slice(CSRF_COOKIE.length + 1)) : null;
}

export function onPublicPage() {
  return PUBLIC_PATHS.some((p) => window.location.pathname === p || window.location.pathname.startsWith(`${p}/`));
}

const api = axios.create({ baseURL: '/api', withCredentials: true });

api.interceptors.request.use((config) => {
  if (!SAFE_METHODS.has((config.method || 'get').toLowerCase())) {
    const token = readCsrfToken();
    if (token) config.headers.set('X-CSRF-Token', token);
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const url = err.config?.url || '';
    const probing = url.startsWith('/auth/me');
    if (err.response?.status === 401 && !probing && !onPublicPage()) {
      window.location.assign('/signin');
    }
    return Promise.reject(err);
  },
);

export default api;
