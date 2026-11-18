/**
 * Why a flight can't be edited, or null. Mirrors `tasting/flight_edit.lock_reason`; the
 * server stays the authority (409 `flight_locked`).
 */
export function flightEditLock(flight) {
  if (!flight.is_open) return 'This flight is closed, so it can’t be edited.';
  if ((flight.logged_count ?? 0) > 0) return 'Someone has already logged a read, so this flight can’t be edited.';
  if (flight.timer_started_at) return 'The timer has started, so this flight can’t be edited.';
  return null;
}
