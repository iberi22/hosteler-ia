<script lang="ts">
  // PurchaseManager.svelte — compras, facturas de proveedor e insumos.
  //
  // El efecto que importa: registrar una compra SUMA el stock de cada insumo y
  // actualiza su costo unitario. Ese costo es el que despues calcula el costo
  // de las recetas, asi que sin esto el margen del menu seria siempre falso.
  import { onMount } from 'svelte';
  import { api } from '../../lib/api-client';
  import { formatCOP } from '../../lib/money';

  interface Supplier {
    id: string;
    name: string;
    taxId?: string;
    phone?: string;
    creditDays: number;
    isActive: boolean;
  }
  interface PurchaseLine {
    inventoryItemId: string;
    name: string;
    qty: number;
    unit: string;
    unitCost: number;
  }
  interface Purchase {
    id: string;
    supplierId: string;
    supplierName: string;
    invoiceNumber: string;
    invoiceDate: string;
    total: number;
    subtotal: number;
    tax: number;
    lines: PurchaseLine[];
  }
  interface InventoryItem {
    id: string;
    name: string;
    unit: string;
    stock: number;
    unitCost?: number;
  }

  let suppliers = $state<Supplier[]>([]);
  let purchases = $state<Purchase[]>([]);
  let inventory = $state<InventoryItem[]>([]);
  let loading = $state(true);
  let errorMsg = $state('');
  let tab = $state<'compras' | 'proveedores'>('compras');
  let saving = $state(false);

  // Proveedor nuevo
  let sName = $state('');
  let sPhone = $state('');
  let sCredit = $state(0);

  // Compra nueva
  let cSupplier = $state('');
  let cInvoice = $state('');
  let cDate = $state(new Date().toISOString().slice(0, 10));
  let cTax = $state(0.19);
  let cLines = $state<PurchaseLine[]>([]);
  let cPicked = $state('');

  onMount(load);

  async function load() {
    loading = true;
    try {
      const [s, p, i] = await Promise.all([
        api.get('/api/suppliers'),
        api.get('/api/purchases'),
        api.get('/api/inventory'),
      ]);
      if (s.ok) suppliers = await s.json();
      if (p.ok) purchases = await p.json();
      if (i.ok) inventory = await i.json();
    } catch {
      errorMsg = 'No se pudo cargar la informacion';
    } finally {
      loading = false;
    }
  }

  const cSubtotal = $derived(cLines.reduce((s, l) => s + Math.round(l.qty * l.unitCost), 0));
  const cTaxAmount = $derived(Math.round(cSubtotal * cTax));
  const cTotal = $derived(cSubtotal + cTaxAmount);

  function addLine() {
    const item = inventory.find((i) => i.id === cPicked);
    if (!item) {
      errorMsg = 'Elige un insumo del inventario';
      return;
    }
    cLines = [
      ...cLines,
      { inventoryItemId: item.id, name: item.name, qty: 1, unit: item.unit, unitCost: item.unitCost ?? 0 },
    ];
    cPicked = '';
  }

  async function addSupplier() {
    if (!sName.trim()) return;
    saving = true;
    errorMsg = '';
    try {
      const res = await api.post('/api/suppliers', {
        name: sName.trim(),
        ...(sPhone ? { phone: sPhone.trim() } : {}),
        creditDays: Number(sCredit),
      });
      if (res.ok) {
        sName = ''; sPhone = ''; sCredit = 0;
        await load();
      } else {
        const d = await res.json().catch(() => ({}));
        errorMsg = d.details?.join(' ') || d.error || `Error ${res.status}`;
      }
    } finally {
      saving = false;
    }
  }

  async function addPurchase() {
    if (!cSupplier || !cInvoice.trim() || cLines.length === 0) {
      errorMsg = 'Elige proveedor, numero de factura y al menos un insumo';
      return;
    }
    saving = true;
    errorMsg = '';
    try {
      const res = await api.post('/api/purchases', {
        supplierId: cSupplier,
        invoiceNumber: cInvoice.trim(),
        invoiceDate: cDate,
        taxRate: Number(cTax),
        lines: cLines,
      });
      if (res.ok) {
        cInvoice = ''; cLines = [];
        await load();
      } else {
        const d = await res.json().catch(() => ({}));
        errorMsg = d.details?.join(' ') || d.error || `Error ${res.status}`;
      }
    } finally {
      saving = false;
    }
  }
