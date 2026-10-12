<script lang="ts">
  // RecommendationPanel.svelte — recomendaciones Fi'ze para el dashboard
  import type { Recommendation } from '../../lib/recommendations';

  interface Props {
    recommendations?: Recommendation[];
    loading?: boolean;
    error?: string;
    onRefresh?: () => void;
  }

  let { recommendations = [], loading = false, error = '', onRefresh }: Props = $props();
</script>

<section class="recs" aria-label="Recomendaciones Fi'ze">
  <header>
    <h2>✨ Fi’ze recomienda</h2>
    {#if onRefresh}
      <button onclick={onRefresh} disabled={loading}>{loading ? '…' : 'Actualizar'}</button>
    {/if}
  </header>
  {#if loading}
    <p>Analizando tu restaurante…</p>
  {:else if error}
    <p role="alert" class="error">{error}</p>
  {:else if recommendations.length === 0}
    <p>Sin recomendaciones por ahora.</p>
  {:else}
    <ul>
      {#each recommendations as rec}
        <li class={`rec-${rec.type}`}>
          <strong>[{rec.type}] {rec.title}</strong>
          <p>{rec.detail}</p>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .recs { border: 1px solid var(--swal-border, #1e293b); border-radius: 0.6rem; padding: 1rem; }
  header { display: flex; justify-content: space-between; align-items: center; }
  ul { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 0.6rem; }
  li { padding: 0.6rem; border-radius: 0.5rem; background: var(--swal-bg, #050507); }
  .error { color: #f87171; }
</style>
