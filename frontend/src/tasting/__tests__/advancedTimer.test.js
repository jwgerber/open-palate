import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ADV_STEPS, advancedPhase, formatClock, gramsPerBowl, nextPass, stepStatus, totalGrams,
} from '../advanced/host/advancedTimer';
import { useElapsed } from '../advanced/host/useElapsed';

describe('advancedPhase', () => {
  it('is setup before the timer starts', () => {
    expect(advancedPhase(null, null)).toMatchObject({ key: 'setup', name: 'Setting up', hint: 'smell the dry grounds (fragrance)' });
  });

  it.each([
    [0, 'steep', 'Steeping', 'crust breaks at 5:00'],
    [299, 'steep', 'Steeping', 'crust breaks at 5:00'],
    [300, 'break', 'Break the crust', '4 stirs, sniff as it breaks'],
    [419, 'break', 'Break the crust', '4 stirs, sniff as it breaks'],
    [420, 'skim', 'Skim', 'same order and pace'],
    [599, 'skim', 'Skim', 'same order and pace'],
    [600, 'hotSoon', 'Hot pass next', 'check temp — under 160 °F'],
    [4000, 'hotSoon', 'Hot pass next', 'check temp — under 160 °F'],
  ])('pass 0 at %i s is %s', (elapsed, key, name, hint) => {
    expect(advancedPhase(elapsed, 0)).toMatchObject({ key, name, hint });
  });

  it.each([
    [1, 'hot', 'Hot pass', '~149 °F', 149],
    [2, 'comfortable', 'Comfortable pass', '~131 °F', 131],
    [3, 'warm', 'Warm pass', '~113 °F · last pass', 113],
  ])('pass %i is %s regardless of elapsed', (pass, key, name, hint, tempF) => {
    expect(advancedPhase(5, pass)).toMatchObject({ key, name, hint, tempF });
    expect(advancedPhase(5000, pass)).toMatchObject({ key, name, hint, tempF });
  });
});

describe('ADV_STEPS and stepStatus', () => {
  it('lists the seven timeline rows in order', () => {
    expect(ADV_STEPS.map((s) => s.key)).toEqual(['fragrance', 'pour', 'break', 'skim', 'hot', 'comfortable', 'warm']);
    expect(ADV_STEPS[2]).toMatchObject({ at: '5:00', name: 'Break the crust + sniff' });
    ADV_STEPS.forEach((s) => expect(s).toEqual(expect.objectContaining({ key: expect.any(String), at: expect.any(String), name: expect.any(String), detail: expect.any(String) })));
  });

  const statuses = (phaseKey) => ADV_STEPS.map((s) => stepStatus(s, { key: phaseKey }));
  it.each([
    ['setup', ['now', 'next', 'next', 'next', 'next', 'next', 'next']],
    ['steep', ['done', 'now', 'next', 'next', 'next', 'next', 'next']],
    ['break', ['done', 'done', 'now', 'next', 'next', 'next', 'next']],
    ['skim', ['done', 'done', 'done', 'now', 'next', 'next', 'next']],
    ['hotSoon', ['done', 'done', 'done', 'done', 'now', 'next', 'next']],
    ['hot', ['done', 'done', 'done', 'done', 'now', 'next', 'next']],
    ['comfortable', ['done', 'done', 'done', 'done', 'done', 'now', 'next']],
    ['warm', ['done', 'done', 'done', 'done', 'done', 'done', 'now']],
  ])('phase %s', (phaseKey, expected) => {
    expect(statuses(phaseKey)).toEqual(expected);
  });
});

describe('nextPass', () => {
  it('names the following pass and its temperature', () => {
    expect(nextPass(0)).toEqual({ pass: 1, label: 'Hot pass · ~149 °F' });
    expect(nextPass(1)).toEqual({ pass: 2, label: 'Comfortable pass · ~131 °F' });
    expect(nextPass(2)).toEqual({ pass: 3, label: 'Warm pass · ~113 °F' });
  });
  it('is null after the last pass or before the timer starts', () => {
    expect(nextPass(3)).toBeNull();
    expect(nextPass(null)).toBeNull();
  });
});

describe('formatClock', () => {
  it('formats m:ss with unbounded minutes', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(9)).toBe('0:09');
    expect(formatClock(300)).toBe('5:00');
    expect(formatClock(4325)).toBe('72:05');
  });
});

