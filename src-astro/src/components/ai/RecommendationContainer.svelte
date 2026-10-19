<script lang="ts">
  import RecommendationPanel from './RecommendationPanel.svelte';
  import { onMount } from 'svelte';
  import type { Recommendation } from '../../lib/recommendations';
  import { getRecommendations } from '../../lib/recommendations';
  import { localInferWithTier } from '../../lib/localAi';
  import { getIdbAdapter } from '../../lib/idbAdapter';
  import { loadIdentity } from '../../lib/local/identity';
  import { isLocalMode } from '../../lib/local/localMode';
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
  // Solo hay panel si este equipo tiene un local creado. Sin identidad no se muestra nada: el
  // dashboard de nube (staff) no debe crear ni dar por existente un restaurante local.
  let visible: boolean = $state(false);

  async function fetchRecs() {
    loading = true;
    error = '';
    try {
      let adapter = propAdapter;
      let instId = propInstanceId;

      if (!adapter || !instId) {
        // Fuera de /local/ no hay nodo local que leer: el dashboard de nube no toca datos del equipo.
        if (!isLocalMode()) {
          visible = false;
          return;
        }
        // Solo lectura: nunca crea identidad (a diferencia de ensureIdentity).
        const identity = await loadIdentity();
        if (!identity) {
          visible = false;
          return;
        }
        adapter = adapter ?? getIdbAdapter();
        instId = instId ?? identity.instanceId;
      }

      visible = true;

      // La etiqueta sale del tier que realmente uso localInfer (si el navegador rechaza, son reglas).
      const inferWithTier = async (prompt: string) => {
        const result = await localInferWithTier(prompt);
        aiTierLabel = result.tier === 'prompt-api' ? 'IA local: navegador' : 'IA local: reglas del local';
        return result.text;
      };

      const recs = await getRecommendations(adapter, instId, inferWithTier);
      if (recs.length === 1 && recs[0].title === 'Sin recomendaciones') {
        recommendations = [];
      } else {
        recommendations = recs;
      }
    } catch (e: any) {
      if (visible) {
        error = e.message;
      }
    } finally {
      loading = false;
    }
  }

  onMount(async () => {
    await fetchRecs();
  });
</script>

{#if visible && (loading || error || recommendations.length > 0)}
  {#if aiTierLabel}
    <p data-testid="ai-tier" style="font-size: 0.8rem; color: var(--swal-text-muted, #94a3b8); margin-bottom: 0.5rem;">{aiTierLabel}</p>
  {/if}
  <RecommendationPanel {recommendations} {loading} {error} onRefresh={fetchRecs} />
{/if}
