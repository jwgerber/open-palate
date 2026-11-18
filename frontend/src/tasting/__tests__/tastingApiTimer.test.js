import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
import api from '../../api';
import { tastingApi } from '../tastingApi';

describe('tastingApi Advanced timer calls', () => {
  beforeEach(() => {
    api.get.mockReset().mockResolvedValue({ data: { ok: 1 } });
    api.post.mockReset().mockResolvedValue({ data: { ok: 1 } });
  });

  it('startTimer posts the shared device id only when given', async () => {
    await tastingApi.startTimer(7);
    expect(api.post).toHaveBeenLastCalledWith('/tasting/flights/7/timer', {});
    await tastingApi.startTimer(7, { memberId: 12 });
    expect(api.post).toHaveBeenLastCalledWith('/tasting/flights/7/timer', { member_id: 12 });
  });

  it('setPass posts the absolute pass', async () => {
    await tastingApi.setPass(7, 2, { memberId: 12 });
    expect(api.post).toHaveBeenLastCalledWith('/tasting/flights/7/pass', { pass: 2, member_id: 12 });
  });

  it('getLabelKey is never cached', async () => {
    await tastingApi.getLabelKey(7);
    await tastingApi.getLabelKey(7);
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(api.get).toHaveBeenLastCalledWith('/tasting/flights/7/label-key', { params: {} });
  });

  it('stamps received_at_ms on every flight dict it returns, and not on the label key', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T20:00:00Z'));
    const now = Date.now();
    try {
      api.get.mockResolvedValue({ data: { id: 7, timer_elapsed_s: 10 } });
      api.post.mockResolvedValue({ data: { id: 7, timer_elapsed_s: 0 } });
      for (const call of [
        () => tastingApi.getFlight(7),
        () => tastingApi.startTimer(7),
        () => tastingApi.setPass(7, 1),
        () => tastingApi.closeFlight(7),
        () => tastingApi.logTastings(7, []),
        () => tastingApi.createFlight({}),
      ]) {
        expect((await call()).received_at_ms).toBe(now);
      }
      api.get.mockResolvedValue({ data: { flight: { id: 7 }, coffees: [] } });
      expect((await tastingApi.getSummary(7)).flight.received_at_ms).toBe(now);
      expect((await tastingApi.getReveal(7)).flight.received_at_ms).toBe(now);
      api.post.mockResolvedValue({ data: { id: 7, reveal: { flight: { id: 7 }, cups: [] } } });
      expect((await tastingApi.createFlight({})).reveal.flight.received_at_ms).toBe(now);
      api.get.mockResolvedValue({ data: { cups: [] } });
      expect(await tastingApi.getLabelKey(7)).toEqual({ cups: [] });
    } finally {
      vi.useRealTimers();
    }
  });
});
