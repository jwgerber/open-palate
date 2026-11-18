/**
 * Tasting module API client — /api/tasting.
 *
 * Every call resolves to the response body. Shared-device callers
 * pass `memberId` where the backend needs to know WHO is tasting;
 * personal accounts never send it (the backend 400s if they do). One helper
 * each for the query-string and body forms so the wire key is spelled once.
 *
 * The coffee list is cached for a minute and shared between concurrent
 * callers (the picker and the Coffees tab both want it; `createCache` dedups
 * the in-flight promise), and invalidated by every coffee write.
 */
import api from '../api';
import { createCache } from '../cache';

const getData = (res) => res.data;
const COFFEES_TTL_MS = 60 * 1000;
const coffeesCache = createCache(COFFEES_TTL_MS);

export const memberParams = (memberId) =>
  (memberId != null ? { member_id: memberId } : {});
export const memberBody = memberParams;

const invalidateCoffees = (value) => { coffeesCache.invalidateAll(); return value; };

// When a flight dict arrived, so the cupping timer counts on from the server's
// `timer_elapsed_s` at receipt rather than from whenever a component mounts.
const stampFlight = (flight) => (flight && typeof flight === 'object' ? { ...flight, received_at_ms: Date.now() } : flight);
// For bodies that carry the flight under `flight` (reveal, summary).
const stampNested = (body) => (body?.flight ? { ...body, flight: stampFlight(body.flight) } : body);
// createFlight answers a flight dict, plus `reveal` (with its own `flight`) for a closed basic flight.
const stampCreated = (body) => {
  const stamped = stampFlight(body);
  return stamped?.reveal ? { ...stamped, reveal: stampNested(stamped.reveal) } : stamped;
};

// GET a file and hand it to the browser as a download. The server's Content-Disposition
// isn't readable cross-origin without an expose header, so the caller names the file.
const downloadBlob = async (path, filename) => {
  const response = await api.get(path, { responseType: 'blob' });
  const url = window.URL.createObjectURL(new Blob([response.data]));
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
  return response.data;
};

