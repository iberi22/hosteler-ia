import { indexedDbCache } from '@swal/gos-client';
import { resilientCache } from './gos';
import type { PublicNutrition } from './publicMenuNutrition';

const cache = resilientCache(indexedDbCache('fize-public-nutrition-v1'));

/** Read saved public totals immediately, then refresh independently of cart state. */
export async function refreshMenuNutrition(
  url: string, receive: (data: PublicNutrition) => void, fetcher: typeof fetch = fetch,
) {
  const key = `${url}:totals`;
  const cached = await cache.get<PublicNutrition>(key);
  if (cached) receive(cached);
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return;
    const data: PublicNutrition = await response.json();
    await cache.set(key, data);
    receive(data);
  } catch { /* retain optional cached metadata */ }
}
