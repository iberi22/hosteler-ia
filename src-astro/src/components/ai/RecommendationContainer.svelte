<script lang="ts">
  import RecommendationPanel from './RecommendationPanel.svelte';
  import { onMount } from 'svelte';
  import type { Recommendation } from '../../lib/recommendations';
  import { getRecommendations } from '../../lib/recommendations';
  import { localInfer, detectLocalAiTier } from '../../lib/localAi';
  import { createStorageAdapter } from '../../lib/storageAdapter';
  import { getIdbAdapter } from '../../lib/idbAdapter';
  import { ensureIdentity } from '../../lib/local/identity';
  import { domainConfig } from '../../lib/domain.config';
  import type { StorageAdapter } from '../../lib/domain';

  interface Props {
    adapter?: StorageAdapter;
    instanceId?: string;
  }

  let { adapter: propAdapter, instanceId: propInstanceId }: Props = $props();

  let recommendations: Recommendation[] = $state([]);
  let loading: boolean = $state(false);
  let error: string = $state('');
  let aiTierLabel: string = $state('');

  async function fetchRecs() {
    loading = true;
    error = '';
    try {
      let adapter = propAdapter;
      let instId = propInstanceId;

      if (!adapter || !instId) {
        try {
          const identity = await ensureIdentity();
          adapter = adapter ?? getIdbAdapter();
          instId = instId ?? identity.instanceId;
        } catch {
          adapter = adapter ?? createStorageAdapter();
          instId = instId ?? domainConfig.instanceId;
        }
      }

      const recs = await getRecommendations(adapter, instId, localInfer);
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
    await fetchRecs();
  });
</script>

{#if loading || error || recommendations.length > 0}
  {#if aiTierLabel}
    <p data-testid="ai-tier" style="font-size: 0.8rem; color: var(--swal-text-muted, #94a3b8); margin-bottom: 0.5rem;">{aiTierLabel}</p>
  {/if}
  <RecommendationPanel {recommendations} {loading} {error} onRefresh={fetchRecs} />
{/if}
