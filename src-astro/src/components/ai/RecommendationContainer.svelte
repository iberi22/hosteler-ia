<script lang="ts">
  import RecommendationPanel from './RecommendationPanel.svelte';
  import { onMount } from 'svelte';
  import type { Recommendation } from '../../lib/recommendations';
  import { getRecommendations } from '../../lib/recommendations';
  import { createStorageAdapter } from '../../lib/storageAdapter';
  import { domainConfig } from '../../lib/domain.config';

  let recommendations: Recommendation[] = $state([]);
  let loading: boolean = $state(false);
  let error: string = $state('');
  let cloudEnabled: boolean = $state(true);

  async function checkCloud() {
    try {
      const res = await fetch('/api/ai/infer', { method: 'GET' });
      // 404 = cloud disabled module. 402 = socio tier required (but module is technically there, but maybe we should disable panel for 402 as well). 
      // The requirement says: "When the engine returns no suggestions or the cloud route is disabled, render nothing".
      if (res.status === 404 || res.status === 402) {
        cloudEnabled = false;
      }
    } catch {
       cloudEnabled = false;
    }
  }

  async function fetchRecs() {
    if (!cloudEnabled) return;
    loading = true;
    error = '';
    try {
      const adapter = createStorageAdapter();
      const recs = await getRecommendations(adapter, domainConfig.instanceId);
      if (recs.length === 1 && recs[0].title === 'Sin recomendaciones') {
         recommendations = [];
      } else {
        recommendations = recs;
      }
    } catch (e: any) {
      if (e.message.includes('404') || e.message.includes('402')) {
        cloudEnabled = false;
      } else {
        error = e.message;
      }
    } finally {
      loading = false;
    }
  }

  onMount(async () => {
    await checkCloud();
    if (cloudEnabled) {
      fetchRecs();
    }
  });
</script>

{#if cloudEnabled && (loading || error || recommendations.length > 0)}
  <RecommendationPanel {recommendations} {loading} {error} onRefresh={fetchRecs} />
{/if}
