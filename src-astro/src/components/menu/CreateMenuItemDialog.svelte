<script lang="ts">
  // CreateMenuItemDialog.svelte — H1.05 + H4.03 Recipe Editor (no @swal/ui deps)
  import { onMount } from 'svelte';
  import type { MenuItem, MenuCategory } from '../../stores/menu.svelte';
  import type { RecipeLine } from '../../lib/recipes';
  import { apiFetch } from '../../lib/api-client';

  interface InventoryItem {
    id: string;
    name: string;
    unit: string;
    stock?: number;
  }

  interface SaveMenuItemPayload extends Omit<MenuItem, 'id'> {
    recipe?: RecipeLine[];
  }

  interface Props {
    categories: MenuCategory[];
    initialItem?: (Partial<MenuItem> & { recipe?: RecipeLine[] }) | null;
    onSave: (item: SaveMenuItemPayload) => void;
    onClose: () => void;
  }

  let { categories, initialItem = null, onSave, onClose }: Props = $props();

  let sku = $state(initialItem?.sku ?? '');
  let name = $state(initialItem?.name ?? '');
  let description = $state(initialItem?.description ?? '');
  let priceStr = $state(initialItem?.price?.toString() ?? '');
  let categoryId = $state(initialItem?.categoryId ?? categories[0]?.id ?? '');
  let tagsStr = $state(initialItem?.tags?.join(', ') ?? '');
  let isAvailable = $state(initialItem?.isAvailable ?? true);
  let recipeLines = $state<RecipeLine[]>(
    initialItem?.recipe && Array.isArray(initialItem.recipe)
      ? initialItem.recipe.map(r => ({ inventoryId: r.inventoryId, qty: r.qty }))
      : []
  );

  let inventoryItems = $state<InventoryItem[]>([]);
  let isLoadingInventory = $state(true);
  let inventoryError = $state<string | null>(null);
  let serverError = $state<string | null>(null);
  let errors = $state<Record<string, string>>({});

  onMount(async () => {
    try {
      const res = await apiFetch('/api/inventory');
      if (res.ok) {
        const data = await res.json();
        inventoryItems = data.map((item: Record<string, unknown>) => ({
          id: String(item.id),
          name: String(item.name || ''),
          unit: String(item.unit || 'ud'),
          stock: Number(item.stock ?? 0),
        }));
      } else {
        inventoryError = 'Error al cargar inventario';
      }
    } catch {
      inventoryError = 'Error de red al cargar inventario';
    } finally {
      isLoadingInventory = false;
    }
  });

  function addRecipeLine() {
    const available = inventoryItems.find(item => !recipeLines.some(line => line.inventoryId === item.id));
    const defaultId = available ? available.id : (inventoryItems[0]?.id ?? '');
    recipeLines = [...recipeLines, { inventoryId: defaultId, qty: 1 }];
  }

  function removeRecipeLine(index: number) {
    recipeLines = recipeLines.filter((_, i) => i !== index);
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!sku.trim()) e.sku = 'SKU requerido';
    if (!name.trim()) e.name = 'Nombre requerido';
    const price = parseFloat(priceStr);
    if (isNaN(price) || price <= 0) e.price = 'Precio debe ser > 0';
    if (!categoryId) e.categoryId = 'Categoría requerida';

    const seenIds = new Set<string>();
    for (let i = 0; i < recipeLines.length; i++) {
      const line = recipeLines[i];
      if (!line.inventoryId) {
        e[`recipe_${i}`] = 'Seleccione ingrediente';
        e.recipe = 'Todos los ingredientes deben estar seleccionados';
      } else if (seenIds.has(line.inventoryId)) {
        e[`recipe_${i}`] = 'Duplicado';
        e.recipe = 'No se permiten ingredientes duplicados';
      } else {
        seenIds.add(line.inventoryId);
      }

      if (typeof line.qty !== 'number' || isNaN(line.qty) || line.qty <= 0) {
        e[`recipe_${i}_qty`] = 'Cantidad debe ser > 0';
        e.recipe = 'Las cantidades de la receta deben ser mayores a 0';
      }
    }

    errors = e;
    return Object.keys(e).length === 0;
  }

  function handleSubmit() {
    serverError = null;
    if (!validate()) return;
    try {
      onSave({
        sku: sku.trim(),
        name: name.trim(),
        description: description.trim() || undefined,
        price: parseFloat(priceStr),
        categoryId,
        tags: tagsStr.split(',').map(t => t.trim()).filter(Boolean),
        isAvailable,
        recipe: recipeLines,
      });
    } catch (err) {
      serverError = (err as Error).message || 'Error al guardar';
    }
  }

  function handleBackdropClick(e: MouseEvent) {
    if ((e.target as HTMLElement).classList.contains('dialog-backdrop')) onClose();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="dialog-backdrop" onclick={handleBackdropClick} role="dialog" aria-modal="true" aria-label="Crear artículo de menú">
  <div class="dialog-panel">
    <header class="dialog-header">
      <h2 class="dialog-title">{initialItem ? 'Editar' : 'Nuevo'} artículo</h2>
      <button class="close-btn" onclick={onClose} aria-label="Cerrar">✕</button>
    </header>

    <form class="dialog-form" onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
      <div class="form-row">
        <div class="field">
          <label class="field-label" for="sku">SKU</label>
          <input id="sku" class="field-input" class:error={errors.sku} bind:value={sku} placeholder="ENT-001" />
          {#if errors.sku}<span class="field-error">{errors.sku}</span>{/if}
        </div>
        <div class="field">
          <label class="field-label" for="item-name">Nombre *</label>
          <input id="item-name" class="field-input" class:error={errors.name} bind:value={name} placeholder="Nombre del plato" />
          {#if errors.name}<span class="field-error">{errors.name}</span>{/if}
        </div>
      </div>

      <div class="field">
        <label class="field-label" for="desc">Descripción</label>
        <textarea id="desc" class="field-textarea" bind:value={description} placeholder="Descripción del artículo..." rows={2}></textarea>
      </div>

      <div class="form-row">
        <div class="field">
          <label class="field-label" for="price">Precio (COP) *</label>
          <input id="price" class="field-input" class:error={errors.price} type="number" step="0.01" min="0" bind:value={priceStr} placeholder="12.50" />
          {#if errors.price}<span class="field-error">{errors.price}</span>{/if}
        </div>
        <div class="field">
          <label class="field-label" for="cat">Categoría *</label>
          <select id="cat" class="field-select" class:error={errors.categoryId} bind:value={categoryId}>
            <option value="">Seleccionar...</option>
            {#each categories as cat}
              <option value={cat.id}>{cat.name}</option>
            {/each}
          </select>
          {#if errors.categoryId}<span class="field-error">{errors.categoryId}</span>{/if}
        </div>
      </div>

      <div class="field">
        <label class="field-label" for="tags">Etiquetas</label>
        <input id="tags" class="field-input" bind:value={tagsStr} placeholder="vegetariano, picante (separadas por coma)" />
      </div>

      <div class="availability-row">
        <label class="toggle-label">
          <input type="checkbox" bind:checked={isAvailable} />
          <span>Disponible</span>
        </label>
      </div>

      <div class="field recipe-section">
        <div class="recipe-header">
          <span class="field-label">Receta (Ingredientes)</span>
          <button
            type="button"
            class="btn-add-line"
            onclick={addRecipeLine}
            disabled={isLoadingInventory || inventoryItems.length === 0}
          >
            + Añadir ingrediente
          </button>
        </div>

        {#if isLoadingInventory}
          <p class="recipe-info">Cargando inventario desde /api/inventory...</p>
        {:else if inventoryError}
          <p class="field-error">{inventoryError}</p>
        {:else if inventoryItems.length === 0}
          <p class="recipe-info warning">Sin ítems de inventario — añade stock primero en /api/inventory</p>
        {:else if recipeLines.length === 0}
          <p class="recipe-info">Sin receta asignada (sin deducción automática de stock)</p>
        {:else}
          <div class="recipe-lines">
            {#each recipeLines as line, i}
              {@const selectedItem = inventoryItems.find(inv => inv.id === line.inventoryId)}
              <div class="recipe-line">
                <select
                  class="field-select recipe-select"
                  class:error={errors[`recipe_${i}`]}
                  bind:value={line.inventoryId}
                >
                  <option value="">Seleccionar ingrediente...</option>
                  {#each inventoryItems as inv}
                    <option value={inv.id}>{inv.name} ({inv.unit})</option>
                  {/each}
                </select>

                <div class="qty-input-group" class:error={errors[`recipe_${i}_qty`]}>
                  <input
                    type="number"
                    step="any"
                    min="0.001"
                    class="field-input recipe-qty"
                    bind:value={line.qty}
                    placeholder="Cant."
                  />
                  <span class="unit-badge">{selectedItem?.unit || 'ud'}</span>
                </div>

                <button
                  type="button"
                  class="remove-line-btn"
                  onclick={() => removeRecipeLine(i)}
                  title="Eliminar ingrediente"
                  aria-label="Eliminar ingrediente"
                >
                  ✕
                </button>
              </div>
            {/each}
          </div>
        {/if}

        {#if errors.recipe}
          <span class="field-error">{errors.recipe}</span>
        {/if}
        {#if serverError}
          <span class="field-error server-error">{serverError}</span>
        {/if}
      </div>

      <footer class="dialog-footer">
        <button type="button" class="btn btn-ghost" onclick={onClose}>Cancelar</button>
        <button type="submit" class="btn btn-primary">Guardar</button>
      </footer>
    </form>
  </div>
</div>

<style>
  .dialog-backdrop {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.6);
    backdrop-filter: blur(4px);
    display: flex; align-items: center; justify-content: center;
    z-index: 100; padding: 1rem;
  }
  .dialog-panel {
    background: var(--swal-surface, #1e293b);
    border: 1px solid var(--swal-border, rgba(255,255,255,0.1));
    border-radius: 12px;
    width: 100%; max-width: 520px; max-height: 90vh;
    overflow-y: auto;
    box-shadow: 0 24px 48px rgba(0,0,0,0.4);
  }
  .dialog-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--swal-border, rgba(255,255,255,0.08));
  }
  .dialog-title { font-size: 1rem; font-weight: 600; color: var(--swal-text, #e2e8f0); margin: 0; }
  .close-btn { background: none; border: none; cursor: pointer; font-size: 1rem; color: var(--swal-text-secondary, #64748b); padding: 0.25rem; border-radius: 4px; transition: color 150ms; }
  .close-btn:hover { color: var(--swal-text, #e2e8f0); }
  .dialog-form { padding: 1.25rem; display: flex; flex-direction: column; gap: 1rem; }
  .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
  .field { display: flex; flex-direction: column; gap: 0.25rem; }
  .field-label { font-size: 0.8125rem; font-weight: 500; color: var(--swal-text-secondary, #94a3b8); }
  .field-input, .field-textarea, .field-select {
    background: var(--swal-bg, #0f172a);
    border: 1px solid var(--swal-border, rgba(255,255,255,0.12));
    border-radius: 6px;
    padding: 0.5rem 0.75rem;
    font-size: 0.875rem;
    color: var(--swal-text, #e2e8f0);
    outline: none;
    transition: border-color 150ms;
    font-family: inherit;
  }
  .field-input:focus, .field-textarea:focus, .field-select:focus { border-color: var(--swal-neon-cyan, #22d3ee); }
  .field-input.error, .field-select.error { border-color: var(--swal-danger, #f87171); }
  .field-textarea { resize: vertical; min-height: 60px; }
  .field-error { font-size: 0.75rem; color: var(--swal-danger, #f87171); }
  .availability-row { display: flex; align-items: center; }
  .toggle-label { display: flex; align-items: center; gap: 0.5rem; cursor: pointer; font-size: 0.875rem; color: var(--swal-text, #e2e8f0); }
  .toggle-label input { width: 16px; height: 16px; accent-color: var(--swal-neon-cyan, #22d3ee); }
  .recipe-section {
    border-top: 1px solid var(--swal-border, rgba(255,255,255,0.08));
    padding-top: 0.75rem;
  }
  .recipe-header {
    display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem;
  }
  .btn-add-line {
    background: transparent;
    border: 1px solid var(--swal-neon-cyan, #22d3ee);
    color: var(--swal-neon-cyan, #22d3ee);
    padding: 0.25rem 0.5rem;
    font-size: 0.75rem;
    border-radius: 4px;
    cursor: pointer;
    transition: background 150ms;
  }
  .btn-add-line:hover:not(:disabled) {
    background: rgba(34,211,238,0.1);
  }
  .btn-add-line:disabled {
    opacity: 0.5; cursor: not-allowed; border-color: var(--swal-text-secondary, #64748b); color: var(--swal-text-secondary, #64748b);
  }
  .recipe-info {
    font-size: 0.8125rem; color: var(--swal-text-secondary, #94a3b8); margin: 0; font-style: italic;
  }
  .recipe-info.warning {
    color: var(--swal-warning, #f59e0b);
  }
  .recipe-lines {
    display: flex; flex-direction: column; gap: 0.5rem;
  }
  .recipe-line {
    display: grid; grid-template-columns: 1fr 110px 32px; gap: 0.5rem; align-items: center;
  }
  .recipe-select { width: 100%; }
  .qty-input-group {
    display: flex; align-items: center; background: var(--swal-bg, #0f172a);
    border: 1px solid var(--swal-border, rgba(255,255,255,0.12)); border-radius: 6px; padding-right: 0.5rem;
  }
  .qty-input-group.error {
    border-color: var(--swal-danger, #f87171);
  }
  .qty-input-group input {
    width: 100%; border: none; background: transparent; padding: 0.5rem 0.25rem 0.5rem 0.5rem; outline: none;
    font-size: 0.875rem; color: var(--swal-text, #e2e8f0);
  }
  .unit-badge {
    font-size: 0.75rem; color: var(--swal-text-secondary, #94a3b8); font-weight: 500; white-space: nowrap;
  }
  .remove-line-btn {
    background: none; border: none; color: var(--swal-danger, #f87171);
    cursor: pointer; font-size: 0.875rem; padding: 0.25rem; border-radius: 4px;
    display: flex; align-items: center; justify-content: center; transition: background 150ms;
  }
  .remove-line-btn:hover {
    background: rgba(248,113,113,0.15);
  }
  .server-error {
    display: block; margin-top: 0.25rem; font-weight: 600;
  }
  .dialog-footer { display: flex; justify-content: flex-end; gap: 0.5rem; padding-top: 0.5rem; border-top: 1px solid var(--swal-border, rgba(255,255,255,0.06)); }
  .btn { padding: 0.5rem 1rem; border-radius: 6px; font-size: 0.875rem; font-weight: 500; cursor: pointer; border: none; transition: background 150ms; }
  .btn-ghost { background: transparent; color: var(--swal-text-secondary, #94a3b8); }
  .btn-ghost:hover { background: rgba(255,255,255,0.06); color: var(--swal-text, #e2e8f0); }
  .btn-primary { background: var(--swal-neon-cyan, #22d3ee); color: var(--swal-surface); font-weight: 600; }
  .btn-primary:hover { background: var(--swal-accent); }
</style>
