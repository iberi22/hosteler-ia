<script lang="ts">
  import RecommendationPanel from './RecommendationPanel.svelte';
  import { onMount } from 'svelte';
  import type { Recommendation } from '../../lib/recommendations';
  import { getRecommendations } from '../../lib/recommendations';
  import { localInfer, detectLocalAiTier } from '../../lib/localAi';
  import { createStorageAdapter } from '../../lib/storageAdapter';
  import { domainConfig } from '../../lib/domain.config';

  let recommendations: Recommendation[] = $state([]);
  let loading: boolean = $state(false);
  let error: string = $state('');
  let aiTierLabel: string = $state('');

  async function fetchRecs() {
    loading = true;
    error = '';
    try {
      const adapter = createStorageAdapter();
      const recs = await getRecommendations(adapter, domainConfig.instanceId, localInfer);
      if (recs.length === 1 && recs[0].title === 'Sin recomendaciones') {
         recommendations = [];
      } else {
        recommendations = recs;
      }
    } catch (e: any) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  onMount(async () => {
    const tier = await detectLocalAiTier();
    aiTierLabel = tier === 'prompt-api' ? 'IA local: navegador' : 'IA local: reglas del local';
    fetchRecs();
  });
</script>

{#if loading || error || recommendations.length > 0}
  {#if aiTierLabel}
    <p data-testid="ai-tier" style="font-size: 0.8rem; color: var(--swal-text-muted, #94a3b8); margin-bottom: 0.5rem;">{aiTierLabel}</p>
  {/if}
  <RecommendationPanel {recommendations} {loading} {error} onRefresh={fetchRecs} />
{/if}
