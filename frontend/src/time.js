/**
 * Group-timezone formatting. The backend serializes naive-UTC datetimes with
 * `.isoformat()` ("2026-05-20T11:59:00"); a plain `dayjs(iso)` would read them
 * as browser-local time. Offset-less strings are UTC here, rendered in the
 * group's own zone (from /api/auth/me) whatever the viewer's browser says.
 */
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

const hasTimezone = (s) => /Z$|[+-]\d{2}:?\d{2}$/.test(s);

/** Parse an ISO string into a dayjs in `tz` (IANA name). Null for empty input. */
export function toGroupTime(iso, tz) {
  if (!iso) return null;
  const asUtc = hasTimezone(iso) ? iso : `${iso}Z`;
  return dayjs(asUtc).tz(tz || 'UTC');
}

let groupTimezone = 'UTC';

/** The signed-in group's zone; AuthProvider sets it from /api/auth/me. */
export function setGroupTimezone(tz) { groupTimezone = tz || 'UTC'; }
export const getGroupTimezone = () => groupTimezone;

const tzOf = (tz) => tz || groupTimezone;

/** "h:mma" (or `fmt`) for a server timestamp, in the group's zone. */
export function formatTime(iso, fmt = 'h:mma', tz) {
  if (!iso) return '—';
  return toGroupTime(iso, tzOf(tz)).format(fmt);
}

/** "Today" / "Yesterday" / "Mon, Sep 7" for a server timestamp, in the group's zone. */
export function formatWhen(iso, tz) {
  const t = toGroupTime(iso, tzOf(tz));
  if (!t) return '';
  const today = dayjs().tz(tzOf(tz)).startOf('day');
  const diff = today.diff(t.startOf('day'), 'day');
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return t.format('ddd, MMM D');
}
