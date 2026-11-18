import { describe, it, expect } from 'vitest';
import {
  INDEX, ROOT_KEYS, keyOf, labelOf, ancestorsOf, nodeAt, descendantsSelected,
  cycleTag, removeTag, describe as sentence, groupTags, familyOf, isValidTerm, wordFor,
  ALL_TERMS, MAX_TAGS_PER_CUP,
} from '../lexicon';

const B = 'Fruity>Berry>blueberry';
const L = 'Fruity>Citrus>lemon';

describe('lexicon index', () => {
  it('has 200 terms across 9 families', () => {
    expect(ROOT_KEYS).toHaveLength(9);
    expect(ALL_TERMS).toHaveLength(200);
    expect(ROOT_KEYS[0]).toBe('Fruity');
  });

  it('keeps repeated labels apart by key', () => {
    expect(INDEX['Floral'].tier).toBe(1);
    expect(INDEX['Floral>Floral'].tier).toBe(2);
    expect(INDEX['Floral>Floral'].children).toEqual([
      'chamomile', 'rose', 'jasmine', 'hibiscus', 'lavender',
      'magnolia', 'honeysuckle', 'orange blossom', 'bergamot', 'lemongrass',
    ].map((l) => `Floral>Floral>${l}`));
  });

  it('resolves paths and ancestry', () => {
    expect(keyOf(['Fruity', 'Berry'])).toBe('Fruity>Berry');
    expect(labelOf(B)).toBe('blueberry');
    expect(ancestorsOf(B)).toEqual(['Fruity', 'Fruity>Berry']);
    expect(ancestorsOf('Fruity')).toEqual([]);
    expect(familyOf('Other>Chemical>rubber')).toBe('other');
    expect(isValidTerm('blueberry')).toBe(false);
    expect(nodeAt([]).children.map((c) => c.label)).toContain('Roasted');
    expect(nodeAt(['Fruity', 'Berry']).node.label).toBe('Berry');
    expect(nodeAt(['Fruity', 'Berry']).children.map((c) => c.label)).toEqual(['blackberry', 'raspberry', 'blueberry', 'strawberry', 'cranberry', 'currant']);
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
    ['Fruity', 'Floral', 'Sweet', 'Spices', 'Roasted'].forEach((k) => { tags = cycleTag(tags, k); });
    expect(Object.keys(tags)).toHaveLength(MAX_TAGS_PER_CUP);
    expect(cycleTag(tags, 'Other')).toBeNull();
    // Strengthening an existing pick is still allowed at the cap.
    expect(cycleTag(tags, 'Fruity')).toEqual({ ...tags, Fruity: 3 });
  });

  it('specific wins: a leaf drops picked ancestors, a heading is refused under a picked leaf', () => {
    const withFamily = cycleTag({}, 'Fruity');
    expect(cycleTag(withFamily, B)).toEqual({ [B]: 2 });
    expect(cycleTag({ [B]: 2 }, 'Fruity')).toBeNull();
    expect(cycleTag({ [B]: 2 }, 'Fruity>Berry')).toBeNull();
    expect(descendantsSelected('Fruity', { [B]: 2, [L]: 3, Floral: 2 })).toEqual([B, L]);
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
    expect(sentence({ [L]: 2, 'Nutty / Cocoa>Cocoa>chocolate': 2 })).toBe('Notes of lemon and chocolate.');
  });

  it('groups by family in wheel order, shallow first', () => {
    const groups = groupTags({ [B]: 3, Floral: 2, 'Fruity>Citrus': 2 });
    expect(groups.map((g) => g.familyLabel)).toEqual(['Fruity', 'Floral']);
    expect(groups[0].items.map((i) => i.label)).toEqual(['Citrus', 'blueberry']);
    expect(groups[0].items[1]).toMatchObject({ strength: 3, leaf: true });
    expect(groups[0].items[0].leaf).toBe(false);
    expect(groups[0].tint).toBe('#F5C6C7');
  });

  it('words a score', () => {
    expect(wordFor('overall', 5)).toBe('would buy a bag');
    expect(wordFor('acidity', null)).toBe('');
  });
});
