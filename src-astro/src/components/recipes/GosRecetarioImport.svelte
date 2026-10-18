<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '../../lib/api-client';
  import {
    parseGosVaultExport,
    gosRecipeToFizeLines,
    parseServings,
    parseMinutes,
    decodeGosLink,
    type GosRecipeDraft,
    type InventoryMatch
  } from '../../lib/gosRecetario';

  let inventory: InventoryMatch[] = [];
  let menuItems: { id: string; name: string }[] = [];
  let existingRecipes: { id: string; name: string; menuItemId: string }[] = [];

  let importedRecipes: { draft: GosRecipeDraft; lines: any[]; unmatched: string[]; menuItemId: string; status: 'pending' | 'success' | 'error' | 'skipped'; errorMsg?: string }[] = [];
  let summary = '';
  let importing = false;
  let fileInput: HTMLInputElement;
  let pasteText = '';

  onMount(async () => {
    try {
      const invRes = await api.get('/api/inventory');
      if (invRes.ok) inventory = await invRes.json();

      const menuRes = await api.get('/api/menu-items');
      if (menuRes.ok) menuItems = await menuRes.json();

      const recRes = await api.get('/api/recipes');
      if (recRes.ok) existingRecipes = await recRes.json();

      if (typeof window !== 'undefined' && window.location.search) {
        const decoded = decodeGosLink(window.location.search);
        if (decoded.ok && decoded.recipes.length > 0) {
          processRecipes(decoded.recipes);
        }
        window.history.replaceState(null, '', window.location.pathname);
      }
    } catch (e) {
      console.error('Error loading inventory/menu items', e);
    }
  });

  function processRecipes(recipes: GosRecipeDraft[]) {
    importedRecipes = recipes.map(draft => {
      const { lines, unmatched } = gosRecipeToFizeLines(draft, inventory);
      return {
        draft,
        lines,
        unmatched,
        menuItemId: '',
        status: 'pending'
      };
    });
  }

  const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

  async function handleFileUpload(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;

    if (file.size > MAX_BYTES) {
      alert('El archivo supera los 5 MB');
      if (fileInput) fileInput.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      const raw = ev.target?.result;
      const res = parseGosVaultExport(raw);
      if (res.ok) {
        processRecipes(res.recipes);
      } else {
        alert(res.error);
      }
    };
    reader.readAsText(file);
    if (fileInput) fileInput.value = '';
  }

  function handlePaste() {
    if (!pasteText.trim()) return;
    const byteSize = new TextEncoder().encode(pasteText).length;
    if (byteSize > MAX_BYTES) {
      alert('El texto pegado supera los 5 MB');
      return;
    }
    const res = parseGosVaultExport(pasteText);
    if (res.ok) {
      processRecipes(res.recipes);
      pasteText = '';
    } else {
      alert(res.error);
    }
  }

  async function createRecipe(index: number) {
    const item = importedRecipes[index];
    if (!item.menuItemId) {
      item.status = 'error';
      item.errorMsg = 'Debes seleccionar un plato';
      importedRecipes = [...importedRecipes];
      return;
    }

    if (item.lines.length === 0) {
      item.status = 'error';
      item.errorMsg = 'La receta necesita al menos un insumo';
      importedRecipes = [...importedRecipes];
      return;
    }

    // Check for existing recipe with the same name on the same dish (case-insensitive)
    const exists = existingRecipes.some(r => r.menuItemId === item.menuItemId && r.name.toLowerCase() === item.draft.title.toLowerCase());
    if (exists) {
      item.status = 'skipped';
      item.errorMsg = 'Ya existe en este plato (omitida)';
      importedRecipes = [...importedRecipes];
      return;
    }

    item.status = 'pending';
    importing = true;

    try {
      const payload = {
        menuItemId: item.menuItemId,
        name: item.draft.title,
        yield: parseServings(item.draft.servings),
        prepTimeMin: parseMinutes(item.draft.prep_time),
        cookTimeMin: parseMinutes(item.draft.cook_time),
        visibility: 'privada',
        steps: item.draft.instructions,
        lines: item.lines
      };

      const res = await api.post('/api/recipes', payload);
      if (res.ok) {
        item.status = 'success';
        existingRecipes.push({ id: '', name: item.draft.title, menuItemId: item.menuItemId });
        updateSummary();
      } else {
        const data = await res.json();
        item.status = 'error';
        item.errorMsg = data.error || 'Error al guardar';
      }
    } catch (e: any) {
      item.status = 'error';
      item.errorMsg = e.message || 'Error de conexion';
    } finally {
      importing = false;
      importedRecipes = [...importedRecipes];
    }
  }

  function updateSummary() {
    const successCount = importedRecipes.filter(r => r.status === 'success').length;
    const errorCount = importedRecipes.filter(r => r.status === 'error' || r.status === 'skipped').length;

    const allUnmatched = new Set<string>();
    for (const r of importedRecipes) {
      for (const u of r.unmatched) allUnmatched.add(u);
    }
    const unmatchedStr = allUnmatched.size > 0 ? Array.from(allUnmatched).join(', ') : 'ninguno';

    summary = `Importadas ${successCount} receta(s), omitidas ${errorCount}, ingredientes sin insumo: ${unmatchedStr}`;
  }
