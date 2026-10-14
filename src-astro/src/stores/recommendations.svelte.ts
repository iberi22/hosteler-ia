import { getRecommendations, type Recommendation } from '../lib/recommendations';
import { createStorageAdapter } from '../lib/storageAdapter';
import { domainConfig } from '../lib/domain.config';
import { cloudClient } from '../cloud/client';

export const recsStore = $state<{
  items: Recommendation[];
  isLoading: boolean;
  error: string;
  cloudEnabled: boolean;
}>({
  items: [],
  isLoading: false,
  error: '',
  cloudEnabled: true, // assume true until we get a 404
});

export async function refreshRecommendations() {
  if (!cloudClient.enabled) {
    recsStore.cloudEnabled = false;
    return;
  }

  recsStore.isLoading = true;
  recsStore.error = '';

  try {
    const adapter = createStorageAdapter();
    const recs = await getRecommendations(adapter, domainConfig.instanceId);
    if (recs.length === 1 && recs[0].title === 'Sin recomendaciones') {
      recsStore.items = [];
    } else {
      recsStore.items = recs;
    }
  } catch (e: any) {
    if (e.message.includes('404') || e.message.includes('402')) {
      recsStore.cloudEnabled = false;
    } else {
      recsStore.error = e.message;
    }
  } finally {
    recsStore.isLoading = false;
  }
}
