/** Non-component helpers for the Log tab, kept out of the component file for fast refresh. */
import { formatTime, formatWhen } from '../../time';
import { prepWord } from '../format';

export function flightMeta(f) {
  return [formatWhen(f.opened_at), prepWord(f.prep), f.is_shared ? 'shared' : null].filter(Boolean).join(' · ');
}

/** "Thu, Nov 5 at 4:30pm" or "today at 4:30pm" in the group's time zone, from the flight's real `closes_at`; '' when it has none. */
export function closesText(iso) {
  if (!iso) return '';
  const day = formatWhen(iso);
  return `${day === 'Today' ? 'today' : day} at ${formatTime(iso)}`;
}
