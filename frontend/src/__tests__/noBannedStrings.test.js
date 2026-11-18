import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? walk(p) : [p];
});

describe('source hygiene', () => {
  it('has no source-sheet brand strings in src/ (names, text or file names)', () => {
    // Assembled from pieces so this file does not itself contain the words.
    const sheetBrand = ['Bar', 'ista', '|', 'Hus', 'tle'].join('');
    const banned = new RegExp(`\\b${'b'}h\\b|${sheetBrand}`, 'i');
    const offenders = walk(path.resolve(__dirname, '..'))
      .filter((f) => !f.endsWith('noBannedStrings.test.js'))
      .filter((f) => banned.test(path.basename(f)) || banned.test(fs.readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
