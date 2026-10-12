<!-- InventoryManager.svelte — Admin CRUD for inventory (Wave H4.01) -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { Button, Card, Input, Badge } from '@swal/ui';
  import { inventory, refreshInventoryFromApi } from '../../stores/inventory.svelte';
  import { api, apiFetch } from '../../lib/api-client';
  import GosIngredientPicker from './GosIngredientPicker.svelte';
  import type { InventoryItem } from '../../stores/inventory.svelte';

  let gosIngredientId = $state<string | null>(null);
  let gramsPerUnit = $state<number | ''>('');
  let editingId = $state<string | null>(null);
  let editName = $state('');
  let editUnit = $state('');
  let editMinStock = $state<number | ''>('');
  let editGosId = $state<string | null>(null);
  let editGrams = $state<number | ''>('');
  let editSaving = $state(false);
  let editError = $state('');

  let loadError = $state<string | null>(null);

  // Form state: Create Item
  let name = $state('');
  let unit = $state('ud');
  let initialStock = $state<number | ''>('');
  let minStock = $state<number | ''>('');
  let isCreating = $state(false);
  let createError = $state<string | null>(null);
  let createSuccess = $state<string | null>(null);

  // Form state: Add Stock
  let activeStockItemId = $state<string | null>(null);
  let addQty = $state<number | ''>('');
  let addNote = $state('');
  let isAddingStock = $state(false);
  let stockError = $state<string | null>(null);
  let stockSuccess = $state<string | null>(null);

  onMount(async () => {
    const ok = await refreshInventoryFromApi();
    if (!ok && inventory.items.length === 0) {
      loadError = 'No se pudo cargar el inventario. Verifique la conexión.';
    }
  });

  async function handleRetry() {
    loadError = null;
    const ok = await refreshInventoryFromApi();
    if (!ok && inventory.items.length === 0) {
      loadError = 'No se pudo cargar el inventario. Verifique la conexión.';
    }
  }

  async function handleCreateItem(e: SubmitEvent) {
    e.preventDefault();
    createError = null;
    createSuccess = null;

    if (!name.trim()) {
      createError = 'El nombre del producto es obligatorio.';
      return;
    }
    if (!unit.trim()) {
      createError = 'La unidad es obligatoria.';
      return;
    }

    const initStockNum = initialStock === '' ? 0 : Number(initialStock);
    const minStockNum = minStock === '' ? 0 : Number(minStock);

    if (isNaN(initStockNum) || initStockNum < 0) {
      createError = 'El stock inicial debe ser mayor o igual a 0.';
      return;
    }

    if (isNaN(minStockNum) || minStockNum < 0) {
      createError = 'El stock mínimo debe ser mayor o igual a 0.';
      return;
    }

    if (gosIngredientId && (!Number.isFinite(Number(gramsPerUnit)) || Number(gramsPerUnit) <= 0)) {
      createError = 'Indica gramos por unidad mayores que 0 para vincular GOS.';
      return;
    }

    isCreating = true;
    try {
      const res = await api.post('/api/inventory', {
        name: name.trim(),
        unit: unit.trim(),
        initialStock: initStockNum,
        minStock: minStockNum,
        gosIngredientId,
        gramsPerUnit: gosIngredientId ? Number(gramsPerUnit) : null,
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `Error ${res.status}`);
      }

      name = '';
      unit = 'ud';
      initialStock = '';
      minStock = '';
      gosIngredientId = null;
      gramsPerUnit = '';
      createSuccess = 'Producto creado con éxito.';
      await refreshInventoryFromApi();
    } catch (err: unknown) {
      createError = err instanceof Error ? err.message : 'Error al crear el producto.';
    } finally {
      isCreating = false;
    }
  }

  async function handleAddStock(e: SubmitEvent, itemId: string) {
    e.preventDefault();
    stockError = null;
    stockSuccess = null;

    const qtyNum = addQty === '' ? 0 : Number(addQty);
    if (isNaN(qtyNum) || qtyNum <= 0) {
      stockError = 'La cantidad debe ser mayor que 0.';
      return;
    }

    isAddingStock = true;
    try {
      const res = await api.post(`/api/inventory/${itemId}/transactions`, {
        kind: 'purchase',
        qty: qtyNum,
        note: addNote.trim() || undefined,
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `Error ${res.status}`);
      }

      addQty = '';
      addNote = '';
      activeStockItemId = null;
      stockSuccess = 'Stock añadido con éxito.';
      await refreshInventoryFromApi();
    } catch (err: unknown) {
      stockError = err instanceof Error ? err.message : 'Error al añadir stock.';
    } finally {
      isAddingStock = false;
    }
  }

  function startEdit(item: InventoryItem) {
    editingId = item.id;
    editName = item.name;
    editUnit = item.unit;
    editMinStock = item.minStock;
    editGosId = item.gosIngredientId ?? null;
    editGrams = item.gramsPerUnit ?? '';
    editError = '';
  }

  async function saveEdit(event: SubmitEvent) {
    event.preventDefault();
    if (!editingId) return;
    if (!editName.trim() || !editUnit.trim() || !Number.isFinite(Number(editMinStock)) || Number(editMinStock) < 0) {
      editError = 'Revisa el nombre, la unidad y el stock mínimo.';
      return;
    }
    if (editGosId && (!Number.isFinite(Number(editGrams)) || Number(editGrams) <= 0)) {
      editError = 'Indica gramos por unidad mayores que 0 para vincular GOS.';
      return;
    }
    editSaving = true;
    editError = '';
    try {
      const response = await apiFetch(`/api/inventory/${editingId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName.trim(), unit: editUnit.trim(), minStock: Number(editMinStock),
          gosIngredientId: editGosId, gramsPerUnit: editGosId ? Number(editGrams) : null }),
      });
      if (!response.ok) throw new Error(`No se pudo guardar el producto (${response.status}).`);
      editingId = null;
      await refreshInventoryFromApi();
    } catch (error: unknown) {
      editError = error instanceof Error ? error.message : 'No se pudo guardar el producto.';
    } finally { editSaving = false; }
  }

  function toggleStockForm(itemId: string) {
    stockError = null;
    stockSuccess = null;
    if (activeStockItemId === itemId) {
      activeStockItemId = null;
    } else {
      activeStockItemId = itemId;
      addQty = '';
      addNote = '';
    }
  }
</script>

<div class="inventory-manager">
  <!-- Formulario Crear Producto -->
  <Card variant="default" padding="md">
    <div class="manager-card-header">
      <h2 class="card-title">＋ Nuevo Producto</h2>
    </div>

    {#if createError}
      <div class="alert alert-error" role="alert">{createError}</div>
    {/if}
    {#if createSuccess}
      <div class="alert alert-success" role="status">{createSuccess}</div>
    {/if}

    <form onsubmit={handleCreateItem} class="create-form">
      <div class="form-grid">
        <div class="form-group">
          <Input label="Nombre *" placeholder="ej. Aceite de oliva" bind:value={name} required />
        </div>
        <div class="form-group">
          <Input label="Unidad *" placeholder="ej. kg, l, ud" bind:value={unit} required />
        </div>
        <div class="form-group">
          <Input label="Stock inicial" type="number" min="0" step="any" placeholder="0" bind:value={initialStock} />
        </div>
        <div class="form-group">
          <Input label="Stock mínimo" type="number" min="0" step="any" placeholder="0" bind:value={minStock} />
        </div>
      </div>
      <GosIngredientPicker bind:gosIngredientId bind:gramsPerUnit {unit} />
      <div class="form-actions">
        <Button type="submit" variant="primary" loading={isCreating} disabled={isCreating}>
          Crear Producto
        </Button>
      </div>
    </form>
  </Card>

  <!-- Lista de Productos / Estados -->
  <Card variant="default" padding="none">
    <div class="manager-card-header padded">
      <h2 class="card-title">📦 Catálogo de Productos</h2>
      {#if stockSuccess}
        <Badge variant="success" size="sm">{stockSuccess}</Badge>
      {/if}
    </div>

    {#if inventory.isLoading}
      <div class="state-container">
        <span class="spinner" aria-hidden="true"></span>
        <p>Cargando inventario...</p>
      </div>
    {:else if loadError}
      <div class="state-container error">
        <p>{loadError}</p>
        <Button variant="secondary" size="sm" onclick={handleRetry}>Reintentar</Button>
      </div>
    {:else if inventory.items.length === 0}
      <div class="state-container empty">
        <p class="empty-text">No products yet</p>
        <span class="empty-sub">Crea un producto arriba para comenzar.</span>
      </div>
    {:else}
      {#if stockError}
        <div class="alert alert-error inline" role="alert">{stockError}</div>
      {/if}
      <div class="items-table-wrapper">
        <table class="items-table">
          <thead>
            <tr>
              <th>SKU / ID</th>
              <th>Nombre</th>
              <th>Stock actual</th>
              <th>Mínimo</th>
              <th>Unidad</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {#each inventory.items as item (item.id)}
              <tr class:low-stock={item.stock <= item.minStock}>
                <td class="cell-sku">{item.sku || item.id}</td>
                <td class="cell-name">{item.name}{#if item.gosIngredientId}<br /><Badge size="sm">GOS vinculado</Badge>{/if}</td>
                <td class="cell-stock" class:danger={item.stock <= item.minStock}>
                  {item.stock}
                </td>
                <td class="cell-min">{item.minStock}</td>
                <td class="cell-unit">{item.unit}</td>
                <td class="cell-actions">
                  <Button variant="ghost" size="sm" onclick={() => startEdit(item)}>Editar</Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onclick={() => toggleStockForm(item.id)}
                  >
                    {activeStockItemId === item.id ? 'Cancelar' : '＋ Añadir stock'}
                  </Button>
                </td>
              </tr>
              {#if editingId === item.id}
                <tr class="stock-form-row">
                  <td colspan="6">
                    <form onsubmit={saveEdit} class="edit-form">
                      <div class="form-grid">
                        <Input label="Nombre" bind:value={editName} required />
                        <Input label="Unidad" bind:value={editUnit} required />
                        <Input label="Stock mínimo" type="number" min="0" step="any" bind:value={editMinStock} />
                      </div>
                      <GosIngredientPicker bind:gosIngredientId={editGosId} bind:gramsPerUnit={editGrams} unit={editUnit} />
                      {#if editError}<p class="alert alert-error" role="alert">{editError}</p>{/if}
                      <div class="form-actions">
                        <Button type="button" variant="ghost" onclick={() => { editingId = null; }}>Cancelar edición</Button>
                        <Button type="submit" loading={editSaving} disabled={editSaving}>Guardar producto</Button>
                      </div>
                    </form>
                  </td>
                </tr>
              {/if}
              {#if activeStockItemId === item.id}
                <tr class="stock-form-row">
                  <td colspan="6">
                    <form onsubmit={(e) => handleAddStock(e, item.id)} class="stock-form">
                      <span class="stock-form-label">Añadir stock a {item.name}:</span>
                      <div class="stock-form-inputs">
                        <Input
                          type="number"
                          placeholder="Cantidad"
                          min="0.01"
                          step="any"
                          bind:value={addQty}
                          required
                        />
                        <Input
                          type="text"
                          placeholder="Nota (opcional)"
                          bind:value={addNote}
                        />
                        <Button
                          type="submit"
                          variant="primary"
                          size="sm"
                          loading={isAddingStock}
                          disabled={isAddingStock}
                        >
                          Guardar
                        </Button>
                      </div>
                    </form>
                  </td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </Card>
</div>

<style>
  .edit-form { display: flex; flex-direction: column; gap: 1rem; }

  .inventory-manager {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    margin-top: 1.5rem;
  }

  .manager-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1rem;
  }

  .manager-card-header.padded {
    padding: 1rem;
    margin-bottom: 0;
    border-bottom: 1px solid var(--swal-border, rgba(255,255,255,0.08));
  }

  .card-title {
    font-size: 1rem;
    font-weight: 600;
    color: var(--swal-text, #e2e8f0);
    margin: 0;
  }

  .alert {
    padding: 0.625rem 0.875rem;
    border-radius: 6px;
    font-size: 0.8125rem;
    margin-bottom: 1rem;
  }

  .alert-error {
    background: rgba(248, 113, 113, 0.15);
    border: 1px solid var(--swal-danger, #f87171);
    color: var(--swal-danger, #f87171);
  }

  .alert-success {
    background: rgba(74, 222, 128, 0.15);
    border: 1px solid var(--swal-neon-green, #4ade80);
    color: var(--swal-neon-green, #4ade80);
  }

  .alert.inline {
    margin: 0.75rem 1rem;
  }

  .form-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 0.875rem;
  }

  .form-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 1rem;
  }

  .state-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 2.5rem 1rem;
    gap: 0.75rem;
    color: var(--swal-text-secondary, #94a3b8);
  }

  .empty-text {
    font-size: 1rem;
    font-weight: 600;
    color: var(--swal-text, #e2e8f0);
    margin: 0;
  }

  .empty-sub {
    font-size: 0.8125rem;
    color: var(--swal-text-secondary, #64748b);
  }

  .items-table-wrapper {
    overflow-x: auto;
  }

  .items-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.875rem;
  }

  .items-table th,
  .items-table td {
    padding: 0.75rem 1rem;
    text-align: left;
    border-bottom: 1px solid var(--swal-border, rgba(255,255,255,0.05));
  }

  .items-table th {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--swal-text-secondary, #94a3b8);
    background: rgba(0, 0, 0, 0.1);
  }

  .cell-sku {
    font-family: monospace;
    font-size: 0.8125rem;
    color: var(--swal-text-secondary, #94a3b8);
  }

  .cell-name {
    font-weight: 500;
    color: var(--swal-text, #e2e8f0);
  }

  .cell-stock {
    font-weight: 600;
  }

  .cell-stock.danger {
    color: var(--swal-danger, #f87171);
  }

  .cell-min, .cell-unit {
    color: var(--swal-text-secondary, #94a3b8);
  }

  .stock-form-row {
    background: rgba(255, 255, 255, 0.02);
  }

  .stock-form {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 0;
  }

  .stock-form-label {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--swal-text, #e2e8f0);
  }

  .stock-form-inputs {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    flex: 1;
    min-width: 280px;
  }

  .spinner {
    width: 20px;
    height: 20px;
    border: 2px solid transparent;
    border-top-color: var(--swal-accent, #22d3ee);
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
