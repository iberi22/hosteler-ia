<!--
  TakeOrderForm.svelte — "Nuevo pedido" del personal: mesa + platos con cantidades + nota opcional.
  Componente compartido (modo local y dashboard): envia por el cliente API existente
  (`api.post('/api/orders', ...)`), que en /local/* va a IndexedDB y en el panel al servidor.
  La mesa se pre-selecciona con `?mesa=<tableId>` en la URL (la accion por mesa de /local/mesas).
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { Button, Card } from '@swal/ui';
  import { api } from '../../lib/api-client';
  import { formatCOP } from '../../lib/money';
  import { isLocalMode } from '../../lib/local/localMode';
  import { meshPublish } from '../../lib/mesh';
  import { mapOrder } from '../../lib/storeSync';
  import { orders, type Order } from '../../stores/orders.svelte';
  import {
    buildTakeOrderPayload,
    orderableDishes,
    takeOrderTotal,
    type TakeOrderDish,
  } from '../../lib/takeOrder';

  type Table = { id: string; number: number; capacity: number };

  let tables = $state<Table[]>([]);
  let dishes = $state<TakeOrderDish[]>([]);
  let loading = $state(true);
  let loadError = $state<string | null>(null);

  let tableId = $state('');
  let quantities = $state<Record<string, number>>({});
  let note = $state('');
  let submitting = $state(false);
  let submitError = $state<string | null>(null);

  let created = $state<{ tableNumber: number | null; total: number } | null>(null);

  const base = isLocalMode() ? '/local' : '/dashboard';
  const total = $derived(takeOrderTotal(quantities, dishes));
  const lineCount = $derived(Object.values(quantities).reduce((n, q) => n + (q > 0 ? q : 0), 0));
  const canSubmit = $derived(tableId !== '' && lineCount > 0 && !submitting && !loading);

  function qtyOf(id: string): number {
    return quantities[id] ?? 0;
  }

  function add(id: string) {
    quantities = { ...quantities, [id]: qtyOf(id) + 1 };
  }

  function remove(id: string) {
    const next = qtyOf(id) - 1;
    if (next <= 0) {
      const { [id]: _drop, ...rest } = quantities;
      quantities = rest;
    } else {
      quantities = { ...quantities, [id]: next };
    }
  }

  function tableNumber(id: string): number | null {
    return tables.find((t) => t.id === id)?.number ?? null;
  }

  async function load() {
    loading = true;
    loadError = null;
    try {
      const [tablesRes, dishesRes] = await Promise.all([
        api.get('/api/tables'),
        api.get('/api/menu-items'),
      ]);
      if (!tablesRes.ok) {
        const body = (await tablesRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Mesas: error ${tablesRes.status}`);
      }
      if (!dishesRes.ok) {
        const body = (await dishesRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Carta: error ${dishesRes.status}`);
      }
      const rawTables = (await tablesRes.json()) as Table[];
      tables = Array.isArray(rawTables) ? rawTables : [];
      const rawDishes = (await dishesRes.json()) as TakeOrderDish[];
      dishes = orderableDishes(Array.isArray(rawDishes) ? rawDishes : []);

      // Pre-seleccion por mesa (?mesa=<tableId>): solo si la mesa existe.
      try {
        const prefill = new URLSearchParams(window.location.search).get('mesa');
        if (prefill && tables.some((t) => t.id === prefill)) tableId = prefill;
      } catch {
        /* sin URL: sin pre-seleccion */
      }
    } catch (err) {
      loadError = err instanceof Error ? err.message : 'No se pudo cargar la carta ni las mesas';
    } finally {
      loading = false;
    }
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    submitting = true;
    submitError = null;
    try {
      const payload = buildTakeOrderPayload(tableId, quantities, note);
      if (!payload) {
        submitError = 'Elige una mesa y al menos un plato';
        return;
      }
      const res = await api.post('/api/orders', payload);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        submitError = body.error ?? `No se pudo crear el pedido (error ${res.status})`;
        return;
      }
      // El pedido entra al store y a la malla como los demas: /pedidos y /cocina lo pintan
      // en pending sin recargar (poll + `order:created`, igual que la cola del KDS).
      const order = mapOrder((await res.json()) as Parameters<typeof mapOrder>[0]) as Order;
      orders.list.push(order);
      await meshPublish('order:created', order);
      created = { tableNumber: tableNumber(order.tableId ?? ''), total: order.totalPrice };
      quantities = {};
      note = '';
    } catch {
      submitError = 'Error de conexión al crear el pedido';
    } finally {
      submitting = false;
    }
  }

  function takeAnother() {
    created = null;
  }

  onMount(() => {
    void load();
  });
</script>

