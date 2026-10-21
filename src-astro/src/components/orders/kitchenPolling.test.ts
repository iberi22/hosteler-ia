import { describe, expect, it, vi } from 'vitest';
import {
  BASE_POLL_MS,
  MAX_POLL_MS,
  createKitchenPoller,
  nextPollDelay,
} from './kitchenPolling';

describe('nextPollDelay', () => {
  it('resets to base on change', () => {
    expect(nextPollDelay(60_000, true)).toBe(BASE_POLL_MS);
  });
  it('doubles when unchanged, capped at max', () => {
    expect(MAX_POLL_MS).toBe(30_000);
    expect(nextPollDelay(15_000, false)).toBe(30_000);
    expect(nextPollDelay(30_000, false)).toBe(MAX_POLL_MS);
    expect(nextPollDelay(60_000, false)).toBe(30_000);
    expect(nextPollDelay(120_000, false)).toBe(MAX_POLL_MS);
  });
});

function harness(hidden = false) {
  let pending: { fn: () => void; ms: number } | null = null;
  const state = { hidden };
  const poll = vi.fn(async () => false);
  const p = createKitchenPoller({
    poll,
    isHidden: () => state.hidden,
    setTimer: (fn, ms) => {
      pending = { fn, ms };
      return 1;
    },
    clearTimer: () => {
      pending = null;
    },
  });
  return { p, poll, state, get pending() { return pending; } };
}

describe('createKitchenPoller', () => {
  it('backs off while nothing changes', async () => {
    const h = harness();
    h.p.start();
    expect(h.pending?.ms).toBe(15_000);
    for (const ms of [30_000, 30_000, 30_000, 30_000]) {
      h.pending!.fn();
      await Promise.resolve();
      await Promise.resolve();
      expect(h.pending?.ms).toBe(ms);
    }
  });

  it('does not poll or schedule while hidden, resumes on visible', async () => {
    const h = harness(true);
    h.p.start();
    expect(h.poll).not.toHaveBeenCalled();
    expect(h.pending).toBeNull();
    h.state.hidden = false;
    h.p.onVisibilityChange();
    await Promise.resolve();
    expect(h.poll).toHaveBeenCalledTimes(1);
    expect(h.pending?.ms).toBeGreaterThan(0);
  });

  it('user action resets the interval to base', async () => {
    const h = harness();
    h.p.start();
    h.pending!.fn();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.pending?.ms).toBe(30_000);
    h.p.reset();
    expect(h.pending?.ms).toBe(BASE_POLL_MS);
  });

  it('stop cancels the timer', () => {
    const h = harness();
    h.p.start();
    h.p.stop();
    expect(h.pending).toBeNull();
  });
});
