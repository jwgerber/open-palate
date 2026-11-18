/**
 * Who wrote the sheet? Match the name read off a scanned sheet against the group's roster:
 * a unique full-name match, else a unique first-name match, else null (the host picks).
 */
export function matchTaster(readName, roster) {
  const name = (readName || '').trim().toLowerCase();
  if (!name || !Array.isArray(roster)) return null;
  const unique = (hits) => (hits.length === 1 ? { memberId: hits[0].id, name: hits[0].name } : null);
  const norm = (p) => (p.name || '').trim().toLowerCase();
  return unique(roster.filter((p) => norm(p) === name))
    || unique(roster.filter((p) => norm(p).split(/\s+/)[0] === name))
    || unique(roster.filter((p) => norm(p).split(/\s+/)[0] === name.split(/\s+/)[0]));
}
