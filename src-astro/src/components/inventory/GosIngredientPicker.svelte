<script lang="ts">
  import { Button, Input } from '@swal/ui';
  import { gos, type Ingredient } from '../../lib/gos';

  let {
    gosIngredientId = $bindable<string | null>(null),
    gramsPerUnit = $bindable<number | ''>(''),
    unit = 'ud',
  }: {
    gosIngredientId?: string | null;
    gramsPerUnit?: number | '';
    unit?: string;
  } = $props();

  let query = $state('');
  let results = $state<Ingredient[]>([]);
  let searching = $state(false);
  let searched = $state(false);
  let selectedName = $state('');

  $effect(() => {
    const id = gosIngredientId;
    let active = true;
    selectedName = '';
    if (id) {
      void gos.getIngredient(id).then((ingredient) => {
        if (active) selectedName = ingredient?.names.es ?? id;
      }).catch(() => { if (active) selectedName = id; });
    }
    return () => { active = false; };
  });

  $effect(() => {
    const text = query.trim();
    let active = true;
    results = [];
    searched = false;
    searching = false;
    if (!text) return;
    const timer = setTimeout(() => {
      searching = true;
      void gos.searchIngredients(text).then((ingredients) => {
        if (active) results = ingredients.slice(0, 12);
      }).catch(() => {}).finally(() => {
        if (active) { searching = false; searched = true; }
      });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  });

  function select(ingredient: Ingredient) {
    gosIngredientId = ingredient.id;
    selectedName = ingredient.names.es;
    query = '';
  }
</script>

<div class="gos-picker">
  <Input label="Ingrediente GOS (opcional)" type="search" placeholder="Buscar ingrediente…" bind:value={query} />
  {#if searching}
    <p class="hint" role="status">Buscando en GOS…</p>
  {:else if searched && results.length === 0}
    <p class="hint" role="status">Sin resultados disponibles. Puedes continuar sin vincular; GOS funciona con el catálogo cacheado cuando no hay conexión.</p>
  {/if}
  {#if results.length}
    <ul class="results" aria-label="Ingredientes GOS encontrados">
      {#each results as ingredient (ingredient.id)}
        <li><Button type="button" variant="ghost" size="sm" onclick={() => select(ingredient)}>{ingredient.names.es}</Button></li>
      {/each}
    </ul>
  {/if}
  {#if gosIngredientId}
    <div class="selected">
      <span>{selectedName || gosIngredientId}</span>
      <Button type="button" variant="ghost" size="sm" onclick={() => { gosIngredientId = null; gramsPerUnit = ''; }}>Desvincular</Button>
    </div>
    <Input label={`Gramos por ${unit || 'unidad'} de inventario`} type="number" min="0.000001" step="any" bind:value={gramsPerUnit} placeholder="ej. 1000 para kg" required />
    <p class="hint">Indica el peso de una unidad para calcular la nutrición de las recetas.</p>
  {/if}
</div>

<style>
  .gos-picker { display: flex; flex-direction: column; gap: var(--swal-space-2, 0.5rem); }
  .hint { margin: 0; font-size: var(--swal-font-size-xs, 0.75rem); color: var(--swal-text-secondary); }
  .results { list-style: none; margin: 0; padding: var(--swal-space-2, 0.5rem); max-height: 14rem; overflow-y: auto; border: 1px solid var(--swal-border); border-radius: var(--swal-radius); background: var(--swal-surface); }
  .selected { display: flex; align-items: center; justify-content: space-between; gap: var(--swal-space-2, 0.5rem); color: var(--swal-text); font-size: var(--swal-font-size-sm, 0.875rem); }
</style>