export const tastingApi = {
  // Coffees
  getCoffees: ({ includeArchived, mine, memberId } = {}) => {
    const params = {
      ...(includeArchived ? { include_archived: 1 } : {}),
      ...(mine ? { mine: 1, ...memberParams(memberId) } : {}),
    };
    return coffeesCache.get(JSON.stringify(params), () => api.get('/tasting/coffees', { params }).then(getData));
  },
  invalidateCoffees: () => coffeesCache.invalidateAll(),
  matchCoffee: (q) => api.get('/tasting/coffees/match', { params: { q } }).then(getData),
  createCoffee: (body) => api.post('/tasting/coffees', body).then(getData).then(invalidateCoffees),
  getCoffee: (id) => api.get(`/tasting/coffees/${id}`).then(getData),
  // One page of this coffee's sessions (10, newest first). Uncached: reads change as flights close.
  getCoffeeSessions: (id, { before, sheet } = {}) =>
    api.get(`/tasting/coffees/${id}/sessions`, {
      params: { ...(before != null ? { before } : {}), ...(sheet ? { sheet } : {}) },
    }).then(getData),
  updateCoffee: (id, body) => api.patch(`/tasting/coffees/${id}`, body).then(getData).then(invalidateCoffees),
  archiveCoffee: (id) => api.post(`/tasting/coffees/${id}/archive`).then(getData).then(invalidateCoffees),
  unarchiveCoffee: (id) => api.post(`/tasting/coffees/${id}/unarchive`).then(getData).then(invalidateCoffees),
  // CSV round trip (editor or admin). Preview writes nothing; import needs the preview's plan_hash.
  downloadCoffeesCsv: () => downloadBlob('/tasting/coffees/export.csv', `coffees-${new Date().toLocaleDateString('en-CA')}.csv`),
  previewCoffeeImport: (formData) =>
    api.post('/tasting/coffees/import/preview', formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then(getData),
  importCoffees: (formData) =>
    api.post('/tasting/coffees/import', formData, { headers: { 'Content-Type': 'multipart/form-data' } })
      .then(getData).then(invalidateCoffees),

  // Flights
  // CSV upload of blind flights (editor or admin). Preview writes nothing; import needs the preview's plan_hash.
  previewFlightImport: (formData) =>
    api.post('/tasting/flights/import/preview', formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then(getData),
  importFlights: (formData) =>
    api.post('/tasting/flights/import', formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then(getData),
  getRecentFlights: ({ memberId } = {}) =>
    api.get('/tasting/flights/recent', { params: memberParams(memberId) }).then(getData),
  createFlight: (body) => api.post('/tasting/flights', body).then(getData).then(stampCreated).then(invalidateCoffees),
  getFlight: (id, { memberId } = {}) =>
    api.get(`/tasting/flights/${id}`, { params: memberParams(memberId) }).then(getData).then(stampFlight),
  logTastings: (id, entries, { memberId } = {}) =>
    api.post(`/tasting/flights/${id}/tastings`, { entries, ...memberBody(memberId) }).then(getData).then(stampFlight).then(invalidateCoffees),
  // Type a paper cupping sheet back in as someone else's read: exactly one of tasterMemberId / guestName.
  // `memberId` stays the shared device's pick of who is typing.
  enterPaperSheet: (id, { tasterMemberId, guestName, entries, memberId } = {}) =>
    api.post(`/tasting/flights/${id}/paper`, {
      ...(tasterMemberId != null ? { taster_member_id: tasterMemberId } : { guest_name: guestName }),
      entries, ...memberBody(memberId),
    }).then(getData).then(invalidateCoffees),
  // Read a photographed Advanced sheet into a pre-fill. Writes nothing, so the coffees cache stays. The shared
  // instance defaults to JSON, which would serialize the FormData to {}; multipart lets axios add the boundary.
  scanPaperSheet: (id, { photos, memberId } = {}) => {
    const form = new FormData();
    photos.forEach((p) => form.append('photos', p));
    if (memberId != null) form.append('member_id', String(memberId));
    return api.post(`/tasting/flights/${id}/paper/scan`, form, { headers: { 'Content-Type': 'multipart/form-data' } }).then(getData);
  },
  closeFlight: (id, { memberId } = {}) =>
    api.post(`/tasting/flights/${id}/close`, memberBody(memberId)).then(getData).then(stampFlight),
  // One person's read of a flight: the caller's own, or `tasterKey` for someone else's (editor or admin).
  deleteTastings: (id, { memberId, tasterKey } = {}) =>
    api.delete(`/tasting/flights/${id}/tastings`, { params: { ...memberParams(memberId), ...(tasterKey ? { taster_key: tasterKey } : {}) } })
      .then(getData).then(invalidateCoffees),
  deleteFlight: (id, { memberId } = {}) =>
    api.delete(`/tasting/flights/${id}`, { params: memberParams(memberId) }).then(getData).then(invalidateCoffees),
  getReveal: (id, { memberId } = {}) =>
    api.get(`/tasting/flights/${id}/reveal`, { params: memberParams(memberId) }).then(getData).then(stampNested),
  getSummary: (id, { memberId } = {}) =>
    api.get(`/tasting/flights/${id}/summary`, { params: memberParams(memberId) }).then(getData).then(stampNested),
  // Advanced cupping timer (host or an editor or admin). Starting twice restarts it.
  startTimer: (id, { memberId } = {}) =>
    api.post(`/tasting/flights/${id}/timer`, memberBody(memberId)).then(getData).then(stampFlight),
  // `pass` is absolute (1 hot, 2 comfortable, 3 warm); repeating it is a no-op.
  setPass: (id, pass, { memberId } = {}) =>
    api.post(`/tasting/flights/${id}/pass`, { pass, ...memberBody(memberId) }).then(getData).then(stampFlight),
  // Cup label -> coffee names for the account-door host of an open blind flight.
  // Deliberately uncached: the names must not outlive the screen that asked.
  getLabelKey: (id, { memberId } = {}) =>
    api.get(`/tasting/flights/${id}/label-key`, { params: memberParams(memberId) }).then(getData),
  // The host's pre-tasting edit: `cups` is the complete new list, top to bottom. Uncached, like the
  // key, because the answer names the cups. A rename changes a coffee, so the coffee list goes stale.
  putFlightCups: (id, { cups, newLabels = [], memberId } = {}) =>
    api.put(`/tasting/flights/${id}/cups`, { cups, new_labels: newLabels, ...memberBody(memberId) })
      .then(getData)
      .then((body) => (cups.some((c) => 'name' in c) ? invalidateCoffees(body) : body)),
  // A Advanced flight's result is the cupping summary; every other flight's is the reveal.
  getFlightResult: (flight, opts) =>
    (flight.sheet === 'advanced' ? tastingApi.getSummary(flight.id, opts) : tastingApi.getReveal(flight.id, opts)),
  downloadCuppingCsv: (id, filename) => downloadBlob(`/tasting/flights/${id}/export.csv`, filename || 'cupping.csv'),

  // Palate + roster
  getPalate: () => api.get('/tasting/palate').then(getData),
  // The group's active roster, for a shared device's name pick and paper entry. Rows are
  // normalised to the {id, name, first_name} tile shape.
  getMembers: () => api.get('/device/members').then(getData)
    .then((rows) => rows.map((m) => ({ id: m.id, name: m.display_name, first_name: m.display_name.split(/\s+/)[0] }))),
};

export default tastingApi;
