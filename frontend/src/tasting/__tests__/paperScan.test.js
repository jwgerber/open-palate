import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
import api from '../../api';
import { tastingApi } from '../tastingApi';
import { matchTaster } from '../paper/matchTaster';
import { shrinkPhoto } from '../paper/shrinkPhoto';

describe('tastingApi.scanPaperSheet', () => {
  beforeEach(() => { api.post.mockReset().mockResolvedValue({ data: { taster: { read_name: 'Sam' }, cups: [], warnings: [] } }); });

  it('posts FormData with every photo and the shared device id, and returns the body', async () => {
    const a = new Blob(['a'], { type: 'image/jpeg' });
    const b = new Blob(['b'], { type: 'image/jpeg' });
    const body = await tastingApi.scanPaperSheet(7, { photos: [a, b], memberId: 12 });
    const [url, form] = api.post.mock.calls[0];
    expect(url).toBe('/tasting/flights/7/paper/scan');
    expect(form).toBeInstanceOf(FormData);
    expect(form.getAll('photos')).toHaveLength(2);
    expect(form.get('member_id')).toBe('12');
    expect(api.post.mock.calls[0][2]).toEqual({ headers: { 'Content-Type': 'multipart/form-data' } });
    expect(body.taster.read_name).toBe('Sam');
  });

  it('omits member_id when not given, and never invalidates the coffees cache', async () => {
    api.get = vi.fn().mockResolvedValue({ data: [] });
    await tastingApi.getCoffees({ storeId: 99 });
    await tastingApi.scanPaperSheet(7, { photos: [new Blob(['a'])] });
    await tastingApi.getCoffees({ storeId: 99 });
    expect(api.post.mock.calls[0][1].has('member_id')).toBe(false);
    expect(api.get).toHaveBeenCalledTimes(1); // second read came from the cache
  });
});

describe('matchTaster', () => {
  const roster = (...names) => names.map((name, i) => ({ id: i + 1, name }));

  it('matches a full name case-insensitively', () => {
    expect(matchTaster('sam rivera', roster('Sam Rivera', 'Dee Lopez'))).toEqual({ memberId: 1, name: 'Sam Rivera' });
  });
  it('matches a unique first name, but not an ambiguous one', () => {
    expect(matchTaster('Sam', roster('Sam Rivera', 'Dee Lopez'))).toEqual({ memberId: 1, name: 'Sam Rivera' });
    expect(matchTaster('Sam', roster('Sam Rivera', 'Sam Okoro'))).toBeNull();
  });
  it('matches the first token of a longer read name to a sole first name, not to two', () => {
    expect(matchTaster('Sam R', roster('Sam Rivera', 'Dee Lopez'))).toEqual({ memberId: 1, name: 'Sam Rivera' });
    expect(matchTaster('Sam R', roster('Sam Rivera', 'Sam Okoro'))).toBeNull();
  });
  it('prefers a unique full-name match over an ambiguous first name', () => {
    expect(matchTaster('Sam Okoro', roster('Sam Rivera', 'Sam Okoro'))).toEqual({ memberId: 2, name: 'Sam Okoro' });
  });
  it('returns null for blank, null name or null roster', () => {
    expect(matchTaster(null, roster('Sam'))).toBeNull();
    expect(matchTaster('   ', roster('Sam'))).toBeNull();
    expect(matchTaster('Sam', null)).toBeNull();
  });
});

describe('shrinkPhoto', () => {
  let drawImage; let toBlob;
  beforeEach(() => {
    drawImage = vi.fn();
    toBlob = vi.fn((cb) => cb(new Blob(['x'], { type: 'image/jpeg' })));
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 4000, height: 3000, close: vi.fn() }));
    vi.spyOn(document, 'createElement').mockImplementation(() => {
      const canvas = { getContext: () => ({ drawImage }), toBlob };
      return canvas;
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('scales a 4000x3000 photo to 2000x1500 and encodes JPEG at 0.85', async () => {
    const out = await shrinkPhoto(new File(['x'], 'sheet.jpg', { type: 'image/jpeg' }));
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 2000, 1500);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.85);
    expect(out.type).toBe('image/jpeg');
  });

  it('returns a small JPEG unchanged', async () => {
    createImageBitmap.mockResolvedValue({ width: 1200, height: 900, close: vi.fn() });
    const file = new File(['x'], 'sheet.jpg', { type: 'image/jpeg' });
    expect(await shrinkPhoto(file)).toBe(file);
    expect(toBlob).not.toHaveBeenCalled();
  });

  it('re-encodes a PNG even when it fits', async () => {
    createImageBitmap.mockResolvedValue({ width: 1200, height: 900, close: vi.fn() });
    await shrinkPhoto(new File(['x'], 'sheet.png', { type: 'image/png' }));
    expect(toBlob).toHaveBeenCalled();
  });
});
