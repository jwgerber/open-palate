/** "Nov 5", or "Nov 5, 2025" when the date isn't this year (cups are dated by group-local ISO day). */
export function cupDate(iso) {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  const opts = { month: 'short', day: 'numeric', ...(d.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }) };
  return d.toLocaleDateString('en-US', opts);
}
