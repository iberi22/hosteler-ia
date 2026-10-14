import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiFetch, setTier } from './api-client';

describe('api-client 429 backoff', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.useFakeTimers();
    setTier('free');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('retries on 429 response using retry-after header', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce({ status: 429, headers: new Headers({ 'retry-after': '1' }) } as any)
      .mockResolvedValueOnce({ status: 200 } as any);

    const promise = apiFetch('http://test.local/api/test');

    // First call happens immediately after throttle (300ms)
    await vi.advanceTimersByTimeAsync(300);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Wait for retry-after (1000ms)
    await vi.advanceTimersByTimeAsync(1000);
    const res = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.status).toBe(200);
  });

  it('gives up after max retries on continuous 429 responses', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({ status: 429, headers: new Headers() } as any);

    const promise = apiFetch('http://test.local/api/test', {}, 3);

    // Attempt 0: initial call (after 300ms throttle)
    await vi.advanceTimersByTimeAsync(300);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Attempt 1: backoff is Math.pow(2, 0) * 500 + random = 500ms + random
    // Advance timers by enough to cover 500 + jitter (max 200) = 700ms
    await vi.advanceTimersByTimeAsync(700);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Attempt 2: backoff is Math.pow(2, 1) * 500 + random = 1000ms + random
    await vi.advanceTimersByTimeAsync(1200);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Attempt 3: backoff is Math.pow(2, 2) * 500 + random = 2000ms + random
    await vi.advanceTimersByTimeAsync(2200);
    const res = await promise;
    expect(fetchMock).toHaveBeenCalledTimes(4);

    expect(res.status).toBe(429);
  });
});