<Card variant="surface" padding="md">
  {#if loading}
    <p class="state-msg">Cargando carta y mesas…</p>
  {:else if loadError}
    <p class="error-banner" role="alert">⚠️ {loadError}</p>
  {:else if created}
    <div class="success" role="status">
      <p class="success-title">Pedido creado</p>
      <p class="success-detail">
        {created.tableNumber !== null ? `Mesa ${created.tableNumber} · ` : ''}Total {formatCOP(created.total)} · pendiente en cocina
      </p>
      <div class="success-actions">
        <Button variant="primary" href="{base}/pedidos/">Ver en pedidos</Button>
        <Button variant="secondary" href="{base}/cocina/">Ver en cocina</Button>
        <Button variant="ghost" onclick={takeAnother}>Tomar otro pedido</Button>
      </div>
    </div>
  {:else}
    <form class="take-order" onsubmit={submit}>
      <div class="field">
        <label for="take-order-table">Mesa</label>
        {#if tables.length === 0}
          <p class="field-hint">
            Todavía no hay mesas. <a href="{base}/mesas/">Crea la primera mesa</a> y vuelve aquí.
          </p>
        {:else}
          <select id="take-order-table" bind:value={tableId} required>
            <option value="">Elige una mesa</option>
            {#each tables as t (t.id)}
              <option value={t.id}>Mesa {t.number} ({t.capacity} pax)</option>
            {/each}
          </select>
        {/if}
      </div>

      <fieldset class="field">
        <legend>Platos</legend>
        {#if dishes.length === 0}
          <p class="field-hint">
            La carta está vacía. <a href="{base}/carta/">Agrega platos a la carta</a> y vuelve aquí.
          </p>
        {:else}
          <ul class="dish-list">
            {#each dishes as d (d.id)}
              <li class="dish">
                <div class="dish-info">
                  <span class="dish-name">{d.name}</span>
                  <span class="dish-price">{formatCOP(d.price)}</span>
                </div>
                <div class="stepper">
                  <button
                    type="button"
                    class="step-btn"
                    aria-label="Quitar una porción de {d.name}"
                    disabled={qtyOf(d.id) === 0}
                    onclick={() => remove(d.id)}
                  >−</button>
                  <span class="qty" aria-live="polite">{qtyOf(d.id)}</span>
                  <button
                    type="button"
                    class="step-btn"
                    aria-label="Añadir {d.name}"
                    onclick={() => add(d.id)}
                  >+</button>
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </fieldset>

      <div class="field">
        <label for="take-order-note">Nota (opcional)</label>
        <textarea
          id="take-order-note"
          rows="2"
          maxlength="280"
          placeholder="p. ej. sin cebolla"
          bind:value={note}
        ></textarea>
      </div>

      <div class="total-row">
        <span>Total</span>
        <strong data-testid="take-order-total" aria-live="polite">{formatCOP(total)}</strong>
      </div>

      {#if submitError}
        <p class="error-banner" role="alert">⚠️ {submitError}</p>
      {/if}

      <Button variant="primary" type="submit" disabled={!canSubmit}>
        {submitting ? 'Creando…' : 'Crear pedido'}
      </Button>
    </form>
  {/if}
</Card>

<style>
  .take-order { display: flex; flex-direction: column; gap: 1rem; }
  .field { display: flex; flex-direction: column; gap: 0.4rem; border: 0; padding: 0; margin: 0; }
  .field > label, .field > legend {
    font-size: 0.85rem; font-weight: 700; color: var(--swal-text); padding: 0;
  }
  .field-hint { color: var(--swal-text-secondary); font-size: 0.9rem; margin: 0; }
  .field-hint a { color: var(--swal-accent-cyan); }
  select, textarea {
    background: var(--swal-bg-elevated); border: 1px solid var(--swal-border);
    border-radius: 6px; color: var(--swal-text); padding: 0.55rem 0.7rem; font-size: 0.95rem;
    font-family: inherit;
  }
  select:focus-visible, textarea:focus-visible, .step-btn:focus-visible {
    outline: 2px solid var(--swal-accent-cyan); outline-offset: 1px;
  }
  .dish-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; }
  .dish {
    display: flex; justify-content: space-between; align-items: center; gap: 0.75rem;
    padding: 0.55rem 0.7rem; border: 1px solid var(--swal-border); border-radius: 6px;
    background: var(--swal-bg-elevated);
  }
  .dish-info { display: flex; flex-direction: column; gap: 0.15rem; min-width: 0; }
  .dish-name { color: var(--swal-text); font-weight: 600; }
  .dish-price { color: var(--swal-text-secondary); font-family: var(--swal-font-mono); font-size: 0.85rem; }
  .stepper { display: flex; align-items: center; gap: 0.5rem; }
  .step-btn {
    width: 2.25rem; height: 2.25rem; border-radius: 6px; font-size: 1.2rem; line-height: 1;
    border: 1px solid var(--swal-border); background: var(--swal-bg-surface);
    color: var(--swal-text); cursor: pointer;
  }
  .step-btn:hover:not(:disabled) { border-color: var(--swal-accent-cyan); color: var(--swal-accent-cyan); }
  .step-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .qty { min-width: 1.5rem; text-align: center; font-weight: 700; font-family: var(--swal-font-mono); color: var(--swal-text); }
  .total-row {
    display: flex; justify-content: space-between; align-items: center;
    border-top: 1px solid var(--swal-border); padding-top: 0.75rem;
    color: var(--swal-text-secondary); font-size: 0.95rem;
  }
  .total-row strong { font-family: var(--swal-font-mono); font-size: 1.25rem; color: var(--swal-accent-cyan); }
  .state-msg { padding: 2rem; text-align: center; color: var(--swal-text-muted); }
  .error-banner {
    padding: 0.5rem 0.75rem; background: var(--swal-bg-surface);
    border: 1px solid var(--swal-accent-red, #ef4444); color: var(--swal-accent-red, #ef4444);
    border-radius: 6px; font-size: 0.85rem; margin: 0;
  }
  .success { display: flex; flex-direction: column; gap: 0.75rem; }
  .success-title { margin: 0; font-size: 1.1rem; font-weight: 800; color: var(--swal-text); }
  .success-detail { margin: 0; color: var(--swal-text-secondary); }
  .success-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }
</style>