describe('grams', () => {
  it('gramsPerBowl is ml x 0.055 to 0.1 g, clamped to 150-200 ml', () => {
    expect(gramsPerBowl(180)).toBe(9.9);
    expect(gramsPerBowl(150)).toBe(8.3);
    expect(gramsPerBowl(100)).toBe(8.3);
    expect(gramsPerBowl(500)).toBe(11);
  });
  it('totalGrams multiplies out, clamping bowls to 1-6, rounded to 0.1', () => {
    expect(totalGrams(180, 3, 8)).toBe(237.6);
    expect(totalGrams(180, 0, 1)).toBe(9.9);
    expect(totalGrams(180, 9, 1)).toBe(59.4);
  });
});

describe('useElapsed', () => {
  const flight = (over = {}) => ({ is_open: true, timer_elapsed_s: 192, ...over });
  beforeEach(() => {
    vi.useFakeTimers();
    // Local clock 4 h off from anything the server knows: elapsed must not depend on it.
    vi.setSystemTime(new Date('2026-10-21T20:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('counts from the server value, ticking each second', () => {
    const { result } = renderHook(() => useElapsed(flight()));
    expect(result.current).toBe(192);
    act(() => { vi.advanceTimersByTime(3000); });
    expect(result.current).toBe(195);
  });

  it('does not re-anchor on a poll within 2 s of the local count', () => {
    const { result, rerender } = renderHook(({ f }) => useElapsed(f), { initialProps: { f: flight() } });
    act(() => { vi.advanceTimersByTime(3000); });
    rerender({ f: flight({ timer_elapsed_s: 196 }) });
    expect(result.current).toBe(195);
  });

  it('re-anchors when the server drifts more than 2 s', () => {
    const { result, rerender } = renderHook(({ f }) => useElapsed(f), { initialProps: { f: flight() } });
    act(() => { vi.advanceTimersByTime(3000); });
    rerender({ f: flight({ timer_elapsed_s: 300 }) });
    expect(result.current).toBe(300);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(result.current).toBe(302);
  });

  it('is null when not started or closed', () => {
    expect(renderHook(() => useElapsed(flight({ timer_elapsed_s: null }))).result.current).toBeNull();
    expect(renderHook(() => useElapsed(flight({ is_open: false }))).result.current).toBeNull();
  });

  it('starts counting when the timer starts after mount', () => {
    const { result, rerender } = renderHook(({ f }) => useElapsed(f), { initialProps: { f: flight({ timer_elapsed_s: null }) } });
    expect(result.current).toBeNull();
    rerender({ f: flight({ timer_elapsed_s: 0 }) });
    expect(result.current).toBe(0);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current).toBe(1);
  });

  it('counts from receipt, not mount: a remount 30 s later is 30 s on', () => {
    const f = flight({ timer_elapsed_s: 10, received_at_ms: Date.now(), adv_pass: 0 });
    const first = renderHook(() => useElapsed(f));
    act(() => { vi.advanceTimersByTime(30000); });
    expect(first.result.current).toBe(40);
    first.unmount();
    const second = renderHook(() => useElapsed(f));
    expect(second.result.current).toBe(40);
  });

  it('re-anchors downward on a restart', () => {
    const at = Date.now();
    const { result, rerender } = renderHook(({ f }) => useElapsed(f), {
      initialProps: { f: flight({ timer_elapsed_s: 300, received_at_ms: at, adv_pass: 1 }) },
    });
    act(() => { vi.advanceTimersByTime(5000); });
    expect(result.current).toBe(305);
    rerender({ f: flight({ timer_elapsed_s: 0, received_at_ms: Date.now(), adv_pass: 0 }) });
    expect(result.current).toBe(0);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(result.current).toBe(2);
  });

  it('goes null and stops ticking when the flight closes mid-run', () => {
    const { result, rerender } = renderHook(({ f }) => useElapsed(f), {
      initialProps: { f: flight({ timer_elapsed_s: 10, received_at_ms: Date.now(), adv_pass: 0 }) },
    });
    act(() => { vi.advanceTimersByTime(3000); });
    expect(result.current).toBe(13);
    rerender({ f: flight({ is_open: false, timer_elapsed_s: 13, received_at_ms: Date.now(), adv_pass: 0 }) });
    expect(result.current).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops ticking on unmount', () => {
    const { unmount } = renderHook(() => useElapsed(flight()));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
