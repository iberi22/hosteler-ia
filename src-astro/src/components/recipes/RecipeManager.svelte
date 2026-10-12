<script lang="ts">
  // RecipeManager.svelte — recetas privadas del restaurante.
  //
  // Privacidad: este panel NUNCA se monta en la carta publica. Lo que sale al
  // cliente final es el plato (menuItem.isPublic), no la receta. Aqui se ven
  // insumos, cantidades, tiempos, temperatura y costo real por porcion.
  import { onMount } from 'svelte';
  import { Button } from '@swal/ui';
  import GosIngredientPicker from '../inventory/GosIngredientPicker.svelte';
  import { api, apiFetch } from '../../lib/api-client';
  import { formatCOP } from '../../lib/money';

  interface RecipeLine {
    inventoryItemId: string;
    name: string;
    qty: number;
    unit: string;
    unitCost: number;
  }
  interface Recipe {
    id: string;
    menuItemId: string;
    name: string;
    yield: number;
    lines: RecipeLine[];
    costTotal: number;
    costPerServing: number;
    prepTimeMin: number;
    cookTimeMin: number;
    totalTimeMin: number;
    cookTempC?: number;
    visibility: 'privada' | 'equipo';
    steps: string[];
    price: number;
    margin: number;
    lossMaking: boolean;
  }
  interface MenuItem {
    id: string;
    name: string;
    price: number;
  }
  interface InventoryItem {
    id: string;
    name: string;
    unit: string;
    stock: number;
    unitCost?: number;
    gosIngredientId?: string | null;
    gramsPerUnit?: number | null;
  }

  let recipes = $state<Recipe[]>([]);
  let menuItems = $state<MenuItem[]>([]);
  let inventory = $state<InventoryItem[]>([]);
  let loading = $state(true);
  let errorMsg = $state('');
  let openId = $state<string | null>(null);
  let creating = $state(false);
  let saving = $state(false);

  // Formulario de nueva receta
  let fMenuItem = $state('');
  let fName = $state('');
  let fYield = $state(4);
  let fPrep = $state(15);
  let fCook = $state(30);
  let fTemp = $state<number | ''>('');
  let fVisibility = $state<'privada' | 'equipo'>('privada');
  let fSteps = $state('');
  let fLines = $state<RecipeLine[]>([]);
  /** Insumo elegido en el desplegable, del que se toma el costo actual. */
  let fPicked = $state('');

  let pickedGosId = $state<string | null>(null);
  let pickedGrams = $state<number | ''>('');
  let linkSaving = $state(false);
  let linkMessage = $state('');
  const pickedInventory = $derived(inventory.find((item) => item.id === fPicked));

  $effect(() => {
    const item = pickedInventory;
    pickedGosId = item?.gosIngredientId ?? null;
    pickedGrams = item?.gramsPerUnit ?? '';
  });

  async function saveIngredientLink() {
    const item = pickedInventory;
    if (!item) return;
    if (pickedGosId && (!Number.isFinite(Number(pickedGrams)) || Number(pickedGrams) <= 0)) {
      errorMsg = 'Indica gramos por unidad mayores que 0 para vincular GOS';
      return;
    }
    linkSaving = true;
    errorMsg = '';
    try {
      const grams = pickedGosId ? Number(pickedGrams) : null;
      const response = await apiFetch(`/api/inventory/${item.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gosIngredientId: pickedGosId, gramsPerUnit: grams }),
      });
      if (!response.ok) throw new Error(`No se pudo guardar el vínculo (${response.status})`);
      inventory = inventory.map((current) => current.id === item.id
        ? { ...current, gosIngredientId: pickedGosId, gramsPerUnit: grams } : current);
      linkMessage = 'Vínculo guardado en el inventario; se aplica a todas las recetas de este insumo.';
    } catch (error: unknown) {
      errorMsg = error instanceof Error ? error.message : 'No se pudo guardar el vínculo';
    } finally { linkSaving = false; }
  }

  onMount(load);

  async function load() {
    loading = true;
    try {
      const [r, m, i] = await Promise.all([
        api.get('/api/recipes'),
        api.get('/api/menu-items'),
        api.get('/api/inventory'),
      ]);
      if (r.ok) recipes = await r.json();
      if (m.ok) menuItems = await m.json();
      if (i.ok) inventory = await i.json();
    } catch {
      errorMsg = 'No se pudo cargar la informacion';
    } finally {
      loading = false;
    }
  }

  function addLine() {
    const item = inventory.find((i) => i.id === fPicked);
    if (!item) {
      errorMsg = 'Elige un insumo del inventario primero';
      return;
    }
    fLines = [
      ...fLines,
      { inventoryItemId: item.id, name: item.name, qty: 1, unit: item.unit, unitCost: item.unitCost ?? 0 },
    ];
    fPicked = '';
  }

  async function save() {
    if (!fMenuItem || !fName.trim() || fLines.length === 0) {
      errorMsg = 'Elige el plato, ponle nombre y agrega al menos un insumo';
      return;
    }
    saving = true;
    errorMsg = '';
    try {
      const res = await api.post('/api/recipes', {
        menuItemId: fMenuItem,
        name: fName.trim(),
        yield: Number(fYield),
        prepTimeMin: Number(fPrep),
        cookTimeMin: Number(fCook),
        ...(fTemp !== '' ? { cookTempC: Number(fTemp) } : {}),
        visibility: fVisibility,
        steps: fSteps.split('\n').map((s) => s.trim()).filter(Boolean),
        lines: fLines,
      });
      if (res.ok) {
        creating = false;
        fName = ''; fLines = []; fSteps = ''; fTemp = '';
        await load();
      } else {
        const d = await res.json().catch(() => ({}));
        errorMsg = d.details?.join(' ') || d.error || `Error ${res.status}`;
      }
    } catch {
      errorMsg = 'Error de conexion';
    } finally {
      saving = false;
    }
  }
</script>

<section class="recipes">
  {#if loading}
    <p class="empty">Cargando recetas…</p>
  {:else if recipes.length === 0 && !creating}
    <div class="empty-box">
      <p>Aun no tienes recetas.</p>
      <p class="hint">Las recetas son privadas: el cliente ve el plato, nunca como se prepara.</p>
      <button class="btn primary" onclick={() => (creating = true)}>Crear la primera receta</button>
    </div>
  {/if}

  {#if errorMsg}<p class="error" role="alert">⚠️ {errorMsg}</p>{/if}

  {#if creating}
    <form class="form" onsubmit={(e) => { e.preventDefault(); void save(); }}>
      <h2>Nueva receta</h2>

      <label>
        <span>Plato</span>
        <select bind:value={fMenuItem} required>
          <option value="">Elige un plato…</option>
          {#each menuItems as m}<option value={m.id}>{m.name}</option>{/each}
        </select>
      </label>

      <label>
        <span>Nombre de la receta</span>
        <input bind:value={fName} placeholder="Bandeja paisa clasica" required />
      </label>

      <div class="row3">
        <label>
          <span>Rinde (porciones)</span>
          <input type="number" min="1" bind:value={fYield} required />
        </label>
        <label>
          <span>Prep (min)</span>
          <input type="number" min="0" bind:value={fPrep} />
        </label>
        <label>
          <span>Coccion (min)</span>
          <input type="number" min="0" bind:value={fCook} />
        </label>
      </div>

      <label>
        <span>Temperatura de coccion (°C, opcional)</span>
        <input type="number" min="30" max="400" bind:value={fTemp} placeholder="180" />
      </label>

      <label>
        <span>Visibilidad</span>
        <select bind:value={fVisibility}>
          <option value="privada">Privada — solo el dueno</option>
          <option value="equipo">Equipo — la cocina tambien</option>
        </select>
      </label>

      <fieldset>
        <legend>Ingredientes</legend>
        <div class="line-add">
          <select bind:value={fPicked} onchange={() => { linkMessage = ''; }} aria-label="Insumo de inventario">
            <option value="">Elige un insumo…</option>
            {#each inventory as i}<option value={i.id}>{i.name} ({i.unit})</option>{/each}
          </select>
          <button type="button" class="btn ghost" onclick={addLine}>+ Agregar</button>
        </div>
        {#if pickedInventory}
          <div class="ingredient-link">
            <GosIngredientPicker bind:gosIngredientId={pickedGosId} bind:gramsPerUnit={pickedGrams} unit={pickedInventory.unit} />
            <Button type="button" variant="secondary" size="sm" disabled={linkSaving} loading={linkSaving} onclick={saveIngredientLink}>Guardar vínculo GOS</Button>
            {#if linkMessage}<p class="hint" role="status">{linkMessage}</p>{/if}
          </div>
        {/if}
        {#each fLines as line, idx (idx)}
          <div class="line-row">
            <span class="line-name">{line.name}</span>
            <input type="number" min="0.01" step="any" bind:value={fLines[idx].qty} aria-label="Cantidad" />
            <span class="line-unit">{line.unit}</span>
            <span class="line-cost">{formatCOP(line.qty * line.unitCost)}</span>
            <button
              type="button"
              class="x"
              aria-label="Quitar"
              onclick={() => (fLines = fLines.filter((_, i) => i !== idx))}>×</button
            >
          </div>
        {/each}
      </fieldset>

      <label>
        <span>Pasos (uno por linea)</span>
        <textarea bind:value={fSteps} rows="4" placeholder={'Sofirir cebolla\nAgregar carne\nServir con arroz'}></textarea>
      </label>

      <div class="form-actions">
        <button type="submit" class="btn primary" disabled={saving}>
          {saving ? 'Guardando…' : 'Guardar receta'}
        </button>
        <button type="button" class="btn ghost" onclick={() => (creating = false)}>Cancelar</button>
      </div>
    </form>
  {/if}

  <ul class="list">
    {#each recipes as r (r.id)}
      <li class="card">
        <button class="card-head" onclick={() => (openId = openId === r.id ? null : r.id)}>
          <div>
            <strong>{r.name}</strong>
            <span class="meta">
              {r.yield} porc. · {r.totalTimeMin} min
              {#if r.cookTempC}· {r.cookTempC}°C{/if}
            </span>
          </div>
          <div class="head-right">
            <span class="cost">{formatCOP(r.costPerServing)}/porc.</span>
            {#if r.lossMaking}<span class="badge loss">bajo costo</span>{/if}
            <span class="badge {r.visibility}">{r.visibility}</span>
          </div>
        </button>

        {#if openId === r.id}
          <div class="card-body">
            <p class="warn">
              Margen {Math.round(r.margin * 100)}% · precio {formatCOP(r.price)} vs costo {formatCOP(r.costPerServing)}
            </p>
            <h4>Ingredientes ({r.lines.length})</h4>
            <ul class="ings">
              {#each r.lines as l (l.inventoryItemId + l.name)}
                <li>
                  {l.qty} {l.unit} {l.name}
                  <span class="muted">— {formatCOP(l.qty * l.unitCost)}</span>
                </li>
              {/each}
            </ul>
            <p class="muted">
              Costo total {formatCOP(r.costTotal)} ÷ {r.yield} = {formatCOP(r.costPerServing)} por porcion
            </p>
            {#if r.steps.length}
              <h4>Preparacion</h4>
              <ol class="steps">
                {#each r.steps as s, idx (idx)}<li>{s}</li>{/each}
              </ol>
            {/if}
          </div>
        {/if}
      </li>
    {/each}
  </ul>

  {#if !creating && recipes.length > 0}
    <button class="btn primary add-more" onclick={() => (creating = true)}>+ Nueva receta</button>
  {/if}
</section>

<style>
  .ingredient-link { display: flex; flex-direction: column; gap: var(--swal-space-2, 0.5rem); margin-block: 0.75rem; padding: 0.75rem; border: 1px solid var(--swal-border); border-radius: var(--swal-radius); background: var(--swal-surface); }
  .recipes { display: flex; flex-direction: column; gap: 1rem; }
  .empty, .hint { color: var(--swal-text-secondary); font-size: 0.85rem; }
  .empty-box {
    display: flex; flex-direction: column; gap: 0.5rem; align-items: flex-start;
    padding: 1.5rem; border: 1px dashed var(--swal-border); border-radius: 0.8rem;
  }
  .error { color: #f87171; font-size: 0.85rem; }

  .form {
    display: flex; flex-direction: column; gap: 0.8rem; padding: 1.2rem;
    border: 1px solid var(--swal-border); border-radius: 0.8rem;
    background: var(--swal-bg-surface);
  }
  .form h2 { margin: 0; font-size: 1.05rem; }
  label { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.82rem; }
  label span { opacity: 0.75; }
  input, select, textarea {
    border: 1px solid var(--swal-border); border-radius: 0.45rem;
    padding: 0.5rem 0.6rem; background: var(--swal-bg-elevated); color: inherit; font: inherit;
  }
  /*
   * field-sizing (Baseline 2026) deja que el texto se ajuste al campo; con
   * min-width para que vacio no colapse a un cursor y max-width para no romper
   * el layout. Mejora progresiva: sin soporte, el input queda de ancho fijo.
   */
  input[type='text'], input[type='search'] {
    field-sizing: content;
    min-width: 10rem;
    max-width: 100%;
  }
  .row3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.6rem; }

  fieldset { border: 1px solid var(--swal-border); border-radius: 0.6rem; padding: 0.8rem; }
  legend { font-size: 0.8rem; opacity: 0.75; padding: 0 0.3rem; }
  .line-add { display: flex; gap: 0.5rem; margin-bottom: 0.5rem; }
  .line-add select { flex: 1; }
  .line-row {
    display: grid; grid-template-columns: 1fr 5rem 2.5rem 5rem 1.6rem;
    gap: 0.4rem; align-items: center; font-size: 0.8rem; padding: 0.2rem 0;
  }
  .line-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .line-unit, .line-cost { opacity: 0.7; }
  .x { background: none; border: none; color: #f87171; cursor: pointer; font-size: 1.1rem; }

  .form-actions { display: flex; gap: 0.6rem; }

  .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.6rem; }
  .card { border: 1px solid var(--swal-border); border-radius: 0.7rem; overflow: hidden; }
  .card-head {
    width: 100%; display: flex; justify-content: space-between; align-items: center; gap: 0.75rem;
    padding: 0.85rem 1rem; background: none; border: none; color: inherit; cursor: pointer; text-align: left;
  }
  .meta { display: block; font-size: 0.78rem; opacity: 0.65; margin-top: 0.15rem; }
  .head-right { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; }
  .cost { font-weight: 700; font-size: 0.9rem; }
  .badge {
    font-size: 0.68rem; padding: 0.15rem 0.45rem; border-radius: 999px;
    border: 1px solid var(--swal-border); text-transform: uppercase; letter-spacing: 0.03em;
  }
  .badge.privada { color: #c084fc; border-color: #c084fc; }
  .badge.equipo { color: var(--swal-accent); border-color: var(--swal-accent); }
  .badge.loss { color: #f87171; border-color: #f87171; }

  .card-body { padding: 0 1rem 1rem; border-top: 1px solid var(--swal-border); font-size: 0.85rem; }
  .card-body h4 { margin: 0.9rem 0 0.4rem; font-size: 0.82rem; opacity: 0.75; }
  .warn { color: var(--swal-warning); font-size: 0.8rem; margin: 0.6rem 0 0; }
  .ings { list-style: none; margin: 0; padding: 0; }
  .ings li { padding: 0.2rem 0; }
  .muted { opacity: 0.6; font-size: 0.8rem; }
  .steps { margin: 0; padding-left: 1.2rem; }
  .steps li { padding: 0.15rem 0; }

  .add-more { align-self: flex-start; }
  .btn { padding: 0.55rem 1rem; border-radius: 0.5rem; font: inherit; cursor: pointer; border: 1px solid var(--swal-border); }
  .btn.primary { background: var(--swal-accent-cyan, #22d3ee); color: var(--swal-bg); border-color: transparent; font-weight: 600; }
  .btn.ghost { background: transparent; color: var(--swal-text-secondary); }
</style>
