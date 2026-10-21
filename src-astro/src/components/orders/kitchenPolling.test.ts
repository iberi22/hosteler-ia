import { describe, expect, it, vi } from 'vitest';
import {
  BASE_POLL_MS,
  MAX_POLL_MS,
  createKitchenPoller,
  setupKitchenPolling,
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

describe('reset() does not starve polls', () => {
  it('polls at least every BASE_POLL_MS despite resets every 5 s', async () => {
    vi.useFakeTimers();
    try {
      const poll = vi.fn(async () => false);
      const p = createKitchenPoller({ poll, isHidden: () => false });
      p.start();
      for (let t = 0; t < 60_000; t += 5_000) {
        await vi.advanceTimersByTimeAsync(5_000);
        p.reset();
      }
      expect(poll.mock.calls.length).toBeGreaterThanOrEqual(4);
      p.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reset after backoff to 30 s brings next poll within BASE_POLL_MS', async () => {
    vi.useFakeTimers();
    try {
      const poll = vi.fn(async () => false);
      const p = createKitchenPoller({ poll, isHidden: () => false });
      p.start();
      await vi.advanceTimersByTimeAsync(BASE_POLL_MS); // poll 1 -> delay 30 s
      expect(poll).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1_000);
      p.reset();
      await vi.advanceTimersByTimeAsync(BASE_POLL_MS);
      expect(poll).toHaveBeenCalledTimes(2);
      p.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('setupKitchenPolling', () => {
  function fakeTarget() {
    const added: string[] = [];
    const removed: string[] = [];
    return {
      added,
      removed,
      addEventListener: (t: string) => void added.push(t),
      removeEventListener: (t: string) => void removed.push(t),
    };
  }
  it('creates nothing when already destroyed', () => {
    const target = fakeTarget();
    const r = setupKitchenPolling({
      poll: async () => false,
      isDestroyed: () => true,
      target,
    });
    expect(r).toBeNull();
    expect(target.added).toEqual([]);
  });
  it('adds 3 listeners and removes them on dispose', () => {
    const target = fakeTarget();
    const r = setupKitchenPolling({
      poll: async () => false,
      isDestroyed: () => false,
      target,
    });
    expect(target.added.length).toBe(3);
    r?.dispose();
    expect(target.removed.sort()).toEqual([...target.added].sort());
  });
});
