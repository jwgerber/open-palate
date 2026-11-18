/**
 * Pure helpers over the SCA lexicon loaded from /api/content (content.js).
 *
 * A term's KEY is its path joined by KEY_SEP ("Fruity>Berry>blueberry") — the
 * same string the backend stores on tasting_tags.term. Labels repeat at
 * different depths in the SCA tree (Floral > Floral), so components must never
 * key on a bare label.
 *
 * `tags` everywhere is `{ [key]: 2 | 3 }` — 2 picked, 3 strong.
 */
import {
  KEY_SEP, FAMILY_HEX, FAMILY_TINT, MAX_TAGS_PER_CUP, SCALE_WORDS, INDEX, ROOT_KEYS, ALL_TERMS,
} from './content';

export { KEY_SEP, FAMILY_HEX, FAMILY_TINT, MAX_TAGS_PER_CUP, SCALE_WORDS, INDEX, ROOT_KEYS, ALL_TERMS };

export const keyOf = (path) => path.join(KEY_SEP);
export const labelOf = (key) => key.split(KEY_SEP).pop();

export const isValidTerm = (key) => Object.prototype.hasOwnProperty.call(INDEX, key);
export const familyOf = (key) => INDEX[key]?.family ?? 'other';
export const tintOf = (key) => FAMILY_TINT[familyOf(key)] ?? '#ECE7DC';
export const hexOf = (key) => FAMILY_HEX[familyOf(key)] ?? '#8B8593';

const hexToRgb = (hex) => hex.replace('#', '').match(/.{2}/g).map((h) => parseInt(h, 16));
/**
 * Family tint for the current theme mode. The light tints are fixed pastels
 * that vanish under dark-mode ink, so dark mode uses the SCA hue at low alpha
 * over the dark paper instead — same family colour, readable with light text.
 */
export function tintFor(key, mode = 'light') {
  if (mode !== 'dark') return tintOf(key);
  const [r, g, b] = hexToRgb(hexOf(key));
  return `rgba(${r},${g},${b},0.28)`;
}

/** Ancestor keys, root first. Empty for a family. */
export function ancestorsOf(key) {
  const path = INDEX[key]?.path ?? [];
  return path.slice(0, -1).map((_, i) => keyOf(path.slice(0, i + 1)));
}

/** The node at a wheel path (a list of labels from the root) and its children. */
export function nodeAt(path) {
  if (!path.length) return { node: null, children: ROOT_KEYS.map((k) => INDEX[k]) };
  const node = INDEX[keyOf(path)];
  if (!node) return { node: null, children: [] };
  return { node, children: node.children.map((k) => INDEX[k]) };
}

/** Picked keys that sit UNDER `key` in the tree. */
export const descendantsSelected = (key, tags) =>
  Object.keys(tags).filter((t) => t !== key && ancestorsOf(t).includes(key));

/**
 * Tap a term: none → picked (2) → strong (3) → none. Returns the next tags
 * object, or null when the tap is refused (cap reached, or "specific wins":
 * a heading can't be picked while a descendant is). Picking a leaf drops any
 * picked ancestor.
 */
export function cycleTag(tags, key) {
  const n = tags[key] || 0;
  if (n === 2) return { ...tags, [key]: 3 };
  if (n === 3) return removeTag(tags, key);
  if (descendantsSelected(key, tags).length) return null;
  const next = { ...tags };
  ancestorsOf(key).forEach((a) => { delete next[a]; });
  if (Object.keys(next).length >= MAX_TAGS_PER_CUP) return null;
  next[key] = 2;
  return next;
}

export function removeTag(tags, key) {
  const next = { ...tags };
  delete next[key];
  return next;
}

const list = (a) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);

/** The auto sentence built from the picked words. Display only — never saved to `note`. */
export function describe(tags) {
  const strong = Object.keys(tags).filter((k) => tags[k] === 3).map(labelOf);
  const mild = Object.keys(tags).filter((k) => tags[k] === 2).map(labelOf);
  if (!strong.length && !mild.length) return '';
  if (strong.length && mild.length) return `Mostly ${list(strong)}, with a hint of ${list(mild)}.`;
  if (strong.length) return `Mostly ${list(strong)}.`;
  return `Notes of ${list(mild)}.`;
}

/** Tags grouped by family for the picked tray, shallow terms first within a family. */
export function groupTags(tags) {
  const groups = {};
  Object.entries(tags).forEach(([key, strength]) => {
    const info = INDEX[key];
    if (!info) return;
    const fam = info.path[0];
    if (!groups[fam]) {
      groups[fam] = { familyKey: info.family, familyLabel: fam, tint: FAMILY_TINT[info.family], items: [] };
    }
    groups[fam].items.push({ key, label: info.label, strength, leaf: info.leaf, depth: info.tier });
  });
  return ROOT_KEYS.filter((k) => groups[k]).map((k) => ({
    ...groups[k], items: groups[k].items.sort((a, b) => a.depth - b.depth),
  }));
}

/** The worded value for a 1–5 attribute score. */
export const wordFor = (attr, value) => (value == null ? '' : SCALE_WORDS[attr][value - 1]);
