<script lang="ts">
  import RecommendationPanel from './RecommendationPanel.svelte';
  import { recsStore, refreshRecommendations } from '../../stores/recommendations.svelte';
  import { onMount } from 'svelte';

  onMount(() => {
    refreshRecommendations();
  });
</script>

{#if recsStore.cloudEnabled && (recsStore.isLoading || recsStore.error || recsStore.items.length > 0)}
  <RecommendationPanel
    recommendations={recsStore.items}
    loading={recsStore.isLoading}
    error={recsStore.error}
    onRefresh={refreshRecommendations}
  />
{/if}
