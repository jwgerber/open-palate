import { describe, it, expect } from 'vitest';
import {
  INDEX, ROOT_KEYS, keyOf, labelOf, ancestorsOf, nodeAt, descendantsSelected,
  cycleTag, removeTag, describe as sentence, groupTags, familyOf, isValidTerm, wordFor,
  ALL_TERMS, MAX_TAGS_PER_CUP,
} from '../lexicon';

const B = 'Fruit>Berry>blueberry';
const L = 'Fruit>Citrus>lemon';

describe('lexicon index', () => {
  it('has the 2020 wheel: 142 terms across 10 families', () => {
    expect(ROOT_KEYS).toHaveLength(10);
    expect(ALL_TERMS).toHaveLength(142);
    expect(ROOT_KEYS[0]).toBe('Fruit');
  });

  it('puts notes straight under families outside Fruit', () => {
    expect(INDEX['Floral'].tier).toBe(1);
    expect(INDEX['Floral'].children).toEqual([
      'lemongrass', 'orange blossom', 'jasmine', 'honeysuckle',
      'magnolia', 'lavender', 'rose / rosewater', 'hibiscus',
    ].map((l) => `Floral>${l}`));
  });

  it('resolves paths and ancestry', () => {
    expect(keyOf(['Fruit', 'Berry'])).toBe('Fruit>Berry');
    expect(labelOf(B)).toBe('blueberry');
    expect(ancestorsOf(B)).toEqual(['Fruit', 'Fruit>Berry']);
    expect(ancestorsOf('Fruit')).toEqual([]);
    expect(familyOf('Vegetal / Earthy / Herb>cedar')).toBe('vegetal');
    expect(isValidTerm('blueberry')).toBe(false);
    expect(isValidTerm('Fruity>Berry>blueberry')).toBe(false);
    expect(nodeAt([]).children.map((c) => c.label)).toContain('Roast');
    expect(nodeAt(['Fruit', 'Berry']).node.label).toBe('Berry');
    expect(nodeAt(['Fruit', 'Berry']).children.map((c) => c.label)).toEqual(['cranberry', 'raspberry', 'strawberry', 'blueberry', 'blackberry', 'currant']);
    expect(nodeAt(['Nope']).children).toEqual([]);
  });
});

describe('cycleTag', () => {
  it('cycles none → picked → strong → none', () => {
    const t1 = cycleTag({}, B);
    expect(t1).toEqual({ [B]: 2 });
    const t2 = cycleTag(t1, B);
    expect(t2).toEqual({ [B]: 3 });
    expect(cycleTag(t2, B)).toEqual({});
  });

  it('caps at five terms', () => {
    let tags = {};
    ['Fruit', 'Floral', 'Nut', 'Spice', 'Roast'].forEach((k) => { tags = cycleTag(tags, k); });
    expect(Object.keys(tags)).toHaveLength(MAX_TAGS_PER_CUP);
    expect(cycleTag(tags, 'Savory')).toBeNull();
    // Strengthening an existing pick is still allowed at the cap.
    expect(cycleTag(tags, 'Fruit')).toEqual({ ...tags, Fruit: 3 });
  });

  it('specific wins: a leaf drops picked ancestors, a heading is refused under a picked leaf', () => {
    const withFamily = cycleTag({}, 'Fruit');
    expect(cycleTag(withFamily, B)).toEqual({ [B]: 2 });
    expect(cycleTag({ [B]: 2 }, 'Fruit')).toBeNull();
    expect(cycleTag({ [B]: 2 }, 'Fruit>Berry')).toBeNull();
    expect(descendantsSelected('Fruit', { [B]: 2, [L]: 3, Floral: 2 })).toEqual([B, L]);
  });

  it('removeTag is non-mutating', () => {
    const tags = { [B]: 2, [L]: 3 };
    expect(removeTag(tags, B)).toEqual({ [L]: 3 });
    expect(tags).toEqual({ [B]: 2, [L]: 3 });
  });
});

describe('describe + groupTags', () => {
  it('builds the three sentence shapes', () => {
    expect(sentence({})).toBe('');
    expect(sentence({ [B]: 3 })).toBe('Mostly blueberry.');
    expect(sentence({ [B]: 3, [L]: 2, Floral: 2 })).toBe('Mostly blueberry, with a hint of lemon and Floral.');
    expect(sentence({ [L]: 2, 'Chocolate>dark chocolate': 2 })).toBe('Notes of lemon and dark chocolate.');
  });

  it('groups by family in wheel order, shallow first', () => {
    const groups = groupTags({ [B]: 3, Floral: 2, 'Fruit>Citrus': 2 });
    expect(groups.map((g) => g.familyLabel)).toEqual(['Fruit', 'Floral']);
    expect(groups[0].items.map((i) => i.label)).toEqual(['Citrus', 'blueberry']);
    expect(groups[0].items[1]).toMatchObject({ strength: 3, leaf: true });
    expect(groups[0].items[0].leaf).toBe(false);
    expect(groups[0].tint).toBe('#F8D0DD');
  });

  it('words a score', () => {
    expect(wordFor('overall', 5)).toBe('would buy a bag');
    expect(wordFor('acidity', null)).toBe('');
  });
});