</script>

<section class="pm">
  <nav class="tabs" aria-label="Secciones">
    <button class:active={tab === 'compras'} onclick={() => (tab = 'compras')}>Compras</button>
    <button class:active={tab === 'proveedores'} onclick={() => (tab = 'proveedores')}>Proveedores</button>
  </nav>

  {#if errorMsg}<p class="error" role="alert">⚠️ {errorMsg}</p>{/if}
  {#if loading}<p class="muted">Cargando…</p>{/if}

  {#if tab === 'compras'}
    <form class="form" onsubmit={(e) => { e.preventDefault(); void addPurchase(); }}>
      <h2>Registrar compra</h2>
      <p class="hint">Al guardar, el stock de cada insumo sube y su costo unitario se actualiza.</p>

      <div class="row2">
        <label>
          <span>Proveedor</span>
          <select bind:value={cSupplier} required>
            <option value="">Elige…</option>
            {#each suppliers as s}<option value={s.id}>{s.name}</option>{/each}
          </select>
        </label>
        <label>
          <span>No. factura</span>
          <input bind:value={cInvoice} placeholder="FV-001" required />
        </label>
      </div>

      <div class="row2">
        <label>
          <span>Fecha</span>
          <input type="date" bind:value={cDate} required />
        </label>
        <label>
          <span>IVA</span>
          <select bind:value={cTax}>
            <option value={0}>Sin IVA</option>
            <option value={0.05}>5%</option>
            <option value={0.19}>19%</option>
          </select>
        </label>
      </div>

      <fieldset>
        <legend>Insumos</legend>
        <div class="line-add">
          <select bind:value={cPicked}>
            <option value="">Elige un insumo…</option>
            {#each inventory as i}<option value={i.id}>{i.name} ({i.unit})</option>{/each}
          </select>
          <button type="button" class="btn ghost" onclick={addLine}>+ Agregar</button>
        </div>
        {#each cLines as l, idx (idx)}
          <div class="line-row">
            <span class="ln">{l.name}</span>
            <input type="number" min="0.01" step="any" bind:value={cLines[idx].qty} aria-label="Cantidad" />
            <span class="lu">{l.unit}</span>
            <input type="number" min="0" bind:value={cLines[idx].unitCost} aria-label="Costo unitario" />
            <span class="lt">{formatCOP(l.qty * l.unitCost)}</span>
            <button type="button" class="x" aria-label="Quitar" onclick={() => (cLines = cLines.filter((_, i) => i !== idx))}>×</button>
          </div>
        {/each}
      </fieldset>

      <p class="totals">
        Subtotal {formatCOP(cSubtotal)} · IVA {formatCOP(cTaxAmount)} · <strong>Total {formatCOP(cTotal)}</strong>
      </p>

      <button type="submit" class="btn primary" disabled={saving}>
        {saving ? 'Guardando…' : 'Registrar compra'}
      </button>
    </form>

    <h2 class="list-title">Historial ({purchases.length})</h2>
    {#if purchases.length === 0 && !loading}
      <p class="muted">Aun no hay compras registradas.</p>
    {/if}
    <ul class="list">
      {#each purchases as p (p.id)}
        <li class="card">
          <div class="row">
            <div>
              <strong>{p.supplierName}</strong>
              <span class="meta">Fact. {p.invoiceNumber} · {p.invoiceDate} · {p.lines.length} insumo(s)</span>
            </div>
            <strong class="amount">{formatCOP(p.total)}</strong>
          </div>
          <details>
            <summary>Ver detalle</summary>
            <ul class="ings">
              {#each p.lines as l (l.inventoryItemId + l.name)}
                <li>{l.qty} {l.unit} {l.name} — {formatCOP(l.qty * l.unitCost)}</li>
              {/each}
            </ul>
            <p class="muted">Subtotal {formatCOP(p.subtotal)} · IVA {formatCOP(p.tax)}</p>
          </details>
        </li>
      {/each}
    </ul>
  {:else}
    <form class="form" onsubmit={(e) => { e.preventDefault(); void addSupplier(); }}>
      <h2>Nuevo proveedor</h2>
      <div class="row2">
        <label>
          <span>Nombre</span>
          <input bind:value={sName} placeholder="Carniceria del Sur" required />
        </label>
        <label>
          <span>Telefono</span>
          <input bind:value={sPhone} placeholder="311 222 3344" />
        </label>
      </div>
      <label>
        <span>Dias de credito</span>
        <input type="number" min="0" max="365" bind:value={sCredit} />
      </label>
      <button type="submit" class="btn primary" disabled={saving}>
        {saving ? 'Guardando…' : 'Agregar proveedor'}
      </button>
    </form>

    <h2 class="list-title">Proveedores ({suppliers.length})</h2>
    <ul class="list">
      {#each suppliers as s (s.id)}
        <li class="card row">
          <div>
            <strong>{s.name}</strong>
            <span class="meta">
              {s.phone ?? 'sin telefono'} · {s.creditDays === 0 ? 'contra entrega' : `${s.creditDays} dias de credito`}
            </span>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .pm { display: flex; flex-direction: column; gap: 1rem; }
  .tabs { display: flex; gap: 0.4rem; }
  .tabs button {
    padding: 0.45rem 0.9rem; border-radius: 999px; border: 1px solid var(--swal-border);
    background: transparent; color: inherit; cursor: pointer; font: inherit;
  }
  .tabs button.active { background: var(--swal-accent-cyan, #22d3ee); color: var(--swal-bg); border-color: transparent; font-weight: 600; }

  .form {
    display: flex; flex-direction: column; gap: 0.8rem; padding: 1.2rem;
    border: 1px solid var(--swal-border); border-radius: 0.8rem; background: var(--swal-bg-surface);
  }
  .form h2, .list-title { margin: 0; font-size: 1.02rem; }
  .list-title { margin-top: 0.5rem; }
  .hint { margin: 0; font-size: 0.8rem; opacity: 0.65; }
  .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; }
  label { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.82rem; }
  label span { opacity: 0.75; }
  input, select {
    border: 1px solid var(--swal-border); border-radius: 0.45rem;
    padding: 0.5rem 0.6rem; background: var(--swal-bg-elevated); color: inherit; font: inherit;
  }
  /* field-sizing (Baseline 2026) como mejora progresiva; ver RecipeManager. */
  input[type='text'], input[type='search'], input[type='tel'] {
    field-sizing: content;
    min-width: 9rem;
    max-width: 100%;
  }
  fieldset { border: 1px solid var(--swal-border); border-radius: 0.6rem; padding: 0.8rem; }
  legend { font-size: 0.8rem; opacity: 0.75; padding: 0 0.3rem; }
  .line-add { display: flex; gap: 0.5rem; margin-bottom: 0.5rem; }
  .line-add select { flex: 1; }
  .line-row {
    display: grid; grid-template-columns: 1fr 4.5rem 2.5rem 5.5rem 5rem 1.5rem;
    gap: 0.35rem; align-items: center; font-size: 0.8rem; padding: 0.2rem 0;
  }
  .ln { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lu { opacity: 0.6; }
  .lt { opacity: 0.75; text-align: right; }
  .x { background: none; border: none; color: #f87171; cursor: pointer; font-size: 1.1rem; }

  .totals { margin: 0; font-size: 0.85rem; opacity: 0.85; }
  .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; }
  .card { border: 1px solid var(--swal-border); border-radius: 0.7rem; padding: 0.8rem 0.9rem; }
  .card .row { display: flex; justify-content: space-between; align-items: center; gap: 0.75rem; }
  .meta { display: block; font-size: 0.78rem; opacity: 0.65; margin-top: 0.15rem; }
  .amount { font-variant-numeric: tabular-nums; }
  .ings { list-style: none; margin: 0.4rem 0 0; padding: 0; font-size: 0.8rem; }
  .ings li { padding: 0.15rem 0; }
  .muted { opacity: 0.6; font-size: 0.82rem; }
  .error { color: #f87171; font-size: 0.85rem; margin: 0; }
  .btn { padding: 0.55rem 1rem; border-radius: 0.5rem; font: inherit; cursor: pointer; border: 1px solid var(--swal-border); }
  .btn.primary { background: var(--swal-accent-cyan, #22d3ee); color: var(--swal-bg); border-color: transparent; font-weight: 600; }
  .btn.ghost { background: transparent; color: var(--swal-text-secondary); }
  @media (max-width: 720px) {
    .row2 { grid-template-columns: 1fr; }
    .line-row { grid-template-columns: 1fr 3.8rem 2.2rem 4.8rem 1.4rem; }
    .lt { display: none; }
  }
</style>
