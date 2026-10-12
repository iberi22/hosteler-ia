import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { refreshMenuNutrition } from './menuNutritionCache';
import type { PublicNutrition } from './publicMenuNutrition';

const totals: PublicNutrition = { dish: {
  nutrition: { calories: 100 }, micronutrients: {}, allergens: [],
  linked: 1, total: 1, partial: false, dataset: '0.0.1+sha256:fixture',
} };

describe('cached public totals', () => {
  it('retains the last projection after network failure', async () => {
    const url = `/api/menu-nutrition?slug=${crypto.randomUUID()}`;
    await refreshMenuNutrition(url, () => {}, async () => Response.json(totals));
    const receive = vi.fn();
    await refreshMenuNutrition(url, receive, async () => { throw new TypeError('offline'); });
    expect(receive).toHaveBeenCalledWith(totals);
    expect(receive).toHaveBeenCalledTimes(1);
  });
  it('retains totals when server GOS is unavailable (503)', async () => {
    const url = `/api/menu-nutrition?slug=${crypto.randomUUID()}`;
    await refreshMenuNutrition(url, () => {}, async () => Response.json(totals));
    const receive = vi.fn();
    await refreshMenuNutrition(url, receive, async () => Response.json({}, { status: 503 }));
    expect(receive).toHaveBeenLastCalledWith(totals);
  });
  it('clears stale totals when a successful refresh has no linked data', async () => {
    const url = `/api/menu-nutrition?slug=${crypto.randomUUID()}`;
    await refreshMenuNutrition(url, () => {}, async () => Response.json(totals));
    const receive = vi.fn();
    await refreshMenuNutrition(url, receive, async () => Response.json({}));
    expect(receive.mock.calls).toEqual([[totals], [{}]]);
    receive.mockClear();
    await refreshMenuNutrition(url, receive, async () => { throw new TypeError('offline'); });
    expect(receive).toHaveBeenCalledWith({});
  });
  it('isolates projections by store and instance', async () => {
    const url = `/api/menu-nutrition?slug=${crypto.randomUUID()}&instance_id=one`;
    await refreshMenuNutrition(url, () => {}, async () => Response.json(totals));
    const receive = vi.fn();
    await refreshMenuNutrition(url.replace('one', 'two'), receive, async () => { throw new TypeError('offline'); });
    expect(receive).not.toHaveBeenCalled();
  });
});