</script>

<div class="import-section">
  <h3>Importar recetario de GOS</h3>

  <div class="actions">
    <label class="btn-file">
      Elegir archivo JSON
      <input type="file" accept="application/json,.json" bind:this={fileInput} onchange={handleFileUpload} style="display:none">
    </label>
    <div class="paste-area">
      <textarea bind:value={pasteText} placeholder="O pega el JSON aqui..."></textarea>
      <button type="button" class="btn ghost" onclick={handlePaste}>Usar texto pegado</button>
    </div>
  </div>

  {#if importedRecipes.length > 0}
    <div class="preview">
      <h4>Recetas a importar</h4>
      {#each importedRecipes as item, idx}
        <div class="recipe-row" class:success={item.status === 'success'} class:error={item.status === 'error'}>
          <div class="info">
            <strong>{item.draft.title}</strong>
            <div class="stats">
              Rinde: {parseServings(item.draft.servings)} |
              Prep: {parseMinutes(item.draft.prep_time)} min |
              Cocción: {parseMinutes(item.draft.cook_time)} min
            </div>
            {#if item.unmatched.length > 0}
              <div class="unmatched">Sin insumo: {item.unmatched.join(', ')}</div>
            {/if}
            <div class="lines">
              {item.lines.length} insumos mapeados
            </div>
          </div>
          <div class="controls">
            {#if item.status === 'success'}
              <span class="badge success">Importada</span>
            {:else if item.status === 'skipped'}
              <span class="badge skipped">Omitida</span>
              <div class="error-msg">{item.errorMsg}</div>
            {:else}
              <select bind:value={item.menuItemId}>
                <option value="">Selecciona un plato...</option>
                {#each menuItems as mi}
                  <option value={mi.id}>{mi.name}</option>
                {/each}
              </select>
              <button
                type="button"
                class="btn primary"
                onclick={() => createRecipe(idx)}
                disabled={importing || item.lines.length === 0}
              >
                Crear receta en Fize
              </button>
              {#if item.errorMsg}
                <div class="error-msg">{item.errorMsg}</div>
              {/if}
            {/if}
          </div>
        </div>
      {/each}

      {#if summary}
        <div class="summary">{summary}</div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .import-section {
    padding: 1rem;
    border: 1px solid var(--swal-border);
    border-radius: 0.8rem;
    background: var(--swal-bg-surface);
    margin-bottom: 2rem;
  }
  h3 { margin-top: 0; }
  .actions { display: flex; gap: 1rem; align-items: flex-start; margin-bottom: 1rem; }
  .btn-file {
    cursor: pointer;
    padding: 0.55rem 1rem;
    border-radius: 0.5rem;
    background: var(--swal-accent-cyan, #22d3ee);
    color: var(--swal-bg);
    font-weight: 600;
  }
  .paste-area { display: flex; flex-direction: column; gap: 0.5rem; flex: 1; }
  textarea {
    width: 100%;
    min-height: 60px;
    border: 1px solid var(--swal-border);
    border-radius: 0.45rem;
    padding: 0.5rem;
    background: var(--swal-bg-elevated);
    color: inherit;
  }
  .recipe-row {
    display: flex;
    justify-content: space-between;
    padding: 1rem;
    border: 1px solid var(--swal-border);
    border-radius: 0.5rem;
    margin-bottom: 0.5rem;
    gap: 1rem;
  }
  .recipe-row.success { border-color: #4ade80; background: rgba(74, 222, 128, 0.1); }
  .recipe-row.error { border-color: #f87171; }
  .recipe-row.skipped { border-color: #fbbf24; background: rgba(251, 191, 36, 0.1); }
  .unmatched { color: #f87171; font-size: 0.85rem; }
  .stats, .lines { font-size: 0.85rem; opacity: 0.8; }
  .controls { display: flex; flex-direction: column; gap: 0.5rem; align-items: flex-end; min-width: 250px; }
  select {
    width: 100%;
    padding: 0.5rem;
    border: 1px solid var(--swal-border);
    border-radius: 0.45rem;
    background: var(--swal-bg-elevated);
    color: inherit;
  }
  .error-msg { color: #f87171; font-size: 0.85rem; text-align: right; }
  .badge.success { color: #4ade80; border: 1px solid #4ade80; padding: 0.2rem 0.5rem; border-radius: 99px; font-size: 0.8rem; }
  .badge.skipped { color: #d97706; border: 1px solid #fbbf24; padding: 0.2rem 0.5rem; border-radius: 99px; font-size: 0.8rem; }
  .summary { margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--swal-border); font-weight: 600; }
  .btn { padding: 0.55rem 1rem; border-radius: 0.5rem; font: inherit; cursor: pointer; border: 1px solid var(--swal-border); }
  .btn.primary { background: var(--swal-accent-cyan, #22d3ee); color: var(--swal-bg); border-color: transparent; font-weight: 600; }
  .btn.ghost { background: transparent; color: var(--swal-text-secondary); }
</style>
